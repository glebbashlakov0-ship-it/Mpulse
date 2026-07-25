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
  "DATABASE_URL",
  "DATABASE_SSL",
  "DATABASE_SSL_CA_PEM",
  "WALLET_DEPOSIT_WEBHOOK_ENABLED",
  "COIN_DEPOSIT_CREDITS_ENABLED",
  "COIN_WITHDRAWAL_REQUESTS_ENABLED",
  "COIN_INTERNAL_TRADING_ENABLED",
  "REAL_MONEY_DEPOSIT_PROVIDER",
  "EXCHANGE_RATE_PROVIDER",
  "USDT_TRON_CONTRACT",
  "MONEY_OUTBOX_WORKER_ENABLED",
  "MONEY_OUTBOX_DRAIN_ENDPOINT_ENABLED",
  "PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED",
  "MONEY_OUTBOX_DELIVERY_MODE",
  "CRON_SECRET",
  "MONEY_OUTBOX_POLL_INTERVAL_MS",
  "MONEY_OUTBOX_BATCH_SIZE",
  "MONEY_OUTBOX_CONCURRENCY",
  "MONEY_OUTBOX_LEASE_DURATION_MS",
  "MONEY_OUTBOX_MAX_ATTEMPTS",
  "MONEY_OUTBOX_BACKOFF_BASE_MS",
  "MONEY_OUTBOX_BACKOFF_MAX_MS",
  "MONEY_OUTBOX_BACKOFF_JITTER_RATIO",
  "APP_BASE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
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
    assert.equal(config.coinDepositCreditsEnabled, false);
    assert.equal(config.coinWithdrawalRequestsEnabled, false);
    assert.equal(config.coinInternalTradingEnabled, false);
    assert.equal(config.moneyOutboxWorkerEnabled, false);
    assert.equal(config.moneyOutboxDrainEndpointEnabled, false);
    assert.equal(config.productionCoinCutoverEndpointEnabled, false);
  });
});

test("money outbox runtimes fail closed without database and cron secret", () => {
  withEnv({ MONEY_OUTBOX_WORKER_ENABLED: "true" }, () => {
    assert.throws(() => getConfig(), /DATABASE_URL is required/);
  });

  withEnv({
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    MONEY_OUTBOX_DRAIN_ENDPOINT_ENABLED: "true",
    MONEY_OUTBOX_DELIVERY_MODE: "structured_log",
  }, () => {
    assert.throws(() => getConfig(), /CRON_SECRET must contain at least 32 characters/);
  });

  withEnv({
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    MONEY_OUTBOX_DRAIN_ENDPOINT_ENABLED: "true",
    MONEY_OUTBOX_DELIVERY_MODE: "structured_log",
    CRON_SECRET: "test-cron-secret-with-at-least-32-characters",
  }, () => {
    assert.equal(getConfig().moneyOutboxDrainEndpointEnabled, true);
  });
});

test("production Coin cutover endpoint is production-only and requires SSL database plus secret", () => {
  const endpointSecret = "cutover-cron-secret-with-at-least-32-characters";
  const productionEnv = {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    APP_MODE: "local",
    SESSION_SECRET: "prod-session-secret-32-characters-long",
    SESSION_COOKIE_SECURE: "true",
    CORS_ALLOWED_ORIGINS: "https://mpulse.vercel.app",
    DATABASE_URL:
      "postgres://market:credential@db.example.com:5432/mpulse_prod",
    DATABASE_SSL: "true",
    DATABASE_SSL_CA_PEM:
      "-----BEGIN CERTIFICATE-----\\ntest\\n-----END CERTIFICATE-----",
    ADMIN_PANEL_USERNAME: "ops",
    ADMIN_PANEL_PASSWORD: "prod-admin-password-32-characters",
    PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED: "true",
    CRON_SECRET: endpointSecret,
  };

  withEnv(
    {
      DATABASE_URL: productionEnv.DATABASE_URL,
      DATABASE_SSL: "true",
      PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED: "true",
      CRON_SECRET: endpointSecret,
    },
    () => {
      assert.throws(
        () => getConfig(),
        /allowed only in a Vercel production runtime/,
      );
    },
  );

  withEnv({ ...productionEnv, DATABASE_URL: undefined }, () => {
    assert.throws(
      () => getConfig(),
      /DATABASE_URL is required when PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=true/,
    );
  });

  withEnv({ ...productionEnv, DATABASE_SSL: "false" }, () => {
    assert.throws(
      () => getConfig(),
      /DATABASE_SSL must be true when PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=true/,
    );
  });

  withEnv({ ...productionEnv, DATABASE_SSL_CA_PEM: undefined }, () => {
    assert.throws(
      () => getConfig(),
      /DATABASE_SSL_CA_PEM is required when PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=true/,
    );
  });

  withEnv({ ...productionEnv, CRON_SECRET: "too-short" }, () => {
    assert.throws(
      () => getConfig(),
      /CRON_SECRET must contain at least 32 characters when PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=true/,
    );
  });

  withEnv(productionEnv, () => {
    assert.equal(getConfig().productionCoinCutoverEndpointEnabled, true);
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

  withEnv({ COIN_INTERNAL_TRADING_ENABLED: "sometimes" }, () => {
    assert.throws(
      () => getConfig(),
      /COIN_INTERNAL_TRADING_ENABLED must be a boolean value/,
    );
  });

  withEnv({ DATABASE_SSL_CA_PEM: "not-a-certificate" }, () => {
    assert.throws(
      () => getConfig(),
      /DATABASE_SSL_CA_PEM must contain a PEM-encoded CA certificate/,
    );
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

  withEnv({
    ...productionEnv,
    ADMIN_PANEL_USERNAME: undefined,
    ADMIN_PANEL_PASSWORD: undefined,
    VERCEL_PROJECT_PRODUCTION_URL: "mpulse.vercel.app",
  }, () => {
    const config = getConfig();

    assert.equal(config.adminPanelUsername, null);
    assert.equal(config.adminPanelPassword, null);
    assert.equal(config.appBaseUrl, "https://mpulse.vercel.app");
  });

  withEnv({ ...productionEnv, REDIS_URL: "redis://localhost:6379" }, () => {
    const config = getConfig();

    assert.equal(config.authRateLimitBackend, "redis");
    assert.equal(config.redisUrl, "redis://localhost:6379");
  });

  withEnv(
    {
      ...productionEnv,
      COIN_WITHDRAWAL_REQUESTS_ENABLED: "true",
      COIN_INTERNAL_TRADING_ENABLED: "true",
      EXCHANGE_RATE_PROVIDER: "coinbase",
    },
    () => {
      const config = getConfig();
      assert.equal(config.coinWithdrawalRequestsEnabled, true);
      assert.equal(config.coinInternalTradingEnabled, true);
      assert.equal(config.coinDepositCreditsEnabled, false);
    },
  );

  withEnv({ ...productionEnv, SESSION_COOKIE_SECURE: "false" }, () => {
    assert.throws(() => getConfig(), /SESSION_COOKIE_SECURE must be true/);
  });

  withEnv({ ...productionEnv, CORS_ALLOWED_ORIGINS: "" }, () => {
    assert.throws(() => getConfig(), /CORS_ALLOWED_ORIGINS must be an explicit allowlist/);
  });

  withEnv({ ...productionEnv, DATABASE_URL: "" }, () => {
    assert.throws(() => getConfig(), /DATABASE_URL is required in production/);
  });

  withEnv({ ...productionEnv, AUTH_RATE_LIMIT_BACKEND: "memory" }, () => {
    assert.throws(() => getConfig(), /AUTH_RATE_LIMIT_BACKEND must be redis or external/);
  });
});

test("Coin money features require explicit flags and safe prerequisites", () => {
  withEnv(
    {
      COIN_WITHDRAWAL_REQUESTS_ENABLED: "true",
      EXCHANGE_RATE_PROVIDER: "disabled",
    },
    () => {
      assert.throws(
        () => getConfig(),
        /COIN_WITHDRAWAL_RATE_PROVIDER_REQUIRED/,
      );
    },
  );

  withEnv(
    {
      COIN_WITHDRAWAL_REQUESTS_ENABLED: "true",
      COIN_INTERNAL_TRADING_ENABLED: "true",
      EXCHANGE_RATE_PROVIDER: "coinbase",
    },
    () => {
      const config = getConfig();
      assert.equal(config.coinWithdrawalRequestsEnabled, true);
      assert.equal(config.coinInternalTradingEnabled, true);
      assert.equal(config.coinDepositCreditsEnabled, false);
    },
  );

  withEnv(
    {
      COIN_DEPOSIT_CREDITS_ENABLED: "true",
      EXCHANGE_RATE_PROVIDER: "coinbase",
    },
    () => {
      assert.throws(
        () => getConfig(),
        /REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED/,
      );
    },
  );

  withEnv(
    {
      COIN_DEPOSIT_CREDITS_ENABLED: "true",
      WALLET_DEPOSIT_WEBHOOK_ENABLED: "true",
      REAL_MONEY_DEPOSIT_PROVIDER: "fireblocks",
      EXCHANGE_RATE_PROVIDER: "coinbase",
      USDT_TRON_CONTRACT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    },
    () => {
      assert.throws(
        () => getConfig(),
        /REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED/,
      );
    },
  );
});
