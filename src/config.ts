import "dotenv/config";

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
  adminEmails: string[];
  supportEmails: string[];
  complianceAdminEmails: string[];
  financeAdminEmails: string[];
  superAdminEmails: string[];
  walletDepositWebhookSecret: string | null;
  walletDepositMinConfirmations: number;
  databaseUrl: string | null;
  databaseSsl: boolean;
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

export function getConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const appMode = process.env.APP_MODE ?? "local";
  const sessionSecret = stringFromEnv("SESSION_SECRET");
  const walletDepositWebhookSecret = stringFromEnv("WALLET_DEPOSIT_WEBHOOK_SECRET");
  const corsAllowedOrigins = listFromEnv("CORS_ALLOWED_ORIGINS", []);
  const databaseUrl = stringFromEnv("DATABASE_URL");
  const redisUrl = stringFromEnv("REDIS_URL");
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
    if (isPlaceholderSecret(walletDepositWebhookSecret)) {
      throw new Error("WALLET_DEPOSIT_WEBHOOK_SECRET must be set to a non-placeholder value.");
    }
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required in production.");
    }
    if (authRateLimitBackend === "memory") {
      throw new Error("AUTH_RATE_LIMIT_BACKEND must be redis or external in production.");
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
    adminEmails: listFromEnv("ADMIN_EMAILS", []),
    supportEmails: listFromEnv("SUPPORT_EMAILS", []),
    complianceAdminEmails: listFromEnv("COMPLIANCE_ADMIN_EMAILS", []),
    financeAdminEmails: listFromEnv("FINANCE_ADMIN_EMAILS", []),
    superAdminEmails: listFromEnv("SUPER_ADMIN_EMAILS", []),
    walletDepositWebhookSecret,
    walletDepositMinConfirmations: numberFromEnv("WALLET_DEPOSIT_MIN_CONFIRMATIONS", 20, {
      min: 0,
      integer: true,
    }),
    databaseUrl,
    databaseSsl: booleanFromEnv("DATABASE_SSL", nodeEnv === "production"),
    resendApiKey: stringFromEnv("RESEND_API_KEY") ?? "local",
    emailFromAddress: stringFromEnv("EMAIL_FROM_ADDRESS") ?? "Pulse Market <noreply@pulsemarket.app>",
    appBaseUrl: urlFromEnv("APP_BASE_URL", nodeEnv === "production" ? "https://pulsemarket.app" : "http://localhost:5173"),
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
