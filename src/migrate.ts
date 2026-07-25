import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { getConfig } from "./config.js";
import { migrations } from "./migrationPlan.js";

const config = getConfig();

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
});

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
