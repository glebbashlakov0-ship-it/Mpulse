import assert from "node:assert/strict";
import test from "node:test";
import { getConfig } from "./config.js";

const managedEnvKeys = [
  "APP_MODE",
  "NODE_ENV",
  "PORT",
  "POLYMARKET_GAMMA_URL",
  "MARKET_SNAPSHOT_COLLECTOR_ENABLED",
  "MARKET_SNAPSHOT_COLLECTOR_INTERVAL_MS",
  "MARKET_SNAPSHOT_COLLECTOR_MARKET_IDS",
  "MARKET_SNAPSHOT_HISTORY_LIMIT",
  "CACHE_ENABLED",
  "SESSION_SECRET",
  "SESSION_COOKIE_SECURE",
  "CORS_ALLOWED_ORIGINS",
  "AUTH_RATE_LIMIT_BACKEND",
  "REDIS_URL",
  "SUPPORT_EMAILS",
  "COMPLIANCE_ADMIN_EMAILS",
  "FINANCE_ADMIN_EMAILS",
  "SUPER_ADMIN_EMAILS",
  "ADMIN_PANEL_USERNAME",
  "ADMIN_PANEL_PASSWORD",
  "ADMIN_PANEL_COOKIE_NAME",
  "ADMIN_PANEL_TTL_MS",
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
    assert.equal(config.authRateLimitBackend, "memory");
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

  withEnv({ MARKET_SNAPSHOT_COLLECTOR_INTERVAL_MS: "999" }, () => {
    assert.throws(() => getConfig(), /MARKET_SNAPSHOT_COLLECTOR_INTERVAL_MS must be an integer/);
  });

  withEnv({ AUTH_RATE_LIMIT_BACKEND: "redis" }, () => {
    assert.throws(() => getConfig(), /REDIS_URL is required/);
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
    ADMIN_PANEL_USERNAME: "ops",
    ADMIN_PANEL_PASSWORD: "prod-admin-password-32-characters",
  };

  withEnv(productionEnv, () => {
    const config = getConfig();

    assert.equal(config.sessionCookieSecure, true);
    assert.deepEqual(config.corsAllowedOrigins, ["https://market.example"]);
    assert.equal(config.databaseUrl, productionEnv.DATABASE_URL);
    assert.equal(config.authRateLimitBackend, "external");
  });

  withEnv({ ...productionEnv, REDIS_URL: "redis://localhost:6379" }, () => {
    const config = getConfig();

    assert.equal(config.authRateLimitBackend, "redis");
    assert.equal(config.redisUrl, "redis://localhost:6379");
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

  withEnv({ ...productionEnv, AUTH_RATE_LIMIT_BACKEND: "memory" }, () => {
    assert.throws(() => getConfig(), /AUTH_RATE_LIMIT_BACKEND must be redis or external/);
  });
});
