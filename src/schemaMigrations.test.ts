import assert from "node:assert/strict";
import test from "node:test";
import type { Queryable } from "./db.js";
import {
  SCHEMA_MIGRATION_LOCK,
  runSchemaMigrations,
} from "./schemaMigrations.js";

test("schema migrations use transaction locks, force public, and skip applied files", async () => {
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  let migrationLookup = 0;
  const db: Queryable = {
    async query<T>(text: string, values?: readonly unknown[]) {
      queries.push({ text, values });
      if (text.includes("select filename")) {
        migrationLookup += 1;
        return {
          rows: (migrationLookup === 2
            ? [{ filename: "002_already.sql" }]
            : []) as T[],
        };
      }
      return { rows: [] as T[] };
    },
  };

  const result = await runSchemaMigrations(db, {
    filenames: ["001_new.sql", "002_already.sql"],
    readMigration: async (filename) => `-- ${filename}`,
    log: () => undefined,
  });

  assert.deepEqual(result, {
    applied: ["001_new.sql"],
    skipped: ["002_already.sql"],
  });
  assert.equal(queries[0]?.text, "begin");
  const locks = queries.filter((query) =>
    query.text.includes("pg_advisory_xact_lock"),
  );
  assert.equal(locks.length, 3);
  assert.ok(
    locks.every(
      (query) => query.values?.[0] === SCHEMA_MIGRATION_LOCK,
    ),
  );
  assert.equal(
    queries.filter((query) => query.text === "set local search_path to public")
      .length,
    3,
  );
  assert.equal(
    queries.some((query) => query.text.includes("pg_advisory_unlock")),
    false,
  );
  assert.equal(
    queries.filter((query) => query.text === "begin").length,
    3,
  );
  assert.equal(
    queries.filter((query) => query.text === "commit").length,
    3,
  );
  assert.ok(
    queries.some((query) =>
      query.text.includes("insert into public.schema_migrations"),
    ),
  );
});

test("schema migration failure rolls back its transaction-scoped lock", async () => {
  const queries: string[] = [];
  const db: Queryable = {
    async query<T>(text: string) {
      queries.push(text);
      if (text === "-- failing migration") {
        throw new Error("migration failed");
      }
      return { rows: [] as T[] };
    },
  };

  await assert.rejects(
    () =>
      runSchemaMigrations(db, {
        filenames: ["001_failing.sql"],
        readMigration: async () => "-- failing migration",
        log: () => undefined,
      }),
    /migration failed/,
  );
  assert.equal(queries.at(-1), "rollback");
  assert.equal(
    queries.some((query) => query.includes("pg_advisory_unlock")),
    false,
  );
});
