import assert from "node:assert/strict";
import test from "node:test";
import { getConfig } from "./config.js";

const managedEnvKeys = [
  "APP_MODE",
  "NODE_ENV",
  "PORT",
  "POLYMARKET_GAMMA_URL",
  "CACHE_ENABLED",
  "SESSION_SECRET",
  "SESSION_COOKIE_SECURE",
  "CORS_ALLOWED_ORIGINS",
  "WALLET_DEPOSIT_WEBHOOK_SECRET",
  "DATABASE_URL",
];

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const original = new Map(managedEnvKeys.map((key) => [key, process.env[key]]));

  try {
    for (const key of managedEnvKeys) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    run();
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("config defaults to local development mode", () => {
  withEnv({}, () => {
    const config = getConfig();

    assert.equal(config.appMode, "local");
    assert.equal(config.nodeEnv, "development");
    assert.equal(config.sessionCookieSecure, false);
    assert.deepEqual(config.corsAllowedOrigins, []);
  });
});

test("config rejects unsafe app mode and malformed env values", () => {
  withEnv({ APP_MODE: "real_money" }, () => {
    assert.throws(() => getConfig(), /APP_MODE must remain local/);
  });

  withEnv({ PORT: "not-a-port" }, () => {
    assert.throws(() => getConfig(), /PORT must be an integer/);
  });

  withEnv({ CACHE_ENABLED: "sometimes" }, () => {
    assert.throws(() => getConfig(), /CACHE_ENABLED must be a boolean value/);
  });
});

test("production config requires explicit secure guardrails", () => {
  const productionEnv = {
    NODE_ENV: "production",
    APP_MODE: "local",
    SESSION_SECRET: "prod-session-secret-32-characters-long",
    SESSION_COOKIE_SECURE: "true",
    CORS_ALLOWED_ORIGINS: "https://market.example",
    WALLET_DEPOSIT_WEBHOOK_SECRET: "prod-webhook-secret-32-characters-long",
    DATABASE_URL: "postgres://market:market@localhost:5432/market_pulse",
  };

  withEnv(productionEnv, () => {
    const config = getConfig();

    assert.equal(config.sessionCookieSecure, true);
    assert.deepEqual(config.corsAllowedOrigins, ["https://market.example"]);
    assert.equal(config.databaseUrl, productionEnv.DATABASE_URL);
  });

  withEnv({ ...productionEnv, SESSION_COOKIE_SECURE: "false" }, () => {
    assert.throws(() => getConfig(), /SESSION_COOKIE_SECURE must be true/);
  });

  withEnv({ ...productionEnv, CORS_ALLOWED_ORIGINS: "" }, () => {
    assert.throws(() => getConfig(), /CORS_ALLOWED_ORIGINS must be an explicit allowlist/);
  });

  withEnv({ ...productionEnv, WALLET_DEPOSIT_WEBHOOK_SECRET: "change-this" }, () => {
    assert.throws(() => getConfig(), /WALLET_DEPOSIT_WEBHOOK_SECRET must be set/);
  });

  withEnv({ ...productionEnv, DATABASE_URL: "" }, () => {
    assert.throws(() => getConfig(), /DATABASE_URL is required in production/);
  });
});
