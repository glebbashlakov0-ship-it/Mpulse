import "dotenv/config";
import { assertCoinFeatureGateConfiguration } from "./coinFeatureGates.js";

export type AppConfig = {
  host: string;
  port: number;
  appMode: "local";
  polymarketGammaUrl: string;
  polymarketClobUrl: string;
  polymarketRequestTimeoutMs: number;
  defaultMarketLimit: number;
  maxMarketLimit: number;
  upstreamMarketLimit: number;
  relatedMarketLimit: number;
  marketSnapshotCollectorEnabled: boolean;
  marketSnapshotCollectorIntervalMs: number;
  marketSnapshotCollectorMarketIds: string[];
  marketSnapshotHistoryLimit: number;
  cacheEnabled: boolean;
  nodeEnv: string;
  productionDeployment: boolean;
  sessionSecret: string;
  sessionCookieName: string;
  sessionCookieSecure: boolean;
  sessionTtlMs: number;
  csrfProtectionEnabled: boolean;
  csrfCookieName: string;
  corsAllowedOrigins: string[];
  authRateLimitBackend: "memory" | "redis" | "external";
  redisUrl: string | null;
  authRateLimitWindowMs: number;
  authRateLimitMax: number;
  ledgerCreditApiEnabled: boolean;
  walletDepositWebhookEnabled: boolean;
  coinDepositCreditsEnabled: boolean;
  coinWithdrawalRequestsEnabled: boolean;
  coinInternalTradingEnabled: boolean;
  adminManualDepositApprovalEnabled: boolean;
  adminActivitySeedApiEnabled: boolean;
  adminEmails: string[];
  supportEmails: string[];
  complianceAdminEmails: string[];
  financeAdminEmails: string[];
  superAdminEmails: string[];
  adminPanelUsername: string | null;
  adminPanelPassword: string | null;
  adminPanelCookieName: string;
  adminPanelTtlMs: number;
  walletDepositMinConfirmations: number;
  realMoneyDepositProvider: string | null;
  exchangeRateProvider: "disabled" | "coinbase";
  exchangeRateTtlSeconds: number;
  exchangeRateRequestTimeoutMs: number;
  exchangeRateCoinbaseUrl: string;
  usdtTronContract: string | null;
  databaseUrl: string | null;
  databaseSsl: boolean;
  moneyOutboxWorkerEnabled: boolean;
  moneyOutboxDrainEndpointEnabled: boolean;
  productionCoinCutoverEndpointEnabled: boolean;
  moneyOutboxDeliveryMode: "disabled" | "structured_log";
  cronSecret: string | null;
  moneyOutboxPollIntervalMs: number;
  moneyOutboxBatchSize: number;
  moneyOutboxConcurrency: number;
  moneyOutboxLeaseDurationMs: number;
  moneyOutboxMaxAttempts: number;
  moneyOutboxBackoffBaseMs: number;
  moneyOutboxBackoffMaxMs: number;
  moneyOutboxBackoffJitterRatio: number;
  resendApiKey: string;
  emailFromAddress: string;
  appBaseUrl: string;
  cacheTtlMs: {
    activeMarkets: number;
    closedMarkets: number;
    marketDetail: number;
    categories: number;
    relatedMarkets: number;
    searchResults: number;
  };
  blockedMarketTerms: string[];
};

const placeholderSecretTerms = ["change-this", "dev-only", "placeholder"];

function stringFromEnv(name: string): string | null {
  const value = process.env[name];
  return value?.trim() || null;
}

function numberFromEnv(
  name: string,
  fallback: number,
  options: { min?: number; integer?: boolean } = {},
): number {
  const value = stringFromEnv(name);
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  const min = options.min ?? 0;

  if (!Number.isFinite(parsed) || parsed < min || (options.integer && !Number.isInteger(parsed))) {
    throw new Error(`${name} must be ${options.integer ? "an integer" : "a number"} >= ${min}.`);
  }

  return parsed;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const value = stringFromEnv(name);
  if (value === null) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be a boolean value.`);
}

function listFromEnv(name: string, fallback: string[]): string[] {
  const value = stringFromEnv(name);
  if (value === null) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function urlFromEnv(name: string, fallback: string): string {
  const value = stringFromEnv(name) ?? fallback;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}

function isPlaceholderSecret(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const normalized = value.toLowerCase();
  return placeholderSecretTerms.some((term) => normalized.includes(term));
}

function vercelBaseUrlFromEnv(): string | null {
  const productionUrl = stringFromEnv("VERCEL_PROJECT_PRODUCTION_URL");
  if (productionUrl) {
    return productionUrl.startsWith("http") ? productionUrl : `https://${productionUrl}`;
  }

  const deploymentUrl = stringFromEnv("VERCEL_URL");
  if (deploymentUrl) {
    return deploymentUrl.startsWith("http") ? deploymentUrl : `https://${deploymentUrl}`;
  }

  return null;
}

export function getConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const appMode = process.env.APP_MODE ?? "local";
  const sessionSecret = stringFromEnv("SESSION_SECRET");
  const corsAllowedOrigins = listFromEnv("CORS_ALLOWED_ORIGINS", []);
  const databaseUrl = stringFromEnv("DATABASE_URL");
  const redisUrl = stringFromEnv("REDIS_URL");
  const adminPanelUsername = stringFromEnv("ADMIN_PANEL_USERNAME");
  const adminPanelPassword = stringFromEnv("ADMIN_PANEL_PASSWORD");
  const exchangeRateProvider = stringFromEnv("EXCHANGE_RATE_PROVIDER") ?? "disabled";
  const walletDepositWebhookEnabled = booleanFromEnv(
    "WALLET_DEPOSIT_WEBHOOK_ENABLED",
    false,
  );
  const coinDepositCreditsEnabled = booleanFromEnv(
    "COIN_DEPOSIT_CREDITS_ENABLED",
    false,
  );
  const coinWithdrawalRequestsEnabled = booleanFromEnv(
    "COIN_WITHDRAWAL_REQUESTS_ENABLED",
    false,
  );
  const coinInternalTradingEnabled = booleanFromEnv(
    "COIN_INTERNAL_TRADING_ENABLED",
    false,
  );
  const realMoneyDepositProvider = stringFromEnv("REAL_MONEY_DEPOSIT_PROVIDER");
  const usdtTronContract = stringFromEnv("USDT_TRON_CONTRACT");
  const moneyOutboxWorkerEnabled = booleanFromEnv("MONEY_OUTBOX_WORKER_ENABLED", false);
  const moneyOutboxDrainEndpointEnabled = booleanFromEnv(
    "MONEY_OUTBOX_DRAIN_ENDPOINT_ENABLED",
    false,
  );
  const productionCoinCutoverEndpointEnabled = booleanFromEnv(
    "PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED",
    false,
  );
  const moneyOutboxDeliveryMode =
    stringFromEnv("MONEY_OUTBOX_DELIVERY_MODE") ?? "disabled";
  const cronSecret = stringFromEnv("CRON_SECRET");
  const databaseSsl = booleanFromEnv("DATABASE_SSL", nodeEnv === "production");
  const moneyOutboxBatchSize = numberFromEnv("MONEY_OUTBOX_BATCH_SIZE", 50, {
    min: 1,
    integer: true,
  });
  const moneyOutboxConcurrency = numberFromEnv("MONEY_OUTBOX_CONCURRENCY", 5, {
    min: 1,
    integer: true,
  });
  const moneyOutboxLeaseDurationMs = numberFromEnv(
    "MONEY_OUTBOX_LEASE_DURATION_MS",
    120_000,
    { min: 1_000, integer: true },
  );
  const moneyOutboxBackoffBaseMs = numberFromEnv(
    "MONEY_OUTBOX_BACKOFF_BASE_MS",
    1_000,
    { min: 1, integer: true },
  );
  const moneyOutboxBackoffMaxMs = numberFromEnv(
    "MONEY_OUTBOX_BACKOFF_MAX_MS",
    15 * 60_000,
    { min: 1, integer: true },
  );
  const moneyOutboxBackoffJitterRatio = numberFromEnv(
    "MONEY_OUTBOX_BACKOFF_JITTER_RATIO",
    0.2,
    { min: 0 },
  );
  const authRateLimitBackend = stringFromEnv("AUTH_RATE_LIMIT_BACKEND")
    ?? (nodeEnv === "production" ? (redisUrl ? "redis" : "external") : "memory");

  if (appMode !== "local") {
    throw new Error("APP_MODE must remain local until real-money architecture is approved.");
  }
  if (!["memory", "redis", "external"].includes(authRateLimitBackend)) {
    throw new Error("AUTH_RATE_LIMIT_BACKEND must be memory, redis, or external.");
  }
  if (authRateLimitBackend === "redis" && !redisUrl) {
    throw new Error("REDIS_URL is required when AUTH_RATE_LIMIT_BACKEND=redis.");
  }
  if (!["disabled", "coinbase"].includes(exchangeRateProvider)) {
    throw new Error("EXCHANGE_RATE_PROVIDER must be disabled or coinbase.");
  }
  assertCoinFeatureGateConfiguration({
    coinDepositCreditsEnabled,
    coinWithdrawalRequestsEnabled,
    coinInternalTradingEnabled,
    walletDepositWebhookEnabled,
    realMoneyDepositProvider,
    exchangeRateProvider,
    usdtTronContract,
  });
  if (moneyOutboxConcurrency > moneyOutboxBatchSize) {
    throw new Error("MONEY_OUTBOX_CONCURRENCY must not exceed MONEY_OUTBOX_BATCH_SIZE.");
  }
  if (moneyOutboxBackoffMaxMs < moneyOutboxBackoffBaseMs) {
    throw new Error("MONEY_OUTBOX_BACKOFF_MAX_MS must be >= MONEY_OUTBOX_BACKOFF_BASE_MS.");
  }
  if (moneyOutboxBackoffJitterRatio > 1) {
    throw new Error("MONEY_OUTBOX_BACKOFF_JITTER_RATIO must be <= 1.");
  }
  if (!["disabled", "structured_log"].includes(moneyOutboxDeliveryMode)) {
    throw new Error("MONEY_OUTBOX_DELIVERY_MODE must be disabled or structured_log.");
  }
  if (moneyOutboxWorkerEnabled || moneyOutboxDrainEndpointEnabled) {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required when a money outbox worker is enabled.");
    }
    if (moneyOutboxDeliveryMode !== "structured_log") {
      throw new Error(
        "MONEY_OUTBOX_DELIVERY_MODE must be structured_log when a money outbox runtime is enabled.",
      );
    }
  }
  if (moneyOutboxDrainEndpointEnabled && (!cronSecret || cronSecret.length < 32)) {
    throw new Error(
      "CRON_SECRET must contain at least 32 characters when MONEY_OUTBOX_DRAIN_ENDPOINT_ENABLED=true.",
    );
  }
  if (productionCoinCutoverEndpointEnabled) {
    if (
      nodeEnv !== "production" ||
      process.env.VERCEL_ENV !== "production"
    ) {
      throw new Error(
        "PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=true is allowed only in a Vercel production runtime.",
      );
    }
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required when PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=true.",
      );
    }
    if (!databaseSsl) {
      throw new Error(
        "DATABASE_SSL must be true when PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=true.",
      );
    }
    if (!cronSecret || cronSecret.length < 32) {
      throw new Error(
        "CRON_SECRET must contain at least 32 characters when PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=true.",
      );
    }
  }

  const sessionCookieSecure = booleanFromEnv("SESSION_COOKIE_SECURE", nodeEnv === "production");

  if (nodeEnv === "production") {
    if (isPlaceholderSecret(sessionSecret)) {
      throw new Error("SESSION_SECRET must be set to a non-placeholder value in production.");
    }
    if (!sessionCookieSecure) {
      throw new Error("SESSION_COOKIE_SECURE must be true in production.");
    }
    if (corsAllowedOrigins.length === 0 || corsAllowedOrigins.includes("*")) {
      throw new Error("CORS_ALLOWED_ORIGINS must be an explicit allowlist in production.");
    }
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required in production.");
    }
    if (authRateLimitBackend === "memory") {
      throw new Error("AUTH_RATE_LIMIT_BACKEND must be redis or external in production.");
    }
    if (adminPanelUsername === "admin" && adminPanelPassword === "admin") {
      throw new Error("ADMIN_PANEL_USERNAME and ADMIN_PANEL_PASSWORD must not use local defaults in production.");
    }
  }

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: numberFromEnv("PORT", 4000, { min: 1, integer: true }),
    appMode,
    nodeEnv,
    polymarketGammaUrl: urlFromEnv("POLYMARKET_GAMMA_URL", "https://gamma-api.polymarket.com"),
    polymarketClobUrl: urlFromEnv("POLYMARKET_CLOB_URL", "https://clob.polymarket.com"),
    polymarketRequestTimeoutMs: numberFromEnv("POLYMARKET_REQUEST_TIMEOUT_MS", 8000, { min: 1 }),
    defaultMarketLimit: numberFromEnv("MARKETS_DEFAULT_LIMIT", 48, { min: 1, integer: true }),
    maxMarketLimit: numberFromEnv("MARKETS_MAX_LIMIT", 120, { min: 1, integer: true }),
    upstreamMarketLimit: numberFromEnv("POLYMARKET_UPSTREAM_MARKET_LIMIT", 500, {
      min: 1,
      integer: true,
    }),
    relatedMarketLimit: numberFromEnv("RELATED_MARKETS_LIMIT", 8, { min: 1, integer: true }),
    marketSnapshotCollectorEnabled: booleanFromEnv("MARKET_SNAPSHOT_COLLECTOR_ENABLED", false),
    marketSnapshotCollectorIntervalMs: numberFromEnv("MARKET_SNAPSHOT_COLLECTOR_INTERVAL_MS", 60_000, {
      min: 1_000,
      integer: true,
    }),
    marketSnapshotCollectorMarketIds: listFromEnv("MARKET_SNAPSHOT_COLLECTOR_MARKET_IDS", []),
    marketSnapshotHistoryLimit: numberFromEnv("MARKET_SNAPSHOT_HISTORY_LIMIT", 240, {
      min: 1,
      integer: true,
    }),
    cacheEnabled: booleanFromEnv("CACHE_ENABLED", true),
    productionDeployment:
      nodeEnv === "production" || process.env.VERCEL_ENV === "production",
    sessionSecret: sessionSecret ?? "dev-only-change-this-session-secret-before-production",
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "mp_session",
    sessionCookieSecure,
    sessionTtlMs: numberFromEnv("SESSION_TTL_MS", 1000 * 60 * 60 * 24 * 7, { min: 60_000 }),
    csrfProtectionEnabled: booleanFromEnv("CSRF_PROTECTION_ENABLED", nodeEnv !== "test"),
    csrfCookieName: process.env.CSRF_COOKIE_NAME ?? "mp_csrf",
    corsAllowedOrigins,
    authRateLimitBackend: authRateLimitBackend as "memory" | "redis" | "external",
    redisUrl,
    authRateLimitWindowMs: numberFromEnv("AUTH_RATE_LIMIT_WINDOW_MS", 60_000, { min: 1 }),
    authRateLimitMax: numberFromEnv("AUTH_RATE_LIMIT_MAX", 20, { min: 1, integer: true }),
    ledgerCreditApiEnabled: booleanFromEnv("LEDGER_CREDIT_API_ENABLED", false),
    walletDepositWebhookEnabled,
    coinDepositCreditsEnabled,
    coinWithdrawalRequestsEnabled,
    coinInternalTradingEnabled,
    adminManualDepositApprovalEnabled: booleanFromEnv(
      "ADMIN_MANUAL_DEPOSIT_APPROVAL_ENABLED",
      false,
    ),
    adminActivitySeedApiEnabled: booleanFromEnv("ADMIN_ACTIVITY_SEED_API_ENABLED", false),
    adminEmails: listFromEnv("ADMIN_EMAILS", []),
    supportEmails: listFromEnv("SUPPORT_EMAILS", []),
    complianceAdminEmails: listFromEnv("COMPLIANCE_ADMIN_EMAILS", []),
    financeAdminEmails: listFromEnv("FINANCE_ADMIN_EMAILS", []),
    superAdminEmails: listFromEnv("SUPER_ADMIN_EMAILS", []),
    adminPanelUsername: adminPanelUsername ?? (nodeEnv === "production" ? null : "admin"),
    adminPanelPassword: adminPanelPassword ?? (nodeEnv === "production" ? null : "admin"),
    adminPanelCookieName: process.env.ADMIN_PANEL_COOKIE_NAME ?? "pulse_admin_session",
    adminPanelTtlMs: numberFromEnv("ADMIN_PANEL_TTL_MS", 1000 * 60 * 60 * 12, { min: 60_000 }),
    walletDepositMinConfirmations: numberFromEnv("WALLET_DEPOSIT_MIN_CONFIRMATIONS", 20, {
      min: 0,
      integer: true,
    }),
    realMoneyDepositProvider,
    exchangeRateProvider: exchangeRateProvider as "disabled" | "coinbase",
    exchangeRateTtlSeconds: numberFromEnv("EXCHANGE_RATE_TTL_SECONDS", 30, {
      min: 1,
      integer: true,
    }),
    exchangeRateRequestTimeoutMs: numberFromEnv(
      "EXCHANGE_RATE_REQUEST_TIMEOUT_MS",
      5_000,
      { min: 1, integer: true },
    ),
    exchangeRateCoinbaseUrl: urlFromEnv(
      "EXCHANGE_RATE_COINBASE_URL",
      "https://api.coinbase.com/v2/exchange-rates?currency=USDT",
    ),
    usdtTronContract,
    databaseUrl,
    databaseSsl,
    moneyOutboxWorkerEnabled,
    moneyOutboxDrainEndpointEnabled,
    productionCoinCutoverEndpointEnabled,
    moneyOutboxDeliveryMode: moneyOutboxDeliveryMode as "disabled" | "structured_log",
    cronSecret,
    moneyOutboxPollIntervalMs: numberFromEnv("MONEY_OUTBOX_POLL_INTERVAL_MS", 1_000, {
      min: 100,
      integer: true,
    }),
    moneyOutboxBatchSize,
    moneyOutboxConcurrency,
    moneyOutboxLeaseDurationMs,
    moneyOutboxMaxAttempts: numberFromEnv("MONEY_OUTBOX_MAX_ATTEMPTS", 10, {
      min: 1,
      integer: true,
    }),
    moneyOutboxBackoffBaseMs,
    moneyOutboxBackoffMaxMs,
    moneyOutboxBackoffJitterRatio,
    resendApiKey: stringFromEnv("RESEND_API_KEY") ?? "local",
    emailFromAddress: stringFromEnv("EMAIL_FROM_ADDRESS") ?? "Pulse Market <noreply@pulsemarket.app>",
    appBaseUrl: urlFromEnv(
      "APP_BASE_URL",
      vercelBaseUrlFromEnv() ?? (nodeEnv === "production" ? "https://pulsemarket.app" : "http://localhost:5173"),
    ),
    cacheTtlMs: {
      activeMarkets: numberFromEnv("CACHE_TTL_ACTIVE_MARKETS_MS", 60_000),
      closedMarkets: numberFromEnv("CACHE_TTL_CLOSED_MARKETS_MS", 180_000),
      marketDetail: numberFromEnv("CACHE_TTL_MARKET_DETAIL_MS", 30_000),
      categories: numberFromEnv("CACHE_TTL_CATEGORIES_MS", 900_000),
      relatedMarkets: numberFromEnv("CACHE_TTL_RELATED_MARKETS_MS", 120_000),
      searchResults: numberFromEnv("CACHE_TTL_SEARCH_RESULTS_MS", 60_000),
    },
    blockedMarketTerms: listFromEnv("BLOCKED_MARKET_TERMS", []),
  };
}
