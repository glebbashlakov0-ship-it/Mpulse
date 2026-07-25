import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { auditPostgresTestDatabaseSafety } from "../src/postgresTestDatabaseSafety.js";

export const COIN_MIGRATION_VERSION = "coins-v1-legacy-usdt-parity";

type MigrationMode = "dry-run" | "apply";

type LegacyBalanceRow = {
  user_id: string;
  available_amount: string;
  reserved_amount: string;
  pending_deposit_amount: string;
  pending_withdrawal_amount: string;
  available_coin_micros: string;
  reserved_coin_micros: string;
  pending_deposit_coin_micros: string;
  pending_withdrawal_coin_micros: string;
  pending_deposit_count: string;
  pending_withdrawal_count: string;
  unsafe_precision: boolean;
  coin_account_exists: boolean;
  already_migrated: boolean;
};

type CoinTotals = {
  accounts: bigint;
  available: bigint;
  reserved: bigint;
};

type PendingLegacyOperations = {
  depositCount: bigint;
  withdrawalCount: bigint;
  depositCoinMicros: bigint;
  withdrawalCoinMicros: bigint;
};

export type MigrationReport = {
  mode: MigrationMode;
  migrationVersion: string;
  policy: string;
  cutoverState: string;
  accounts: number;
  alreadyMigrated: number;
  accountsToMigrate: number;
  unsafePrecisionUsers: string[];
  unsafeProjectionRows: string[];
  negativeBalanceUsers: string[];
  legacyAvailableCoinMicros: string;
  legacyReservedCoinMicros: string;
  pendingDepositCount: string;
  pendingWithdrawalCount: string;
  pendingDepositCoinMicros: string;
  pendingWithdrawalCoinMicros: string;
  beforeCoinTotals: PublicCoinTotals;
  expectedAfterCoinTotals: PublicCoinTotals;
  afterCoinTotals?: PublicCoinTotals;
  noOp: boolean;
};

type PublicCoinTotals = {
  accounts: string;
  availableCoinMicros: string;
  reservedCoinMicros: string;
  totalCoinMicros: string;
};

export type CoinCutoverDatabaseTarget = {
  urlHostname: string;
  urlPort: number;
  urlDatabaseName: string;
  databasePrincipalSha256: string;
  connectedDatabaseName: string;
  serverAddress: string | null;
  serverPort: number | null;
  ssl: boolean;
  fingerprint: string;
};

export type CoinCutoverSnapshotOptions = {
  releaseMarker: string;
  databaseTarget: CoinCutoverDatabaseTarget;
};

export type VerifiedCoinCutoverSnapshot = {
  inspectionReport: MigrationReport;
  balanceSnapshotSha256: string;
  legacyAccountCount: number;
};

type CoinCutoverBalanceSnapshotRow = {
  userId: string;
  legacyAvailableAmount: string;
  legacyReservedAmount: string;
  availableCoinMicros: string;
  reservedCoinMicros: string;
  pendingDepositAmount: string;
  pendingWithdrawalAmount: string;
  pendingDepositCount: string;
  pendingWithdrawalCount: string;
};

export async function inspectMigration(
  client: PoolClient,
): Promise<MigrationReport> {
  await client.query("begin isolation level repeatable read read only");
  try {
    const rows = await loadLegacyBalances(client);
    const pending = await loadPendingLegacyOperations(client);
    const unsafeProjectionRows = await loadUnsafeProjectionRows(client);
    const before = await loadCoinTotals(client);
    const cutoverState = await loadCutoverState(client);
    const report = buildReport(
      "dry-run",
      cutoverState,
      rows,
      before,
      pending,
      unsafeProjectionRows,
    );
    await client.query("rollback");
    return report;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function applyMigration(
  client: PoolClient,
  snapshot?: CoinCutoverSnapshotOptions,
): Promise<MigrationReport> {
  await client.query("begin isolation level serializable");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      "market_pulse:coins_cutover",
    ]);
    await client.query(
      `lock table users, ledger_entries, wallet_deposit_events,
         wallet_deposit_intents, wallet_withdrawal_requests, trades, positions,
         market_settlements, market_settlement_payouts
       in share row exclusive mode`,
    );

    const stateResult = await client.query<{ active_system: string }>(
      `select active_system
       from money_system_state
       where singleton = true
       for update`,
    );
    const initialState = stateResult.rows[0]?.active_system ?? "missing";
    const rows = await loadLegacyBalances(client);
    const pending = await loadPendingLegacyOperations(client);
    const unsafeProjectionRows = await loadUnsafeProjectionRows(client);
    const before = await loadCoinTotals(client);
    const preliminary = buildReport(
      "apply",
      initialState,
      rows,
      before,
      pending,
      unsafeProjectionRows,
    );

    if (initialState === "coin") {
      await assertCompletedCutoverRun(client);
      if (snapshot) {
        await verifyProductionSnapshotEvidence(client, snapshot);
      }
      await client.query("commit");
      return {
        ...preliminary,
        afterCoinTotals: toPublicTotals(before),
        noOp: true,
      };
    }

    if (pending.depositCount > 0n || pending.withdrawalCount > 0n) {
      throw new Error(
        `Migration blocked: legacy pending operations must be drained first ` +
          `(deposits=${pending.depositCount.toString()}, ` +
          `withdrawals=${pending.withdrawalCount.toString()}).`,
      );
    }

    if (
      preliminary.unsafePrecisionUsers.length > 0 ||
      preliminary.unsafeProjectionRows.length > 0 ||
      preliminary.negativeBalanceUsers.length > 0
    ) {
      throw new Error(
        "Migration blocked: legacy rows contain invalid precision, range, or negative balances.",
      );
    }

    if (initialState !== "legacy" && initialState !== "migrating") {
      throw new Error(`Migration blocked: unexpected cutover state ${initialState}.`);
    }

    if (snapshot) {
      await persistProductionSnapshot(client, snapshot, rows, preliminary);
    }

    await client.query(
      `update money_system_state
       set active_system = 'migrating',
           legacy_writes_enabled = false,
           migration_version = $1,
           updated_at = now()
       where singleton = true`,
      [COIN_MIGRATION_VERSION],
    );

    for (const row of rows) {
      if (!row.already_migrated) {
        await migrateRow(client, row);
      }
    }
    await migrateLegacyMoneyProjections(client);

    const after = await loadCoinTotals(client);
    const expected = addTotals(before, totalsForUnmigratedRows(rows));
    assertTotalsEqual(after, expected);

    await client.query(
      `insert into coin_cutover_runs (
         migration_version, status, legacy_account_count,
         legacy_available_coin_micros, legacy_reserved_coin_micros,
         before_available_coin_micros, before_reserved_coin_micros,
         after_available_coin_micros, after_reserved_coin_micros,
         report, completed_at
       ) values (
         $1, 'completed', $2, $3::bigint, $4::bigint, $5::bigint, $6::bigint,
         $7::bigint, $8::bigint, $9::jsonb, now()
       )
       on conflict (migration_version) do nothing`,
      [
        COIN_MIGRATION_VERSION,
        rows.length,
        sumRows(rows, "available_coin_micros").toString(),
        sumRows(rows, "reserved_coin_micros").toString(),
        before.available.toString(),
        before.reserved.toString(),
        after.available.toString(),
        after.reserved.toString(),
        JSON.stringify({
          policy: "1 legacy internal USDT-like unit = 1 Coin",
          pendingDepositCoinMicros: sumRows(
            rows,
            "pending_deposit_coin_micros",
          ).toString(),
          pendingWithdrawalCoinMicros: sumRows(
            rows,
            "pending_withdrawal_coin_micros",
          ).toString(),
        }),
      ],
    );
    await client.query(
      `update money_system_state
       set active_system = 'coin',
           legacy_writes_enabled = false,
           cutover_completed_at = coalesce(cutover_completed_at, now()),
           updated_at = now()
       where singleton = true`,
    );
    await client.query("commit");

    return {
      ...buildReport("apply", "coin", rows, before, pending, unsafeProjectionRows),
      afterCoinTotals: toPublicTotals(after),
      noOp: false,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function assertCompletedCutoverRun(client: PoolClient) {
  const completed = await client.query<{ exists: boolean }>(
    `select exists (
       select 1
       from coin_cutover_runs
       where migration_version = $1 and status = 'completed'
     ) as exists`,
    [COIN_MIGRATION_VERSION],
  );
  if (completed.rows[0]?.exists !== true) {
    throw new Error(
      "Migration blocked: Coin state has no completed cutover run for this migration version.",
    );
  }
}

export async function verifyProductionSnapshotEvidence(
  client: PoolClient,
  snapshot: CoinCutoverSnapshotOptions,
  options: { lockHeader?: boolean } = {},
): Promise<VerifiedCoinCutoverSnapshot> {
  const existing = await client.query<{
    migration_version: string;
    database_target: unknown;
    balance_snapshot_sha256: string;
    legacy_account_count: number;
    inspection_report: MigrationReport;
  }>(
    `select migration_version, database_target, balance_snapshot_sha256,
            legacy_account_count, inspection_report
     from coin_cutover_snapshots
     where release_marker = $1
     ${options.lockHeader ? "for update" : ""}`,
    [snapshot.releaseMarker],
  );
  const header = existing.rows[0];
  if (
    !header ||
    header.migration_version !== COIN_MIGRATION_VERSION ||
    !stableCoinCutoverDatabaseTargetsMatch(
      header.database_target,
      snapshot.databaseTarget,
    )
  ) {
    throw new Error(
      "Migration blocked: completed Coin state lacks matching pre-cutover production snapshot evidence.",
    );
  }

  const storedRows = await client.query<{
    user_id: string;
    legacy_available_amount: string;
    legacy_reserved_amount: string;
    available_coin_micros: string;
    reserved_coin_micros: string;
    pending_deposit_amount: string;
    pending_withdrawal_amount: string;
    pending_deposit_count: string;
    pending_withdrawal_count: string;
  }>(
    `select
       user_id::text, legacy_available_amount::text,
       legacy_reserved_amount::text, available_coin_micros::text,
       reserved_coin_micros::text, pending_deposit_amount::text,
       pending_withdrawal_amount::text, pending_deposit_count::text,
       pending_withdrawal_count::text
     from coin_cutover_balance_snapshots
     where release_marker = $1
     order by user_id`,
    [snapshot.releaseMarker],
  );
  const canonicalRows = storedRows.rows.map((row) => ({
    userId: row.user_id,
    legacyAvailableAmount: normalizeSnapshotAmount(row.legacy_available_amount),
    legacyReservedAmount: normalizeSnapshotAmount(row.legacy_reserved_amount),
    availableCoinMicros: row.available_coin_micros,
    reservedCoinMicros: row.reserved_coin_micros,
    pendingDepositAmount: normalizeSnapshotAmount(row.pending_deposit_amount),
    pendingWithdrawalAmount: normalizeSnapshotAmount(
      row.pending_withdrawal_amount,
    ),
    pendingDepositCount: row.pending_deposit_count,
    pendingWithdrawalCount: row.pending_withdrawal_count,
  }));
  const recomputedSha256 =
    computeCoinCutoverBalanceSnapshotSha256(canonicalRows);
  if (
    storedRows.rows.length !== header.legacy_account_count ||
    recomputedSha256 !== header.balance_snapshot_sha256
  ) {
    throw new Error(
      "Migration blocked: production snapshot row count or digest does not match its sealed header.",
    );
  }

  return {
    inspectionReport: header.inspection_report,
    balanceSnapshotSha256: header.balance_snapshot_sha256,
    legacyAccountCount: header.legacy_account_count,
  };
}

async function persistProductionSnapshot(
  client: PoolClient,
  snapshot: CoinCutoverSnapshotOptions,
  rows: LegacyBalanceRow[],
  report: MigrationReport,
) {
  const existing = await client.query<{ release_marker: string }>(
    `select release_marker
     from coin_cutover_snapshots
     where release_marker = $1`,
    [snapshot.releaseMarker],
  );
  if (existing.rows.length > 0) {
    throw new Error(
      "Migration blocked: production snapshot marker already exists before cutover completion.",
    );
  }

  const snapshotRows: CoinCutoverBalanceSnapshotRow[] = rows.map((row) => ({
    userId: row.user_id,
    legacyAvailableAmount: normalizeSnapshotAmount(row.available_amount),
    legacyReservedAmount: normalizeSnapshotAmount(row.reserved_amount),
    availableCoinMicros: row.available_coin_micros,
    reservedCoinMicros: row.reserved_coin_micros,
    pendingDepositAmount: normalizeSnapshotAmount(row.pending_deposit_amount),
    pendingWithdrawalAmount: normalizeSnapshotAmount(
      row.pending_withdrawal_amount,
    ),
    pendingDepositCount: row.pending_deposit_count,
    pendingWithdrawalCount: row.pending_withdrawal_count,
  }));
  const balanceSnapshotSha256 =
    computeCoinCutoverBalanceSnapshotSha256(snapshotRows);

  await client.query(
    `insert into coin_cutover_snapshots (
       release_marker, migration_version, database_target,
       balance_snapshot_sha256, legacy_account_count,
       legacy_available_coin_micros, legacy_reserved_coin_micros,
       pending_deposit_count, pending_withdrawal_count, inspection_report
     ) values (
       $1, $2, $3::jsonb, $4, $5, $6::bigint, $7::bigint,
       $8::bigint, $9::bigint, $10::jsonb
     )`,
    [
      snapshot.releaseMarker,
      COIN_MIGRATION_VERSION,
      JSON.stringify(snapshot.databaseTarget),
      balanceSnapshotSha256,
      rows.length,
      report.legacyAvailableCoinMicros,
      report.legacyReservedCoinMicros,
      report.pendingDepositCount,
      report.pendingWithdrawalCount,
      JSON.stringify(report),
    ],
  );

  for (const row of snapshotRows) {
    await client.query(
      `insert into coin_cutover_balance_snapshots (
         release_marker, user_id, legacy_available_amount,
         legacy_reserved_amount, available_coin_micros, reserved_coin_micros,
         pending_deposit_amount, pending_withdrawal_amount,
         pending_deposit_count, pending_withdrawal_count
       ) values (
         $1, $2, $3::numeric, $4::numeric, $5::bigint, $6::bigint,
         $7::numeric, $8::numeric, $9::bigint, $10::bigint
       )`,
      [
        snapshot.releaseMarker,
        row.userId,
        row.legacyAvailableAmount,
        row.legacyReservedAmount,
        row.availableCoinMicros,
        row.reservedCoinMicros,
        row.pendingDepositAmount,
        row.pendingWithdrawalAmount,
        row.pendingDepositCount,
        row.pendingWithdrawalCount,
      ],
    );
  }
}

export function stableCoinCutoverDatabaseTargetsMatch(
  recorded: unknown,
  expected: CoinCutoverDatabaseTarget,
) {
  if (!isUnknownRecord(recorded)) {
    return false;
  }
  return (
    recorded.urlHostname === expected.urlHostname &&
    recorded.urlPort === expected.urlPort &&
    recorded.urlDatabaseName === expected.urlDatabaseName &&
    recorded.databasePrincipalSha256 === expected.databasePrincipalSha256 &&
    recorded.connectedDatabaseName === expected.connectedDatabaseName &&
    recorded.ssl === expected.ssl &&
    recorded.fingerprint === expected.fingerprint
  );
}

export function computeCoinCutoverBalanceSnapshotSha256(
  rows: readonly CoinCutoverBalanceSnapshotRow[],
) {
  const ordered = [...rows].sort((left, right) =>
    left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0,
  );
  return createHash("sha256")
    .update(JSON.stringify(ordered))
    .digest("hex");
}

function normalizeSnapshotAmount(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3]?.length ?? 0) > 10) {
    throw new Error(
      "Migration blocked: snapshot amount cannot be represented exactly at numeric(30,10).",
    );
  }
  const sign = match[1] === "-" && !/^0*$/.test(`${match[2]}${match[3] ?? ""}`)
    ? "-"
    : "";
  return `${sign}${match[2]}.${(match[3] ?? "").padEnd(10, "0")}`;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadLegacyBalances(client: PoolClient) {
  const result = await client.query<LegacyBalanceRow>(
    `with ledger_balances as (
       select
         users.id as user_id,
         coalesce(sum(case
           when ledger.entry_type in ('credit', 'trade_credit') then ledger.amount
           when ledger.entry_type in ('debit', 'trade_debit') then -ledger.amount
           when ledger.entry_type = 'hold' then -ledger.amount
           when ledger.entry_type = 'release' then ledger.amount
           when ledger.entry_type = 'adjustment'
             and ledger.metadata ->> 'adjustmentDirection' = 'debit' then -ledger.amount
           when ledger.entry_type = 'adjustment' then ledger.amount
           else 0 end), 0) as available_amount,
         coalesce(sum(case
           when ledger.entry_type = 'hold' then ledger.amount
           when ledger.entry_type = 'release' then -ledger.amount
           else 0 end), 0) as reserved_amount,
         coalesce(bool_or(
           ledger.amount is not null
           and ledger.amount * 1000000 <> trunc(ledger.amount * 1000000)
         ), false) as unsafe_precision
       from users
       left join ledger_entries ledger
         on ledger.user_id = users.id and ledger.asset = 'USDT'
       group by users.id
     ),
     pending_deposits as (
       select user_id, count(*) as pending_count, coalesce(sum(amount), 0) as pending_amount
       from wallet_deposit_events
       where user_id is not null
         and status in ('detected', 'confirmed', 'manual_review')
       group by user_id
     ),
     pending_withdrawals as (
       select user_id, count(*) as pending_count, coalesce(sum(amount), 0) as pending_amount
       from wallet_withdrawal_requests
       where status in (
         'draft', 'pending_review', 'approved', 'approved_for_review',
         'broadcast_pending'
       )
       group by user_id
     )
     select
       balances.user_id,
       balances.available_amount::text,
       balances.reserved_amount::text,
       coalesce(deposits.pending_amount, 0)::text as pending_deposit_amount,
       coalesce(withdrawals.pending_amount, 0)::text as pending_withdrawal_amount,
       trunc(balances.available_amount * 1000000)::text
         as available_coin_micros,
       trunc(balances.reserved_amount * 1000000)::text
         as reserved_coin_micros,
       trunc(coalesce(deposits.pending_amount, 0) * 1000000)::text
         as pending_deposit_coin_micros,
       trunc(coalesce(withdrawals.pending_amount, 0) * 1000000)::text
         as pending_withdrawal_coin_micros,
       coalesce(deposits.pending_count, 0)::text as pending_deposit_count,
       coalesce(withdrawals.pending_count, 0)::text as pending_withdrawal_count,
       balances.unsafe_precision
         or abs(balances.available_amount * 1000000) > 9223372036854775807
         or abs(balances.reserved_amount * 1000000) > 9223372036854775807
         or coalesce(deposits.pending_amount * 1000000
           <> trunc(deposits.pending_amount * 1000000), false)
         or coalesce(withdrawals.pending_amount * 1000000
           <> trunc(withdrawals.pending_amount * 1000000), false)
         as unsafe_precision,
       accounts.user_id is not null as coin_account_exists,
       markers.user_id is not null as already_migrated
     from ledger_balances balances
     left join pending_deposits deposits on deposits.user_id = balances.user_id
     left join pending_withdrawals withdrawals on withdrawals.user_id = balances.user_id
     left join coin_accounts accounts on accounts.user_id = balances.user_id
     left join coin_migration_markers markers
       on markers.user_id = balances.user_id and markers.migration_version = $1
     order by balances.user_id`,
    [COIN_MIGRATION_VERSION],
  );
  return result.rows;
}

async function loadPendingLegacyOperations(
  client: PoolClient,
): Promise<PendingLegacyOperations> {
  const result = await client.query<{
    deposit_count: string;
    withdrawal_count: string;
    deposit_coin_micros: string;
    withdrawal_coin_micros: string;
  }>(
    `with pending_deposits as (
       select count(*) as pending_count,
              coalesce(trunc(sum(amount) * 1000000), 0) as pending_coin_micros
       from wallet_deposit_events
       where status in ('detected', 'confirmed', 'manual_review')
     ),
     pending_withdrawals as (
       select count(*) as pending_count,
              coalesce(trunc(sum(amount) * 1000000), 0) as pending_coin_micros
       from wallet_withdrawal_requests
       where status in (
         'draft', 'pending_review', 'approved', 'approved_for_review',
         'broadcast_pending'
       )
     )
     select
       pending_deposits.pending_count::text as deposit_count,
       pending_withdrawals.pending_count::text as withdrawal_count,
       pending_deposits.pending_coin_micros::text as deposit_coin_micros,
       pending_withdrawals.pending_coin_micros::text as withdrawal_coin_micros
     from pending_deposits cross join pending_withdrawals`,
  );
  const row = result.rows[0];
  return {
    depositCount: BigInt(row?.deposit_count ?? "0"),
    withdrawalCount: BigInt(row?.withdrawal_count ?? "0"),
    depositCoinMicros: BigInt(row?.deposit_coin_micros ?? "0"),
    withdrawalCoinMicros: BigInt(row?.withdrawal_coin_micros ?? "0"),
  };
}

async function loadUnsafeProjectionRows(client: PoolClient) {
  const result = await client.query<{ entity: string }>(
    `select entity
     from (
       select 'trade:' || id::text as entity
       from trades
       where amount < 0
          or amount * 1000000 <> trunc(amount * 1000000)
          or abs(amount * 1000000) > 9223372036854775807
          or shares <= 0
          or shares * 1000000 <> trunc(shares * 1000000)
          or abs(shares * 1000000) > 9223372036854775807
          or price <= 0
          or price * 1000000000 <> trunc(price * 1000000000)
          or abs(price * 1000000000) > 9223372036854775807

       union all

       select 'position:' || id::text
       from positions
       where total_cost < 0
          or total_cost * 1000000 <> trunc(total_cost * 1000000)
          or abs(total_cost * 1000000) > 9223372036854775807
          or shares < 0
          or shares * 1000000 <> trunc(shares * 1000000)
          or abs(shares * 1000000) > 9223372036854775807
          or (
            average_price is not null
            and (
              average_price <= 0
              or average_price * 1000000000 <> trunc(average_price * 1000000000)
              or abs(average_price * 1000000000) > 9223372036854775807
            )
          )
          or (
            last_price is not null
            and (
              last_price <= 0
              or last_price * 1000000000 <> trunc(last_price * 1000000000)
              or abs(last_price * 1000000000) > 9223372036854775807
            )
          )

       union all

       select 'settlement:' || id::text
       from market_settlements
       where total_pool < 0 or winning_pool < 0 or platform_fee < 0
          or distributable_pool < 0
          or total_pool * 1000000 <> trunc(total_pool * 1000000)
          or winning_pool * 1000000 <> trunc(winning_pool * 1000000)
          or platform_fee * 1000000 <> trunc(platform_fee * 1000000)
          or distributable_pool * 1000000 <> trunc(distributable_pool * 1000000)
          or greatest(
            abs(total_pool * 1000000),
            abs(winning_pool * 1000000),
            abs(platform_fee * 1000000),
            abs(distributable_pool * 1000000)
          ) > 9223372036854775807

       union all

       select 'settlement_payout:' || id::text
       from market_settlement_payouts
       where original_stake < 0 or payout < 0
          or original_stake * 1000000 <> trunc(original_stake * 1000000)
          or payout * 1000000 <> trunc(payout * 1000000)
          or profit * 1000000 <> trunc(profit * 1000000)
          or greatest(
            abs(original_stake * 1000000),
            abs(payout * 1000000),
            abs(profit * 1000000)
          ) > 9223372036854775807
     ) unsafe
     order by entity`,
  );
  return result.rows.map((row) => row.entity);
}

async function migrateLegacyMoneyProjections(client: PoolClient) {
  await client.query(
    `update trades
     set amount_coin_micros = trunc(amount * 1000000)::bigint,
         price_nanos = trunc(price * 1000000000)::bigint,
         coin_migration_version = $1,
         metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{coinMigrationVersion}',
           to_jsonb($1::text),
           true
         ),
         updated_at = now()
     where coin_migration_version is distinct from $1`,
    [COIN_MIGRATION_VERSION],
  );
  await client.query(
    `update positions
     set total_cost_coin_micros = trunc(total_cost * 1000000)::bigint,
         average_price_nanos = case when average_price is null then null
           else trunc(average_price * 1000000000)::bigint end,
         last_price_nanos = case when last_price is null then null
           else trunc(last_price * 1000000000)::bigint end,
         coin_migration_version = $1,
         updated_at = now()
     where coin_migration_version is distinct from $1`,
    [COIN_MIGRATION_VERSION],
  );
  await client.query(
    `update market_settlements
     set total_pool_coin_micros = trunc(total_pool * 1000000)::bigint,
         winning_pool_coin_micros = trunc(winning_pool * 1000000)::bigint,
         platform_fee_coin_micros = trunc(platform_fee * 1000000)::bigint,
         distributable_pool_coin_micros =
           trunc(distributable_pool * 1000000)::bigint,
         coin_migration_version = $1,
         metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{coinMigrationVersion}',
           to_jsonb($1::text),
           true
         ),
         updated_at = now()
     where coin_migration_version is distinct from $1`,
    [COIN_MIGRATION_VERSION],
  );
  await client.query(
    `update market_settlement_payouts
     set original_stake_coin_micros = trunc(original_stake * 1000000)::bigint,
         payout_coin_micros = trunc(payout * 1000000)::bigint,
         profit_coin_micros = trunc(profit * 1000000)::bigint,
         coin_migration_version = $1,
         metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{coinMigrationVersion}',
           to_jsonb($1::text),
           true
         ),
         updated_at = now()
     where coin_migration_version is distinct from $1`,
    [COIN_MIGRATION_VERSION],
  );
}

async function migrateRow(client: PoolClient, row: LegacyBalanceRow) {
  const available = BigInt(row.available_coin_micros);
  const reserved = BigInt(row.reserved_coin_micros);
  await client.query(
    `insert into coin_accounts (
       user_id, available_coin_micros, reserved_coin_micros, migration_version
     ) values ($1, 0, 0, $2)
     on conflict (user_id) do update
       set migration_version = excluded.migration_version`,
    [row.user_id, COIN_MIGRATION_VERSION],
  );

  let ledgerEntryId: string | null = null;
  if (available !== 0n || reserved !== 0n) {
    const entry = await client.query<{ id: string }>(
      `select id from coin_post_ledger_entry(
        $1, 'migration_credit', $2::bigint, $3::bigint, $4,
        'legacy_usdt_ledger', $5, 'Legacy dollar-equivalent balance Coins cutover',
        null, null, null, null, $6::jsonb
      )`,
      [
        row.user_id,
        available.toString(),
        reserved.toString(),
        `migration:${COIN_MIGRATION_VERSION}:${row.user_id}`,
        row.user_id,
        JSON.stringify({
          conversionPolicy: "1 legacy internal USDT-like unit = 1 Coin",
          pendingDepositCoinMicros: row.pending_deposit_coin_micros,
          pendingWithdrawalCoinMicros: row.pending_withdrawal_coin_micros,
        }),
      ],
    );
    ledgerEntryId = entry.rows[0]?.id ?? null;
  }

  await client.query(
    `insert into coin_migration_markers (
       user_id, migration_version, legacy_available_amount, legacy_reserved_amount,
       migrated_available_coin_micros, migrated_reserved_coin_micros,
       ledger_entry_id, migration_metadata
     ) values ($1, $2, $3::numeric, $4::numeric, $5::bigint, $6::bigint, $7, $8::jsonb)
     on conflict (user_id, migration_version) do nothing`,
    [
      row.user_id,
      COIN_MIGRATION_VERSION,
      row.available_amount,
      row.reserved_amount,
      available.toString(),
      reserved.toString(),
      ledgerEntryId,
      JSON.stringify({
        sourceAsset: "USDT",
        targetCurrency: "COIN",
        conversionPolicy: "1 legacy internal USDT-like unit = 1 Coin",
        pendingDepositAmount: row.pending_deposit_amount,
        pendingDepositCoinMicros: row.pending_deposit_coin_micros,
        pendingDepositCount: row.pending_deposit_count,
        pendingWithdrawalAmount: row.pending_withdrawal_amount,
        pendingWithdrawalCoinMicros: row.pending_withdrawal_coin_micros,
        pendingWithdrawalCount: row.pending_withdrawal_count,
      }),
    ],
  );
}

function buildReport(
  reportMode: MigrationMode,
  cutoverState: string,
  rows: LegacyBalanceRow[],
  before: CoinTotals,
  pending: PendingLegacyOperations,
  unsafeProjectionRows: string[],
): MigrationReport {
  const unmigrated = rows.filter((row) => !row.already_migrated);
  const expectedAfter = addTotals(before, totalsForUnmigratedRows(rows));
  return {
    mode: reportMode,
    migrationVersion: COIN_MIGRATION_VERSION,
    policy: "1 legacy internal USDT-like unit = 1 Coin; exact to six decimals",
    cutoverState,
    accounts: rows.length,
    alreadyMigrated: rows.length - unmigrated.length,
    accountsToMigrate: unmigrated.length,
    unsafePrecisionUsers: rows
      .filter((row) => row.unsafe_precision)
      .map((row) => row.user_id),
    unsafeProjectionRows,
    negativeBalanceUsers: rows
      .filter(
        (row) =>
          BigInt(row.available_coin_micros) < 0n ||
          BigInt(row.reserved_coin_micros) < 0n,
      )
      .map((row) => row.user_id),
    legacyAvailableCoinMicros: sumRows(rows, "available_coin_micros").toString(),
    legacyReservedCoinMicros: sumRows(rows, "reserved_coin_micros").toString(),
    pendingDepositCount: pending.depositCount.toString(),
    pendingWithdrawalCount: pending.withdrawalCount.toString(),
    pendingDepositCoinMicros: pending.depositCoinMicros.toString(),
    pendingWithdrawalCoinMicros: pending.withdrawalCoinMicros.toString(),
    beforeCoinTotals: toPublicTotals(before),
    expectedAfterCoinTotals: toPublicTotals(expectedAfter),
    noOp: unmigrated.length === 0,
  };
}

async function loadCoinTotals(client: PoolClient): Promise<CoinTotals> {
  const result = await client.query<{
    accounts: string;
    available: string;
    reserved: string;
  }>(
    `select count(*)::text as accounts,
            coalesce(sum(available_coin_micros), 0)::text as available,
            coalesce(sum(reserved_coin_micros), 0)::text as reserved
     from coin_accounts`,
  );
  const row = result.rows[0];
  return {
    accounts: BigInt(row?.accounts ?? "0"),
    available: BigInt(row?.available ?? "0"),
    reserved: BigInt(row?.reserved ?? "0"),
  };
}

async function loadCutoverState(client: PoolClient) {
  const result = await client.query<{ active_system: string }>(
    `select active_system from money_system_state where singleton = true`,
  );
  return result.rows[0]?.active_system ?? "missing";
}

function totalsForUnmigratedRows(rows: LegacyBalanceRow[]): CoinTotals {
  const unmigrated = rows.filter((row) => !row.already_migrated);
  return {
    accounts: BigInt(unmigrated.filter((row) => !row.coin_account_exists).length),
    available: sumRows(unmigrated, "available_coin_micros"),
    reserved: sumRows(unmigrated, "reserved_coin_micros"),
  };
}

function sumRows(
  rows: LegacyBalanceRow[],
  key:
    | "available_coin_micros"
    | "reserved_coin_micros"
    | "pending_deposit_coin_micros"
    | "pending_withdrawal_coin_micros",
) {
  return rows.reduce((sum, row) => sum + BigInt(row[key]), 0n);
}

function addTotals(left: CoinTotals, right: CoinTotals): CoinTotals {
  return {
    accounts: left.accounts + right.accounts,
    available: left.available + right.available,
    reserved: left.reserved + right.reserved,
  };
}

function assertTotalsEqual(actual: CoinTotals, expected: CoinTotals) {
  if (
    actual.accounts !== expected.accounts ||
    actual.available !== expected.available ||
    actual.reserved !== expected.reserved
  ) {
    throw new Error(
      `Migration totals mismatch: expected ${JSON.stringify(
        toPublicTotals(expected),
      )}, received ${JSON.stringify(toPublicTotals(actual))}.`,
    );
  }
}

function toPublicTotals(totals: CoinTotals): PublicCoinTotals {
  return {
    accounts: totals.accounts.toString(),
    availableCoinMicros: totals.available.toString(),
    reservedCoinMicros: totals.reserved.toString(),
    totalCoinMicros: (totals.available + totals.reserved).toString(),
  };
}

async function main() {
  const shouldApply = process.argv.includes("--apply");
  const databaseSafety = auditPostgresTestDatabaseSafety(process.env);

  if (!databaseSafety.ok) {
    throw new Error(
      `Coin migration requires a dedicated TEST_DATABASE_URL: ${databaseSafety.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (shouldApply && process.env.COINS_MIGRATION_APPLY !== "true") {
    throw new Error(
      "Set COINS_MIGRATION_APPLY=true and pass --apply only after reviewing the test-database dry-run.",
    );
  }

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: testDatabaseUrl,
    ssl: booleanFromEnv("TEST_DATABASE_SSL")
      ? { rejectUnauthorized: false }
      : false,
  });
  const client = await pool.connect();
  try {
    const report = shouldApply
      ? await applyMigration(client)
      : await inspectMigration(client);
    console.log(JSON.stringify(report, null, 2));
    if (
      report.unsafePrecisionUsers.length > 0 ||
      report.unsafeProjectionRows.length > 0 ||
      report.negativeBalanceUsers.length > 0
    ) {
      process.exitCode = 2;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

function booleanFromEnv(name: string) {
  return ["1", "true", "yes", "on"].includes(
    (process.env[name] ?? "").trim().toLowerCase(),
  );
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
