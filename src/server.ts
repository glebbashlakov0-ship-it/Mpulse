import cors from "@fastify/cors";
import Fastify from "fastify";
import { AuthError, buildAuthService, getSessionTokenFromRequest } from "./auth.js";
import { buildAdminService, MemoryAdminRepository, PostgresAdminRepository, AdminError } from "./admin.js";
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
import { buildDatabase } from "./db.js";
import {
  buildLedgerService,
  LedgerError,
  MemoryLedgerRepository,
  PostgresLedgerRepository,
} from "./ledger.js";
import { MemoryPortfolioRepository, PostgresPortfolioRepository } from "./portfolioRepository.js";
import { buildMarketDataService, MarketDataError } from "./marketDataService.js";
import { buildPolymarketClient, UpstreamError } from "./polymarketClient.js";
import { buildAuthRateLimiter } from "./rateLimit.js";
import { MemorySnapshotStore } from "./snapshots.js";
import {
  buildWalletService,
  MemoryWalletRepository,
  WalletProviderAdapter,
  PostgresWalletRepository,
  WalletError,
} from "./wallets.js";
import { registerHealthRoutes } from "./routes/healthRoutes.js";
import { registerMarketRoutes } from "./routes/marketRoutes.js";
import { registerEventRoutes } from "./routes/eventRoutes.js";
import { registerAuthRoutes } from "./routes/authRoutes.js";
import { registerComplianceRoutes } from "./routes/complianceRoutes.js";
import { registerWalletRoutes } from "./routes/walletRoutes.js";
import { registerLedgerRoutes } from "./routes/ledgerRoutes.js";
import { registerTradingRoutes } from "./routes/tradingRoutes.js";
import { registerAdminRoutes } from "./routes/adminRoutes.js";
import { registerWatchlistRoutes } from "./routes/watchlistRoutes.js";
import { MemoryWatchlistRepository, PostgresWatchlistRepository } from "./watchlistRepository.js";

export function buildApp(config: AppConfig = getConfig()) {
  assertNoProductionMemoryFallback(config);

  const app = Fastify({
    logger: true,
  });
  const db = buildDatabase(config);
  const polymarket = buildPolymarketClient(config);
  const cache = new MemoryCacheStore(config.cacheEnabled);
  const snapshots = new MemorySnapshotStore();
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
  const ledger = buildLedgerService(
    db.enabled ? new PostgresLedgerRepository(db) : new MemoryLedgerRepository(),
  );
  const portfolioRepository = db.enabled
    ? new PostgresPortfolioRepository(db)
    : new MemoryPortfolioRepository();
  const watchlistRepository = db.enabled
    ? new PostgresWatchlistRepository(db)
    : new MemoryWatchlistRepository();
  const wallets = buildWalletService({
    repository: db.enabled ? new PostgresWalletRepository(db) : new MemoryWalletRepository(),
    provider: new WalletProviderAdapter(),
    ledger,
    depositMinConfirmations: config.walletDepositMinConfirmations,
    getComplianceEligibility: (userId) => compliance.getEligibility({ userId }),
  });
  const admin = buildAdminService({
    repository: db.enabled ? new PostgresAdminRepository(db) : new MemoryAdminRepository(),
    walletRepository: wallets.repository,
  });
  const authRateLimiter = buildAuthRateLimiter(config);
  const marketData = buildMarketDataService({
    config,
    cache,
    polymarket,
    getSnapshots: (marketId) => snapshots.listForMarket(marketId),
  });

  if (!db.enabled) {
    app.log.warn("Database disabled. Set DATABASE_URL to enable Postgres repositories.");
  }

  app.addHook("onClose", async () => {
    await db.close();
  });

  app.register(cors, {
    origin: config.corsAllowedOrigins.length > 0 ? config.corsAllowedOrigins : true,
    credentials: true,
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

    if (error instanceof WalletError) {
      return reply.status(error.statusCode).send({
        data: null,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof LedgerError) {
      return reply.status(error.statusCode).send({
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
  registerEventRoutes(app, polymarket);
  registerMarketRoutes(app, marketData);
  registerAuthRoutes(app, auth, audit, config, authRateLimiter, verification, twoFactor);
  registerComplianceRoutes(app, auth, compliance, config);
  registerWalletRoutes(app, auth, audit, wallets, config);
  registerLedgerRoutes(app, auth, audit, ledger, config);
  registerTradingRoutes(app, auth, config, audit, marketData, ledger, portfolioRepository, {
    requirePersistentUserState: db.enabled || config.nodeEnv === "production",
  });
  registerAdminRoutes(app, auth, audit, admin, config);
  registerWatchlistRoutes(app, auth, config, watchlistRepository);

  return app;
}

function assertNoProductionMemoryFallback(config: AppConfig) {
  if (config.nodeEnv === "production" && !config.databaseUrl) {
    throw new Error(
      "DATABASE_URL is required in production; critical runtime state cannot use memory fallback.",
    );
  }
}

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
