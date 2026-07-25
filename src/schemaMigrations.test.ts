import assert from "node:assert/strict";
import test from "node:test";
import type { Queryable } from "./db.js";
import {
  SCHEMA_MIGRATION_LOCK,
  runSchemaMigrations,
} from "./schemaMigrations.js";

test("schema migrations hold one global advisory lock and skip applied files", async () => {
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
  assert.match(queries[0]?.text ?? "", /pg_advisory_lock/);
  assert.deepEqual(queries[0]?.values, [SCHEMA_MIGRATION_LOCK]);
  assert.match(queries.at(-1)?.text ?? "", /pg_advisory_unlock/);
  assert.equal(
    queries.filter((query) => query.text === "begin").length,
    2,
  );
  assert.equal(
    queries.filter((query) => query.text === "commit").length,
    2,
  );
});

test("schema migration failure rolls back before releasing the global lock", async () => {
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
  assert.equal(queries.at(-2), "rollback");
  assert.match(queries.at(-1) ?? "", /pg_advisory_unlock/);
});
