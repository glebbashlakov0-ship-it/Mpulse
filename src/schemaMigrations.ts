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
 * Applies the checked migration plan under transaction-scoped advisory locks.
 * This remains safe when DATABASE_URL points at a transaction pooler: no
 * correctness property depends on retaining the same backend session after a
 * commit.
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

  await client.query("begin");
  try {
    await establishMigrationTransaction(client);
    await client.query(`
      create table if not exists public.schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  for (const filename of filenames) {
    const sql = await loadMigration(filename);
    await client.query("begin");
    try {
      await establishMigrationTransaction(client);
      const existing = await client.query<{ filename: string }>(
        `select filename
         from public.schema_migrations
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
        `insert into public.schema_migrations (filename) values ($1)`,
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
}

async function establishMigrationTransaction(client: Queryable) {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [
    SCHEMA_MIGRATION_LOCK,
  ]);
  await client.query("set local search_path to public");
  await client.query(`
    do $migration_search_path$
    begin
      if current_setting('search_path') <> 'public'
         or current_schema() <> 'public' then
        raise exception 'Schema migration search_path must be exactly public';
      end if;
    end
    $migration_search_path$
  `);
}
