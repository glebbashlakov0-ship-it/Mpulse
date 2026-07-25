import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  COIN_MIGRATION_VERSION,
  applyMigration,
  inspectMigration,
  type CoinCutoverDatabaseTarget,
  type MigrationReport,
} from "./coinsMigration.js";
import {
  persistCoinReconciliationReport,
  runCoinReconciliation,
  type CoinReconciliationReport,
} from "./reconcileCoins.js";
import {
  guardProductionCoinCutover,
  type ProductionCoinCutoverReleaseMarker,
} from "../src/productionCoinCutover.js";
import { runSchemaMigrations } from "../src/schemaMigrations.js";

export const PRODUCTION_COIN_CUTOVER_LOCK =
  "market_pulse:production_coin_cutover";
export const PRODUCTION_COIN_CUTOVER_MARKER_URL = new URL(
  "../releases/2026-07-25-coins-v1-production-cutover.json",
  import.meta.url,
);

type ProductionCoinCutoverResult =
  | {
      skipped: true;
      reason: "not-production";
    }
  | {
      skipped: false;
      releaseMarker: string;
      databaseTargetFingerprint: string;
      schemaMigrationsApplied: string[];
      schemaMigrationsSkipped: string[];
      inspection: MigrationReport;
      migration: MigrationReport;
      reconciliation: CoinReconciliationReport;
      noOp: boolean;
    };

export async function runProductionCoinCutover(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProductionCoinCutoverResult> {
  const marker = await loadReleaseMarker();
  const guard = guardProductionCoinCutover(
    env,
    marker,
    COIN_MIGRATION_VERSION,
  );
  if (!guard.shouldRun) {
    return { skipped: true, reason: guard.reason };
  }

  const pool = new Pool({
    connectionString: guard.databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [
      `${PRODUCTION_COIN_CUTOVER_LOCK}:${marker.releaseMarker}`,
    ]);
    lockAcquired = true;

    const databaseTarget = await verifyConnectedDatabaseTarget(
      client,
      guard.target,
    );
    const schema = await runSchemaMigrations(client);
    const completionAlreadyExists = await hasMatchingCompletion(
      client,
      marker,
      databaseTarget,
    );

    const inspection = await inspectMigration(client);
    assertSafeInspection(inspection);
    const migration = await applyMigration(client, {
      releaseMarker: marker.releaseMarker,
      databaseTarget,
    });
    const reconciliation = await runCoinReconciliation(client);

    if (reconciliation.status !== "passed") {
      if (!completionAlreadyExists) {
        await persistCoinReconciliationReport(client, reconciliation);
      }
      throw new Error(
        `Production Coin cutover reconciliation failed with ${reconciliation.discrepancyCount} discrepancies.`,
      );
    }

    if (!completionAlreadyExists) {
      const reconciliationRunId = await persistCoinReconciliationReport(
        client,
        reconciliation,
      );
      if (!reconciliationRunId) {
        throw new Error(
          "Production Coin cutover blocked: reconciliation evidence was not persisted.",
        );
      }
      await persistCompletion(
        client,
        marker,
        databaseTarget,
        reconciliationRunId,
        reconciliation,
      );
    }

    return {
      skipped: false,
      releaseMarker: marker.releaseMarker,
      databaseTargetFingerprint: databaseTarget.fingerprint,
      schemaMigrationsApplied: schema.applied,
      schemaMigrationsSkipped: schema.skipped,
      inspection,
      migration,
      reconciliation,
      noOp: completionAlreadyExists && migration.noOp,
    };
  } finally {
    if (lockAcquired) {
      await client.query("select pg_advisory_unlock(hashtext($1))", [
        `${PRODUCTION_COIN_CUTOVER_LOCK}:${marker.releaseMarker}`,
      ]);
    }
    client.release();
    await pool.end();
  }
}

async function loadReleaseMarker() {
  const contents = await readFile(PRODUCTION_COIN_CUTOVER_MARKER_URL, "utf8");
  return JSON.parse(contents) as ProductionCoinCutoverReleaseMarker;
}

async function verifyConnectedDatabaseTarget(
  client: PoolClient,
  expected: {
    hostname: string;
    port: number;
    databaseName: string;
    fingerprint: string;
  },
): Promise<CoinCutoverDatabaseTarget> {
  const result = await client.query<{
    database_name: string;
    server_address: string | null;
    server_port: number | null;
    ssl: boolean;
  }>(
    `select
       current_database()::text as database_name,
       inet_server_addr()::text as server_address,
       inet_server_port() as server_port,
       coalesce((
         select ssl
         from pg_stat_ssl
         where pid = pg_backend_pid()
       ), false) as ssl`,
  );
  const connected = result.rows[0];
  if (
    !connected ||
    connected.database_name !== expected.databaseName ||
    connected.ssl !== true
  ) {
    throw new Error(
      "Production Coin cutover blocked: connected PostgreSQL identity does not match the exact SSL DATABASE_URL target.",
    );
  }

  return {
    urlHostname: expected.hostname,
    urlPort: expected.port,
    urlDatabaseName: expected.databaseName,
    connectedDatabaseName: connected.database_name,
    serverAddress: connected.server_address,
    serverPort: connected.server_port,
    ssl: connected.ssl,
    fingerprint: expected.fingerprint,
  };
}

function assertSafeInspection(report: MigrationReport) {
  if (
    BigInt(report.pendingDepositCount) !== 0n ||
    BigInt(report.pendingWithdrawalCount) !== 0n
  ) {
    throw new Error(
      "Production Coin cutover blocked: pending legacy money operations must be drained.",
    );
  }
  if (
    report.unsafePrecisionUsers.length > 0 ||
    report.unsafeProjectionRows.length > 0 ||
    report.negativeBalanceUsers.length > 0
  ) {
    throw new Error(
      "Production Coin cutover blocked: legacy balances or projections are invalid.",
    );
  }
  if (!["legacy", "migrating", "coin"].includes(report.cutoverState)) {
    throw new Error(
      `Production Coin cutover blocked: unexpected state ${report.cutoverState}.`,
    );
  }
}

async function hasMatchingCompletion(
  client: PoolClient,
  marker: ProductionCoinCutoverReleaseMarker,
  databaseTarget: CoinCutoverDatabaseTarget,
) {
  const completion = await client.query<{ matches: boolean }>(
    `select
       migration_version = $2
       and database_target = $3::jsonb as matches
     from coin_production_cutover_completions
     where release_marker = $1`,
    [
      marker.releaseMarker,
      marker.migrationVersion,
      JSON.stringify(databaseTarget),
    ],
  );
  if (
    completion.rows.length > 0 &&
    completion.rows[0]?.matches !== true
  ) {
    throw new Error(
      "Production Coin cutover blocked: release marker completion belongs to another database target or migration.",
    );
  }
  return completion.rows[0]?.matches === true;
}

async function persistCompletion(
  client: PoolClient,
  marker: ProductionCoinCutoverReleaseMarker,
  databaseTarget: CoinCutoverDatabaseTarget,
  reconciliationRunId: string,
  reconciliation: CoinReconciliationReport,
) {
  await client.query("begin");
  try {
    await client.query(
      `insert into coin_production_cutover_completions (
         release_marker, migration_version, database_target,
         reconciliation_run_id, reconciliation_report
       ) values ($1, $2, $3::jsonb, $4, $5::jsonb)`,
      [
        marker.releaseMarker,
        marker.migrationVersion,
        JSON.stringify(databaseTarget),
        reconciliationRunId,
        JSON.stringify(reconciliation),
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  const result = await runProductionCoinCutover();
  console.log(JSON.stringify(result, null, 2));
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
