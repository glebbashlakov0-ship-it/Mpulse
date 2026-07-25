import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authorizeProductionCoinCutoverEndpoint,
  toSafeProductionCoinCutoverResult,
  toSafeProductionDatabaseIdentity,
} from "./productionCoinCutoverOps.js";

const secret = "cutover-cron-secret-with-at-least-32-characters";

test("production cutover ops authorization fails closed", () => {
  assert.deepEqual(
    authorizeProductionCoinCutoverEndpoint({
      config: {
        productionCoinCutoverEndpointEnabled: false,
        cronSecret: secret,
      },
      vercelEnvironment: "production",
      authorization: `Bearer ${secret}`,
    }),
    {
      ok: false,
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Not found.",
    },
  );

  assert.equal(
    authorizeProductionCoinCutoverEndpoint({
      config: {
        productionCoinCutoverEndpointEnabled: true,
        cronSecret: secret,
      },
      vercelEnvironment: "preview",
      authorization: `Bearer ${secret}`,
    }).ok,
    false,
  );
  assert.equal(
    authorizeProductionCoinCutoverEndpoint({
      config: {
        productionCoinCutoverEndpointEnabled: true,
        cronSecret: secret,
      },
      vercelEnvironment: "production",
      authorization: `Bearer wrong-${secret}`,
    }).ok,
    false,
  );
  assert.equal(
    authorizeProductionCoinCutoverEndpoint({
      config: {
        productionCoinCutoverEndpointEnabled: true,
        cronSecret: secret,
      },
      vercelEnvironment: "production",
      authorization: [`Bearer ${secret}`],
    }).ok,
    false,
  );
  assert.deepEqual(
    authorizeProductionCoinCutoverEndpoint({
      config: {
        productionCoinCutoverEndpointEnabled: true,
        cronSecret: secret,
      },
      vercelEnvironment: "production",
      authorization: `Bearer ${secret}`,
    }),
    { ok: true },
  );
});

test("production cutover ops responses exclude credentials and detailed money reports", () => {
  const databaseTarget = {
    hostname: "db.example.com",
    port: 5432,
    databaseName: "mpulse_prod",
    fingerprint: "f".repeat(64),
    username: "must-not-leak",
    connectionString:
      "postgres://must-not-leak:must-not-leak@db.example.com/mpulse_prod",
  };
  assert.deepEqual(toSafeProductionDatabaseIdentity(databaseTarget), {
    hostname: "db.example.com",
    port: 5432,
    databaseName: "mpulse_prod",
    fingerprint: "f".repeat(64),
  });

  const cutoverResult = {
    skipped: false as const,
    releaseMarker: "release-marker",
    databaseTargetFingerprint: "a".repeat(64),
    schemaMigrationsApplied: ["033_production_coin_cutover_evidence.sql"],
    schemaMigrationsSkipped: ["001_initial_schema.sql"],
    reconciliation: {
      status: "passed" as const,
      discrepancyCount: 0,
      discrepancies: [{ userId: "must-not-leak" }],
    },
    noOp: false,
    inspection: { unsafePrecisionUsers: ["must-not-leak"] },
    migration: { negativeBalanceUsers: ["must-not-leak"] },
  };
  assert.deepEqual(toSafeProductionCoinCutoverResult(cutoverResult), {
    status: "completed",
    releaseMarker: "release-marker",
    databaseTargetFingerprint: "a".repeat(64),
    schemaMigrationsApplied: ["033_production_coin_cutover_evidence.sql"],
    schemaMigrationsSkippedCount: 1,
    reconciliationStatus: "passed",
    reconciliationDiscrepancyCount: 0,
    noOp: false,
  });
});

test("Vercel build runs only non-mutating preflight before compilation", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  const vercelConfig = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ) as { buildCommand: string };

  assert.equal(
    packageJson.scripts["vercel-build"],
    "npm run runtime:preflight && npm run build",
  );
  assert.equal(
    packageJson.scripts["vercel-build"]?.includes("production-cutover"),
    false,
  );
  assert.equal(packageJson.scripts["runtime:preflight"], "tsx scripts/runtimeEnvPreflight.ts");
  assert.equal(vercelConfig.buildCommand, "npm run vercel-build");
});
