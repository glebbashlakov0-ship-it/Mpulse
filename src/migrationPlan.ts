import type { Queryable } from "./db.js";

// These migrations belong to unrelated work that is intentionally not part of
// the clean Coin cutover port. Migration 031 is self-contained on the 016
// schema and is validated against that exact sparse chain in CI.
export const intentionallyOmittedMigrationNumbers = [
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
] as const;

export const migrations = [
  "001_initial_schema.sql",
  "002_ledger_core.sql",
  "003_compliance_core.sql",
  "004_wallets_usdt_core.sql",
  "005_wallet_withdrawal_idempotency_fingerprint.sql",
  "006_admin_core.sql",
  "007_wallet_deposit_events.sql",
  "008_wallet_deposit_event_fingerprint.sql",
  "009_wallet_deposit_event_amount_check.sql",
  "010_auth_verification_tokens.sql",
  "011_account_security_and_watchlist.sql",
  "012_wallet_provider_alignment.sql",
  "013_market_activity_comments.sql",
  "014_market_settlement_core.sql",
  "015_market_price_history_points.sql",
  "016_trade_metadata.sql",
  "031_coins_ledger_cutover.sql",
  "032_money_outbox_worker.sql",
  "033_production_coin_cutover_evidence.sql",
] as const;

export type MigrationReadinessReport = {
  ok: boolean;
  expected: string[];
  applied: string[];
  missing: string[];
  unexpected: string[];
  schemaMigrationsTableExists: boolean;
};

export async function auditMigrationReadiness(
  db: Queryable,
): Promise<MigrationReadinessReport> {
  const expected: string[] = [...migrations];
  const schemaTableExists = await hasSchemaMigrationsTable(db);
  if (!schemaTableExists) {
    return {
      ok: false,
      expected,
      applied: [],
      missing: expected,
      unexpected: [],
      schemaMigrationsTableExists: false,
    };
  }

  const result = await db.query<{ filename: string }>(
    "select filename from schema_migrations order by filename",
  );
  const applied = result.rows.map((row) => row.filename);
  const appliedSet = new Set(applied);
  const expectedSet = new Set(expected);
  const missing = expected.filter((filename) => !appliedSet.has(filename));
  const unexpected = applied.filter((filename) => !expectedSet.has(filename));
  return {
    ok: missing.length === 0 && unexpected.length === 0,
    expected,
    applied,
    missing,
    unexpected,
    schemaMigrationsTableExists: true,
  };
}

async function hasSchemaMigrationsTable(db: Queryable) {
  const result = await db.query<{ exists: boolean }>(
    "select to_regclass('public.schema_migrations') is not null as exists",
  );
  return result.rows[0]?.exists === true;
}
