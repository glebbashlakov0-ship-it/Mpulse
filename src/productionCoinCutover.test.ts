import assert from "node:assert/strict";
import test from "node:test";
import {
  guardProductionCoinCutover,
  type ProductionCoinCutoverReleaseMarker,
} from "./productionCoinCutover.js";

const marker: ProductionCoinCutoverReleaseMarker = {
  enabled: true,
  releaseMarker: "2026-07-25-coins-v1-legacy-usdt-parity",
  migrationVersion: "coins-v1-legacy-usdt-parity",
  vercelEnvironment: "production",
  expectedVercelProductionHost: "mpulse.vercel.app",
  databaseUrlEnvironment: "DATABASE_URL",
};

const productionEnv: NodeJS.ProcessEnv = {
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "mpulse.vercel.app",
  DATABASE_URL:
    "postgresql://mpulse:credential@db.example.com:5432/mpulse_prod?sslmode=require",
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
      fingerprintLength: guarded.target.fingerprint.length,
    },
    {
      hostname: "db.example.com",
      port: 5432,
      databaseName: "mpulse_prod",
      fingerprintLength: 64,
    },
  );
});

test("production Coin cutover allows the SSL Supabase production postgres database", () => {
  const guarded = guardProductionCoinCutover(
    {
      ...productionEnv,
      DATABASE_URL:
        "postgresql://postgres.project:credential@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    },
    marker,
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
  assert.equal(guarded.target.fingerprint.length, 64);
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
