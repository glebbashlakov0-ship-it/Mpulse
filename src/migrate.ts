import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { getConfig } from "./config.js";

const config = getConfig();

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
});

const migrations = [
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
];

try {
  await pool.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  for (const filename of migrations) {
    const existing = await pool.query<{ filename: string }>(
      `select filename from schema_migrations where filename = $1`,
      [filename],
    );

    if (existing.rows.length > 0) {
      console.log(`Skipping ${filename}`);
      continue;
    }

    const sql = await readFile(join(process.cwd(), "migrations", filename), "utf8");
    await pool.query("begin");
    try {
      await pool.query(sql);
      await pool.query(`insert into schema_migrations (filename) values ($1)`, [filename]);
      await pool.query("commit");
      console.log(`Applied ${filename}`);
    } catch (error) {
      await pool.query("rollback");
      throw error;
    }
  }
} finally {
  await pool.end();
}
