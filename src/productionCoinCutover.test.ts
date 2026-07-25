import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveProductionDatabaseUrlTarget,
  guardProductionCoinCutover,
  type ProductionCoinCutoverReleaseMarker,
} from "./productionCoinCutover.js";

const productionDatabaseUrl =
  "postgresql://mpulse:credential@db.example.com:5432/mpulse_prod?sslmode=require";
const marker: ProductionCoinCutoverReleaseMarker = {
  enabled: true,
  releaseMarker: "2026-07-25-coins-v1-legacy-usdt-parity",
  migrationVersion: "coins-v1-legacy-usdt-parity",
  vercelEnvironment: "production",
  expectedVercelProductionHost: "mpulse.vercel.app",
  databaseUrlEnvironment: "DATABASE_URL",
  expectedDatabaseTargetFingerprint:
    deriveProductionDatabaseUrlTarget(productionDatabaseUrl).fingerprint,
};

const productionEnv: NodeJS.ProcessEnv = {
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "mpulse.vercel.app",
  DATABASE_URL: productionDatabaseUrl,
  DATABASE_SSL: "true",
};

test("production Coin cutover skips every non-production Vercel build", () => {
  assert.deepEqual(
    guardProductionCoinCutover(
      { VERCEL_ENV: "preview" },
      marker,
      marker.migrationVersion,
    ),
    { shouldRun: false, reason: "not-production" },
  );
});

test("production Coin cutover resolves only the exact DATABASE_URL target", () => {
  const guarded = guardProductionCoinCutover(
    productionEnv,
    marker,
    marker.migrationVersion,
  );
  assert.equal(guarded.shouldRun, true);
  if (!guarded.shouldRun) {
    return;
  }
  assert.equal(guarded.databaseUrl, productionEnv.DATABASE_URL);
  assert.deepEqual(
    {
      hostname: guarded.target.hostname,
      port: guarded.target.port,
      databaseName: guarded.target.databaseName,
      databasePrincipalSha256Length:
        guarded.target.databasePrincipalSha256.length,
      fingerprintLength: guarded.target.fingerprint.length,
    },
    {
      hostname: "db.example.com",
      port: 5432,
      databaseName: "mpulse_prod",
      databasePrincipalSha256Length: 64,
      fingerprintLength: 64,
    },
  );
});

test("production Coin cutover allows the SSL Supabase production postgres database", () => {
  const databaseUrl =
    "postgresql://postgres.project:credential@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
  const guarded = guardProductionCoinCutover(
    {
      ...productionEnv,
      DATABASE_URL: databaseUrl,
    },
    {
      ...marker,
      expectedDatabaseTargetFingerprint:
        deriveProductionDatabaseUrlTarget(databaseUrl).fingerprint,
    },
    marker.migrationVersion,
  );
  assert.equal(guarded.shouldRun, true);
  if (!guarded.shouldRun) {
    return;
  }
  assert.equal(guarded.target.databaseName, "postgres");
  assert.equal(
    guarded.target.hostname,
    "aws-0-eu-central-1.pooler.supabase.com",
  );
  assert.equal(guarded.target.port, 6543);
  assert.equal(guarded.target.databasePrincipalSha256.length, 64);
  assert.equal(guarded.target.fingerprint.length, 64);
});

test("production Coin cutover binds the marker to the database principal without exposing it", () => {
  const otherPrincipalUrl = productionDatabaseUrl.replace(
    "mpulse:",
    "other-project:",
  );
  const original = deriveProductionDatabaseUrlTarget(productionDatabaseUrl);
  const other = deriveProductionDatabaseUrlTarget(otherPrincipalUrl);
  assert.notEqual(original.databasePrincipalSha256, other.databasePrincipalSha256);
  assert.notEqual(original.fingerprint, other.fingerprint);
  assert.equal(JSON.stringify(original).includes("mpulse"), true);
  assert.equal(
    Object.values(original).some((value) => value === "mpulse"),
    false,
  );

  assert.throws(
    () =>
      guardProductionCoinCutover(
        { ...productionEnv, DATABASE_URL: otherPrincipalUrl },
        marker,
        marker.migrationVersion,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /target fingerprint/);
      assert.equal(error.message.includes("other-project"), false);
      return true;
    },
  );
});

test("production Coin cutover remains disabled until the committed fingerprint is filled", () => {
  assert.throws(
    () =>
      guardProductionCoinCutover(
        productionEnv,
        {
          ...marker,
          enabled: false,
          expectedDatabaseTargetFingerprint:
            "PENDING_SET_EXACT_PRODUCTION_DATABASE_TARGET_FINGERPRINT",
        },
        marker.migrationVersion,
      ),
    /release marker is invalid/,
  );
});

test("production Coin cutover fails closed on test targets and project mismatch", () => {
  assert.throws(
    () =>
      guardProductionCoinCutover(
        {
          ...productionEnv,
          TEST_DATABASE_URL:
            "postgresql://postgres:postgres@localhost/mpulse_test",
        },
        marker,
        marker.migrationVersion,
      ),
    /TEST_DATABASE_URL must not be set/,
  );
  assert.throws(
    () =>
      guardProductionCoinCutover(
        {
          ...productionEnv,
          DATABASE_URL:
            "postgresql://postgres:postgres@db.example.com/mpulse_ci",
        },
        marker,
        marker.migrationVersion,
      ),
    /test-scoped target/,
  );
  assert.throws(
    () =>
      guardProductionCoinCutover(
        {
          ...productionEnv,
          DATABASE_URL:
            "postgresql://postgres:credential@db.example.com/postgres",
        },
        marker,
        marker.migrationVersion,
      ),
    /maintenance, or test-scoped target/,
  );
  assert.throws(
    () =>
      guardProductionCoinCutover(
        {
          ...productionEnv,
          VERCEL_PROJECT_PRODUCTION_URL: "other.vercel.app",
        },
        marker,
        marker.migrationVersion,
      ),
    /project identity/,
  );
});
