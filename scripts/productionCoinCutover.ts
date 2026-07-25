import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  COIN_MIGRATION_VERSION,
  applyMigration,
  inspectMigration,
  stableCoinCutoverDatabaseTargetsMatch,
  type CoinCutoverDatabaseTarget,
  type MigrationReport,
  verifyProductionSnapshotEvidence,
} from "./coinsMigration.js";
import {
  persistCoinReconciliationReportInTransaction,
  runCoinReconciliation,
  type CoinReconciliationReport,
} from "./reconcileCoins.js";
import {
  guardProductionCoinCutover,
  type ProductionCoinCutoverReleaseMarker,
} from "../src/productionCoinCutover.js";
import { enforceVerifiedPostgresTls } from "../src/postgresTls.js";
import { runSchemaMigrations } from "../src/schemaMigrations.js";

export const PRODUCTION_COIN_CUTOVER_LOCK =
  "market_pulse:production_coin_cutover";
export const PRODUCTION_COIN_CUTOVER_MARKER_URL = resolve(
  process.cwd(),
  "releases",
  "2026-07-25-coins-v1-production-cutover.json",
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
    connectionString: enforceVerifiedPostgresTls(guard.databaseUrl),
    ssl: { rejectUnauthorized: true },
    max: 1,
  });
  const client = await pool.connect();
  try {
    const databaseTarget = await verifyConnectedDatabaseTarget(
      client,
      guard.target,
    );
    const schema = await runSchemaMigrations(client);
    const completed = await tryCompletedCutoverFastPath(
      client,
      marker,
      databaseTarget,
    );
    if (completed) {
      return {
        skipped: false,
        releaseMarker: marker.releaseMarker,
        databaseTargetFingerprint: databaseTarget.fingerprint,
        schemaMigrationsApplied: schema.applied,
        schemaMigrationsSkipped: schema.skipped,
        inspection: completed.inspection,
        migration: completed.migration,
        reconciliation: completed.reconciliation,
        noOp: true,
      };
    }

    const inspection = await inspectMigration(client);
    assertSafeInspection(inspection);
    const migration = await applyMigration(client, {
      releaseMarker: marker.releaseMarker,
      databaseTarget,
    });
    const finalized = await finalizeProductionCutover(
      client,
      marker,
      databaseTarget,
    );
    if (finalized.reconciliation.status !== "passed") {
      throw new Error(
        `Production Coin cutover reconciliation failed with ${finalized.reconciliation.discrepancyCount} discrepancies.`,
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
      reconciliation: finalized.reconciliation,
      noOp: finalized.completionAlreadyExists && migration.noOp,
    };
  } finally {
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
    databasePrincipalSha256: string;
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
    databasePrincipalSha256: expected.databasePrincipalSha256,
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

type CompletionEvidence = {
  migration_version: string;
  database_target: unknown;
  reconciliation_report: CoinReconciliationReport;
  reconciliation_status: string;
  reconciliation_dry_run: boolean;
  reconciliation_discrepancy_count: number;
  reconciliation_report_matches: boolean;
};

async function loadCompletionEvidence(
  client: PoolClient,
  marker: ProductionCoinCutoverReleaseMarker,
): Promise<CompletionEvidence | null> {
  const completion = await client.query<CompletionEvidence>(
    `select
       completions.migration_version,
       completions.database_target,
       completions.reconciliation_report,
       runs.status as reconciliation_status,
       runs.dry_run as reconciliation_dry_run,
       runs.discrepancy_count as reconciliation_discrepancy_count,
       completions.reconciliation_report = runs.report
         as reconciliation_report_matches
     from coin_production_cutover_completions completions
     join money_reconciliation_runs runs
       on runs.id = completions.reconciliation_run_id
     where completions.release_marker = $1`,
    [marker.releaseMarker],
  );
  return completion.rows[0] ?? null;
}

async function assertCoinStateAndCutoverRun(
  client: PoolClient,
  marker: ProductionCoinCutoverReleaseMarker,
) {
  const state = await client.query<{
    active_system: string;
    legacy_writes_enabled: boolean;
    migration_version: string | null;
    cutover_completed_at: Date | null;
    completed_run_exists: boolean;
  }>(
    `select
       state.active_system,
       state.legacy_writes_enabled,
       state.migration_version,
       state.cutover_completed_at,
       exists (
         select 1
         from coin_cutover_runs runs
         where runs.migration_version = $1
           and runs.status = 'completed'
           and runs.completed_at is not null
       ) as completed_run_exists
     from money_system_state state
     where state.singleton = true`,
    [marker.migrationVersion],
  );
  const current = state.rows[0];
  if (
    !current ||
    current.active_system !== "coin" ||
    current.legacy_writes_enabled !== false ||
    current.migration_version !== marker.migrationVersion ||
    current.cutover_completed_at === null ||
    current.completed_run_exists !== true
  ) {
    throw new Error(
      "Production Coin cutover blocked: completion evidence does not match the active sealed Coin state and migration run.",
    );
  }
}

async function assertCompletedCutoverEvidence(
  client: PoolClient,
  marker: ProductionCoinCutoverReleaseMarker,
  databaseTarget: CoinCutoverDatabaseTarget,
  completion: CompletionEvidence,
  options: { lockSnapshotHeader?: boolean } = {},
) {
  if (
    completion.migration_version !== marker.migrationVersion ||
    !stableCoinCutoverDatabaseTargetsMatch(
      completion.database_target,
      databaseTarget,
    ) ||
    completion.reconciliation_status !== "passed" ||
    completion.reconciliation_dry_run !== true ||
    completion.reconciliation_discrepancy_count !== 0 ||
    completion.reconciliation_report.status !== "passed" ||
    completion.reconciliation_report.discrepancyCount !== 0 ||
    completion.reconciliation_report_matches !== true
  ) {
    throw new Error(
      "Production Coin cutover blocked: release marker completion evidence is inconsistent or belongs to another database target.",
    );
  }
  await assertCoinStateAndCutoverRun(client, marker);
  return verifyProductionSnapshotEvidence(
    client,
    {
      releaseMarker: marker.releaseMarker,
      databaseTarget,
    },
    { lockHeader: options.lockSnapshotHeader },
  );
}

export async function tryCompletedCutoverFastPath(
  client: PoolClient,
  marker: ProductionCoinCutoverReleaseMarker,
  databaseTarget: CoinCutoverDatabaseTarget,
) {
  await client.query("begin isolation level repeatable read read only");
  try {
    const completion = await loadCompletionEvidence(client, marker);
    if (!completion) {
      await client.query("rollback");
      return null;
    }
    const snapshot = await assertCompletedCutoverEvidence(
      client,
      marker,
      databaseTarget,
      completion,
    );
    const reconciliation = await runCoinReconciliation(client, new Date(), {
      excludedCategories: ["outbox_delivery"],
    });
    if (reconciliation.status !== "passed") {
      throw new Error(
        `Production Coin cutover repeat verification failed with ${reconciliation.discrepancyCount} financial discrepancies.`,
      );
    }
    await client.query("commit");
    const inspection = snapshot.inspectionReport;
    return {
      inspection,
      migration: buildVerifiedNoOpMigrationReport(
        inspection,
        reconciliation,
      ),
      reconciliation,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function finalizeProductionCutover(
  client: PoolClient,
  marker: ProductionCoinCutoverReleaseMarker,
  databaseTarget: CoinCutoverDatabaseTarget,
) {
  // READ COMMITTED is intentional: a concurrent caller may commit completion
  // while this transaction is waiting for the xact advisory lock. The first
  // post-lock read must observe that commit instead of retaining a pre-wait
  // REPEATABLE READ snapshot and racing the unique release marker.
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `${PRODUCTION_COIN_CUTOVER_LOCK}:${marker.releaseMarker}`,
    ]);
    const completion = await loadCompletionEvidence(client, marker);
    if (completion) {
      await assertCompletedCutoverEvidence(
        client,
        marker,
        databaseTarget,
        completion,
        { lockSnapshotHeader: true },
      );
      const reconciliation = await runCoinReconciliation(client, new Date(), {
        excludedCategories: ["outbox_delivery"],
      });
      if (reconciliation.status !== "passed") {
        throw new Error(
          `Production Coin cutover repeat verification failed with ${reconciliation.discrepancyCount} financial discrepancies.`,
        );
      }
      await client.query("commit");
      return { completionAlreadyExists: true, reconciliation };
    }

    await assertCoinStateAndCutoverRun(client, marker);
    await verifyProductionSnapshotEvidence(
      client,
      {
        releaseMarker: marker.releaseMarker,
        databaseTarget,
      },
      { lockHeader: true },
    );
    const reconciliation = await runCoinReconciliation(client);
    const reconciliationRunId =
      await persistCoinReconciliationReportInTransaction(
        client,
        reconciliation,
      );
    if (!reconciliationRunId) {
      throw new Error(
        "Production Coin cutover blocked: reconciliation evidence was not persisted.",
      );
    }
    if (reconciliation.status === "passed") {
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
    }
    await client.query("commit");
    return { completionAlreadyExists: false, reconciliation };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function buildVerifiedNoOpMigrationReport(
  inspection: MigrationReport,
  reconciliation: CoinReconciliationReport,
): MigrationReport {
  const availableCoinMicros =
    reconciliation.totals.availableCoinMicros ?? "0";
  const reservedCoinMicros = reconciliation.totals.reservedCoinMicros ?? "0";
  const totals = {
    accounts: reconciliation.totals.accountCount ?? "0",
    availableCoinMicros,
    reservedCoinMicros,
    totalCoinMicros: (
      BigInt(availableCoinMicros) + BigInt(reservedCoinMicros)
    ).toString(),
  };
  return {
    ...inspection,
    mode: "apply",
    cutoverState: "coin",
    beforeCoinTotals: totals,
    expectedAfterCoinTotals: totals,
    afterCoinTotals: totals,
    noOp: true,
  };
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
