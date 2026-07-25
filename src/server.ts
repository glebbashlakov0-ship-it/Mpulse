import cors from "@fastify/cors";
import Fastify from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { AuthError, buildAuthService, getSessionTokenFromRequest } from "./auth.js";
import { buildAdminService, MemoryAdminRepository, PostgresAdminRepository, AdminError } from "./admin.js";
import { buildAdminPanelAuthService, AdminPanelAuthError } from "./adminPanelAuth.js";
import {
  buildAuditService,
  MemoryAuditLogRepository,
  PostgresAuditLogRepository,
} from "./audit.js";
import { buildPostgresAuthRepositories } from "./authRepositories.js";
import {
  buildTwoFactorService,
  MemoryTwoFactorRepository,
  PostgresTwoFactorRepository,
} from "./authTwoFactor.js";
import {
  buildVerificationService,
  MemoryVerificationRepository,
  PostgresVerificationRepository,
} from "./authVerification.js";
import { buildEmailProvider } from "./email.js";
import { pathToFileURL } from "node:url";
import { MemoryCacheStore } from "./cache.js";
import {
  buildComplianceService,
  ComplianceError,
  MemoryComplianceRepository,
  PostgresComplianceRepository,
} from "./compliance.js";
import { type AppConfig, getConfig } from "./config.js";
import { isStateChangingMethod, validateCsrfRequest } from "./csrf.js";
import { buildDatabase } from "./db.js";
import { CoinLedgerError, PostgresCoinLedgerRepository } from "./coins.js";
import {
  buildSettlementService,
  MemorySettlementRepository,
  PostgresSettlementRepository,
  SettlementError,
} from "./settlement.js";
import { MemoryPortfolioRepository, PostgresPortfolioRepository } from "./portfolioRepository.js";
import {
  MemoryMarketActivityRepository,
  PostgresMarketActivityRepository,
} from "./marketActivityRepository.js";
import { buildMarketDataService, MarketDataError } from "./marketDataService.js";
import { MemoryMarketRepository, PostgresMarketRepository } from "./marketRepository.js";
import {
  MemoryMarketPriceHistoryRepository,
  PostgresMarketPriceHistoryRepository,
} from "./marketPriceHistoryRepository.js";
import { buildMarketSeedService } from "./marketSeedService.js";
import {
  buildPlatformActivityService,
  MemoryPlatformActivityRepository,
  PostgresPlatformActivityRepository,
} from "./platformActivity.js";
import { buildPolymarketClient, UpstreamError } from "./polymarketClient.js";
import { buildAuthRateLimiter } from "./rateLimit.js";
import {
  MemoryWalletRepository,
  PostgresWalletRepository,
  WalletError,
} from "./wallets.js";
import { buildCoinWalletService, CoinWalletError } from "./coinWallets.js";
import {
  buildExchangeRateProvider,
  ExchangeRateError,
} from "./exchangeRates.js";
import { registerHealthRoutes } from "./routes/healthRoutes.js";
import { registerMarketRoutes } from "./routes/marketRoutes.js";
import { registerEventRoutes } from "./routes/eventRoutes.js";
import { registerAuthRoutes } from "./routes/authRoutes.js";
import { registerComplianceRoutes } from "./routes/complianceRoutes.js";
import { registerWalletRoutes } from "./routes/walletRoutes.js";
import { registerCoinRoutes } from "./routes/coinRoutes.js";
import { registerTradingRoutes } from "./routes/tradingRoutes.js";
import { registerMarketActivityRoutes } from "./routes/marketActivityRoutes.js";
import { registerPlatformActivityRoutes } from "./routes/platformActivityRoutes.js";
import { registerAdminRoutes } from "./routes/adminRoutes.js";
import { registerWatchlistRoutes } from "./routes/watchlistRoutes.js";
import { MemoryWatchlistRepository, PostgresWatchlistRepository } from "./watchlistRepository.js";

let appPromise: Promise<Fastify.FastifyInstance> | null = null;

export function buildApp(config: AppConfig = getConfig()) {
  assertNoProductionMemoryFallback(config);

  const app = Fastify({
    logger: true,
  });
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    (request as typeof request & { rawBody?: Buffer }).rawBody = rawBody;
    try {
      done(null, rawBody.length ? JSON.parse(rawBody.toString("utf8")) : null);
    } catch (error) {
      done(error as Error);
    }
  });
  const db = buildDatabase(config);
  const polymarket = buildPolymarketClient(config);
  const cache = new MemoryCacheStore(config.cacheEnabled);
  const marketRepository = db.enabled
    ? new PostgresMarketRepository(db)
    : new MemoryMarketRepository();
  const marketPriceHistoryRepository = db.enabled
    ? new PostgresMarketPriceHistoryRepository(db)
    : new MemoryMarketPriceHistoryRepository();
  const authRepositories = db.enabled ? buildPostgresAuthRepositories(db) : undefined;
  const twoFactor = buildTwoFactorService(
    db.enabled ? new PostgresTwoFactorRepository(db, config) : new MemoryTwoFactorRepository(),
    config,
  );
  const auth = buildAuthService({ config, repositories: authRepositories, twoFactor });
  const audit = buildAuditService(
    db.enabled ? new PostgresAuditLogRepository(db) : new MemoryAuditLogRepository(),
  );
  const emailProvider = buildEmailProvider(config);
  const verification = buildVerificationService({
    config,
    repository: db.enabled
      ? new PostgresVerificationRepository(db)
      : new MemoryVerificationRepository(),
    emailProvider,
  });
  const compliance = buildComplianceService({
    repository: db.enabled
      ? new PostgresComplianceRepository(db)
      : new MemoryComplianceRepository(),
    audit,
  });
  const coins = db.enabled ? new PostgresCoinLedgerRepository(db) : null;
  const exchangeRates = buildExchangeRateProvider(config);
  const coinWallets = db.enabled
    ? buildCoinWalletService({
        db,
        rateProvider: exchangeRates,
        rateTtlSeconds: config.exchangeRateTtlSeconds,
        requiredConfirmations: config.walletDepositMinConfirmations,
        usdtTronContract: config.usdtTronContract,
        allowDepositCredits: false,
      })
    : null;
  const portfolioRepository = db.enabled
    ? new PostgresPortfolioRepository(db)
    : new MemoryPortfolioRepository();
  const marketActivityRepository = db.enabled
    ? new PostgresMarketActivityRepository(db)
    : new MemoryMarketActivityRepository();
  const platformActivityRepository = db.enabled
    ? new PostgresPlatformActivityRepository(db)
    : new MemoryPlatformActivityRepository();
  const watchlistRepository = db.enabled
    ? new PostgresWatchlistRepository(db)
    : new MemoryWatchlistRepository();
  const walletRepository = db.enabled
    ? new PostgresWalletRepository(db)
    : new MemoryWalletRepository();
  const admin = buildAdminService({
    repository: db.enabled ? new PostgresAdminRepository(db) : new MemoryAdminRepository(),
    walletRepository,
  });
  const adminPanelAuth = buildAdminPanelAuthService(config);
  const settlement = buildSettlementService({
    repository: db.enabled
      ? new PostgresSettlementRepository(db)
      : new MemorySettlementRepository(),
    portfolioRepository,
    coinLedger: coins,
    audit,
    requireAtomicSettlementCommits: true,
  });
  const authRateLimiter = buildAuthRateLimiter(config);
  const marketData = buildMarketDataService({
    config,
    cache,
    polymarket,
    marketRepository,
    marketActivityRepository,
    priceHistoryRepository: marketPriceHistoryRepository,
  });
  const marketSeed = buildMarketSeedService({
    marketData,
    priceHistoryRepository: marketPriceHistoryRepository,
  });
  const platformActivity = buildPlatformActivityService(platformActivityRepository);
  let snapshotCollectorTimer: ReturnType<typeof setInterval> | null = null;

  if (!db.enabled) {
    app.log.warn("Database disabled. Set DATABASE_URL to enable Postgres repositories.");
  }

  app.addHook("onClose", async () => {
    if (snapshotCollectorTimer) {
      clearInterval(snapshotCollectorTimer);
    }

    await authRateLimiter.close?.();
    await db.close();
  });

  app.register(cors, {
    origin: config.corsAllowedOrigins.length > 0 ? config.corsAllowedOrigins : true,
    credentials: true,
  });

  app.addHook("preHandler", async (request, reply) => {
    const isSignedDepositWebhook =
      request.method === "POST" &&
      request.routeOptions.url === "/api/wallets/webhooks/deposits";

    if (
      !config.csrfProtectionEnabled ||
      !isStateChangingMethod(request.method) ||
      isSignedDepositWebhook
    ) {
      return;
    }

    if (!validateCsrfRequest(request, config)) {
      return reply.status(403).send({
        data: null,
        error: {
          code: "CSRF_TOKEN_INVALID",
          message: "CSRF token is missing or invalid.",
        },
      });
    }
  });

  app.addHook("preHandler", async (request) => {
    const context = await auth.authenticateToken(
      getSessionTokenFromRequest(request, config.sessionCookieName),
    );

    if (context) {
      (request as typeof request & { auth: typeof context }).auth = context;
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UpstreamError) {
      return reply.status(502).send({
        data: null,
        error: {
          code: "UPSTREAM_ERROR",
          message: error.message,
          upstreamStatusCode: error.statusCode,
          details: error.details,
        },
      });
    }

    if (error instanceof MarketDataError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }

    if (error instanceof ComplianceError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AuthError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AdminPanelAuthError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof WalletError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof CoinLedgerError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof CoinWalletError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ExchangeRateError) {
      return reply.status(503).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AdminError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof SettlementError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      data: null,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error",
      },
    });
  });

  // Register route modules
  registerHealthRoutes(app, config, db, marketData);
  registerEventRoutes(app, polymarket, marketData);
  registerMarketRoutes(app, marketData);
  registerMarketActivityRoutes(app, audit, marketActivityRepository, marketData);
  registerPlatformActivityRoutes(app, platformActivity);
  registerAuthRoutes(app, auth, audit, config, authRateLimiter, verification, twoFactor);
  registerComplianceRoutes(app, auth, compliance, config);
  registerWalletRoutes(app, auth, audit, config, coinWallets);
  registerCoinRoutes(app, auth, config, coins);
  registerTradingRoutes(
    app,
    auth,
    config,
    audit,
    marketData,
    coins,
    portfolioRepository,
    compliance,
    marketActivityRepository,
    settlement.repository,
    {
      requirePersistentUserState: db.enabled || config.nodeEnv === "production",
      requireAtomicTradeCommits: true,
    },
  );
  registerAdminRoutes(
    app,
    auth,
    audit,
    admin,
    config,
    settlement,
    marketSeed,
    adminPanelAuth,
    coinWallets,
  );
  registerWatchlistRoutes(app, auth, config, watchlistRepository);

  if (config.marketSnapshotCollectorEnabled && config.marketSnapshotCollectorMarketIds.length > 0) {
    const collectConfiguredSnapshots = async () => {
      const result = await marketData.collectMarketSnapshots(config.marketSnapshotCollectorMarketIds);
      if (result.errors.length > 0) {
        app.log.warn({ errors: result.errors }, "Market snapshot collector finished with errors.");
      } else {
        app.log.info({ count: result.data.length }, "Market snapshot collector saved snapshots.");
      }
    };

    app.addHook("onReady", async () => {
      void collectConfiguredSnapshots();
      snapshotCollectorTimer = setInterval(
        () => void collectConfiguredSnapshots(),
        config.marketSnapshotCollectorIntervalMs,
      );
    });
  }

  return app;
}

function assertNoProductionMemoryFallback(config: AppConfig) {
  if (config.nodeEnv === "production" && !config.databaseUrl) {
    throw new Error(
      "DATABASE_URL is required in production; critical runtime state cannot use memory fallback.",
    );
  }
}

function getReadyApp() {
  if (!appPromise) {
    appPromise = Promise.resolve()
      .then(() => {
        const app = buildApp(getConfig());
        return app.ready().then(() => app);
      })
      .catch((error) => {
        appPromise = null;
        throw error;
      });
  }

  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (shouldServeSpa(req)) {
      if (await serveStaticAsset(req, res)) {
        return;
      }
    }

    const app = await getReadyApp();
    await forwardToFastify(app, req, res);
  } catch (error) {
    console.error("Serverless startup failed", error);
    sendStartupDiagnostic(res, error);
  }
}

function shouldServeSpa(req: IncomingMessage) {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  return !path.startsWith("/api") && path !== "/health";
}

async function serveStaticAsset(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/favicon.ico" || pathname === "/favicon.png") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  const staticRoot = join(process.cwd(), "dist-web");
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = join(staticRoot, normalizedPath);
  const assetPath = await fileExists(candidate) ? candidate : join(staticRoot, "index.html");

  if (!(await fileExists(assetPath))) {
    return false;
  }

  res.statusCode = 200;
  res.setHeader("content-type", contentTypeFor(assetPath));

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  await new Promise<void>((resolve, reject) => {
    createReadStream(assetPath)
      .once("error", reject)
      .once("end", resolve)
      .pipe(res);
  });

  return true;
}

async function fileExists(path: string) {
  try {
    const stats = await stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}

function contentTypeFor(path: string) {
  const extension = extname(path);
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
  };

  return contentTypes[extension] ?? "application/octet-stream";
}

function forwardToFastify(
  app: Fastify.FastifyInstance,
  req: IncomingMessage,
  res: ServerResponse,
) {
  return new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("close", resolve);
    res.once("error", reject);
    app.server.emit("request", req, res);
  });
}

function sendStartupDiagnostic(res: ServerResponse, error: unknown) {
  if (res.headersSent || res.writableEnded) {
    return;
  }

  const missing = requiredProductionEnv.filter((name) => !process.env[name]?.trim());

  res.statusCode = 500;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      data: null,
      error: {
        code: "STARTUP_CONFIGURATION_ERROR",
        message: "API startup failed. Check the Vercel environment variables.",
        details: {
          configError: error instanceof Error ? error.message : "Unknown startup error.",
          requiredProductionEnv,
          missing,
        },
      },
    }),
  );
}

const requiredProductionEnv = [
  "APP_MODE",
  "NODE_ENV",
  "DATABASE_URL",
  "DATABASE_SSL",
  "SESSION_SECRET",
  "SESSION_COOKIE_SECURE",
  "CORS_ALLOWED_ORIGINS",
];

const isEntrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isEntrypoint) {
  const config = getConfig();
  const app = buildApp(config);

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
