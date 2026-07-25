import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Queryable } from "./db.js";
import { migrations } from "./migrationPlan.js";

export const SCHEMA_MIGRATION_LOCK = "market_pulse:schema_migrations";

export type SchemaMigrationResult = {
  applied: string[];
  skipped: string[];
};

type SchemaMigrationOptions = {
  rootDirectory?: string;
  filenames?: readonly string[];
  readMigration?: (filename: string) => Promise<string>;
  log?: (message: string) => void;
};

/**
 * Applies the checked migration plan while one PostgreSQL session owns the
 * process-wide schema lock. The caller must provide a session-bound client:
 * advisory locks are scoped to a connection, not to a Pool.
 */
export async function runSchemaMigrations(
  client: Queryable,
  options: SchemaMigrationOptions = {},
): Promise<SchemaMigrationResult> {
  const filenames = options.filenames ?? migrations;
  const rootDirectory = options.rootDirectory ?? process.cwd();
  const loadMigration =
    options.readMigration ??
    ((filename: string) =>
      readFile(join(rootDirectory, "migrations", filename), "utf8"));
  const log = options.log ?? console.log;
  const result: SchemaMigrationResult = { applied: [], skipped: [] };
  let lockAcquired = false;

  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [
      SCHEMA_MIGRATION_LOCK,
    ]);
    lockAcquired = true;

    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    for (const filename of filenames) {
      const sql = await loadMigration(filename);
      await client.query("begin");
      try {
        const existing = await client.query<{ filename: string }>(
          `select filename
           from schema_migrations
           where filename = $1`,
          [filename],
        );

        if (existing.rows.length > 0) {
          await client.query("commit");
          result.skipped.push(filename);
          log(`Skipping ${filename}`);
          continue;
        }

        await client.query(sql);
        await client.query(
          `insert into schema_migrations (filename) values ($1)`,
          [filename],
        );
        await client.query("commit");
        result.applied.push(filename);
        log(`Applied ${filename}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    return result;
  } finally {
    if (lockAcquired) {
      await client.query("select pg_advisory_unlock(hashtext($1))", [
        SCHEMA_MIGRATION_LOCK,
      ]);
    }
  }
}
