import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Database } from "../db.js";
import { type MarketDataService } from "../marketDataService.js";

export function registerHealthRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  marketData: MarketDataService,
) {
  const healthData = () => ({
    ok: true,
    service: "arabic-prediction-market-api",
    mode: config.appMode,
    cache: config.cacheEnabled ? "enabled" : "disabled",
    database: db.enabled ? "enabled" : "disabled",
  });

  app.get("/health", async () => ({
    data: healthData(),
  }));

  app.get("/api/health", async () => ({
    data: healthData(),
  }));

  app.get("/api/ready", async (_request, reply) => {
    const checks: Record<string, { status: "ok" | "failed"; message?: string }> = {};

    if (!db.enabled) {
      checks.database = {
        status: "failed",
        message: "DATABASE_URL is not configured.",
      };
    } else {
      try {
        await db.query("select 1 as ok");
        checks.database = { status: "ok" };
      } catch {
        checks.database = {
          status: "failed",
          message: "Database query failed.",
        };
      }
    }

    try {
      await marketData.listMarkets({ limit: 1, active: true, closed: false });
      checks.marketData = { status: "ok" };
    } catch {
      checks.marketData = {
        status: "failed",
        message: "Market data layer is unavailable.",
      };
    }

    const configuration = getConfigurationReadiness(config);
    checks.configuration = configuration.ok
      ? { status: "ok" }
      : { status: "failed", message: configuration.failed.join(", ") };

    const ok = Object.values(checks).every((check) => check.status === "ok");

    return reply.status(ok ? 200 : 503).send({
      data: {
        ok,
        service: "arabic-prediction-market-api",
        mode: config.appMode,
        checks,
      },
    });
  });
}

function getConfigurationReadiness(config: AppConfig) {
  const failed: string[] = [];

  if (config.appMode !== "local") {
    failed.push("APP_MODE must be local");
  }
  if (!config.walletDepositWebhookSecret) {
    failed.push("WALLET_DEPOSIT_WEBHOOK_SECRET is not configured");
  }
  if (config.nodeEnv === "production" && !config.sessionCookieSecure) {
    failed.push("SESSION_COOKIE_SECURE must be true in production");
  }
  if (config.nodeEnv === "production" && config.corsAllowedOrigins.length === 0) {
    failed.push("CORS_ALLOWED_ORIGINS must be configured in production");
  }
  if (config.nodeEnv === "production" && !config.databaseUrl) {
    failed.push("DATABASE_URL must be configured in production");
  }

  return {
    ok: failed.length === 0,
    failed,
  };
}
