import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, type AuthService, getAuthContext, requireAuth } from "../auth.js";
import { type AuditService } from "../audit.js";
import type { AppConfig } from "../config.js";
import type { ComplianceService } from "../compliance.js";
import { type MarketDataService } from "../marketDataService.js";
import {
  buildTradingMode,
  createCoinTradingQuote,
  getCoinPortfolio,
  placeCoinTradingOrder,
  type CoinLedgerPort,
  type TradeSide,
  type TradeAction,
} from "../trading.js";
import type { PortfolioRepository } from "../portfolioRepository.js";
import type { MarketActivityRepository } from "../marketActivityRepository.js";
import type { SettlementRepository } from "../settlement.js";
import { syncTradingMarketActivity } from "../tradingActivitySync.js";
import type { RealMoneyExecutionVenueRuntime } from "../realMoneyAdapterRuntime.js";

function getIdempotencyKey(
  request: FastifyRequest,
  body: { idempotencyKey?: unknown } | null | undefined,
) {
  const header = request.headers["idempotency-key"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const value =
    typeof headerValue === "string" && headerValue.trim()
      ? headerValue
      : typeof body?.idempotencyKey === "string"
        ? body.idempotencyKey
        : null;

  return value?.trim() || null;
}

function parseTradingRequest(body: {
  marketId?: unknown;
  side?: unknown;
  action?: unknown;
  amountCoinMicros?: unknown;
  shares?: unknown;
}): (
  | {
      ok: true;
      marketId: string;
      side: TradeSide;
      action: TradeAction;
      amountCoinMicros?: string;
      shares?: string;
    }
  | {
      ok: false;
      code: "INVALID_TRADE_REQUEST";
      message: string;
    }
) {
  const marketId = typeof body?.marketId === "string" && body.marketId.trim()
    ? body.marketId.trim()
    : null;
  const side = body?.side === "yes" || body?.side === "no" ? body.side : null;
  const action = body?.action === "buy" || body?.action === "sell" ? body.action : null;
  const amountCoinMicros =
    typeof body?.amountCoinMicros === "string"
      ? body.amountCoinMicros
      : undefined;
  const shares = typeof body?.shares === "string" ? body.shares : undefined;

  if (
    !marketId ||
    !side ||
    !action ||
    (action === "buy" && amountCoinMicros === undefined) ||
    (action === "sell" && shares === undefined)
  ) {
    return {
      ok: false,
      code: "INVALID_TRADE_REQUEST",
      message:
        "Buy orders require amountCoinMicros as an integer string; sell orders require shares as a decimal string.",
    };
  }

  return {
    ok: true,
    marketId,
    side,
    action,
    amountCoinMicros,
    shares,
  };
}

export function registerTradingRoutes(
  app: FastifyInstance,
  auth: AuthService,
  config: AppConfig,
  audit: AuditService,
  marketData: MarketDataService,
  coinLedger: CoinLedgerPort | null,
  portfolioRepository?: PortfolioRepository,
  compliance?: ComplianceService,
  marketActivityRepository?: MarketActivityRepository,
  settlementRepository?: SettlementRepository,
  options: {
    requirePersistentUserState?: boolean;
    requireAtomicTradeCommits?: boolean;
    loadRealExecutionRuntime?: () => Promise<RealMoneyExecutionVenueRuntime | null>;
  } = {},
) {
  const tradingMode = buildTradingMode(config);
  const authenticatedStateRoute = options.requirePersistentUserState
    ? {
        preHandler: (request: FastifyRequest, reply: FastifyReply) =>
          requireAuth(request, reply, auth, config),
      }
    : {};

  function getRequiredContext(request: FastifyRequest) {
    const context = getAuthContext(request);
    if (options.requirePersistentUserState && !context) {
      throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
    }
    return context;
  }

  const resolvePortfolioMarket = async (marketId: string) =>
    (await marketData.getMarketDetail(marketId)).data;

  function requireCoinRuntime(reply: FastifyReply) {
    if (coinLedger && portfolioRepository) {
      return {
        coinLedger,
        portfolioRepository,
      };
    }
    reply.status(503).send({
      data: null,
      error: {
        code: "COIN_LEDGER_UNAVAILABLE",
        message: "Persistent Coin ledger trading is unavailable.",
      },
    });
    return null;
  }

  async function ensureEligibleForOrder(request: FastifyRequest, reply: FastifyReply) {
    const context = getRequiredContext(request);

    if (!context || !compliance) {
      return { ok: true as const, context };
    }

    const eligibility = await compliance.getEligibility({
      userId: context.user.id,
      sessionId: context.session.id,
    });

    const canPlaceOrder = tradingMode.realMoneyEnabled
      ? eligibility.canUseRealMoney
      : eligibility.canTradeLocal;

    if (canPlaceOrder) {
      return { ok: true as const, context, eligibility };
    }

    const rejection = tradingMode.realMoneyEnabled
      ? {
          code: "TRADING_ELIGIBILITY_REQUIRED",
          message: "Complete the required trading profile and legal acknowledgements before trading.",
        }
      : {
          code: "TRADING_ACCOUNT_RESTRICTED",
          message: "Trading is unavailable for this account.",
        };

    await audit.record({
      eventType: "trading.rejected",
      userId: context.user.id,
      sessionId: context.session.id,
      metadata: {
        reason: rejection.code,
        reasons: eligibility.reasons,
      },
    });

    reply.status(403).send({
      data: null,
      error: {
        code: rejection.code,
        message: rejection.message,
        reasons: eligibility.reasons,
      },
    });
    return { ok: false as const };
  }

  app.get("/api/portfolio", authenticatedStateRoute, async (request, reply) => {
    const runtime = requireCoinRuntime(reply);
    if (!runtime) return reply;
    const context = getRequiredContext(request);
    if (!context) {
      return reply.status(401).send({
        data: null,
        error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
      });
    }
    return {
      data: await getCoinPortfolio({
        userId: context.user.id,
        tradingMode,
        coinLedger: runtime.coinLedger,
        portfolioRepository: runtime.portfolioRepository,
        settlementRepository,
        marketResolver: resolvePortfolioMarket,
      }),
    };
  });

  app.post<{
    Body: {
      marketId?: unknown;
      side?: unknown;
      action?: unknown;
      amountCoinMicros?: unknown;
      shares?: unknown;
    };
  }>("/api/trading/quote", authenticatedStateRoute, async (request, reply) => {
    const context = getRequiredContext(request);
    const runtime = requireCoinRuntime(reply);
    if (!runtime) return reply;
    if (!context) {
      return reply.status(401).send({
        data: null,
        error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
      });
    }
    const parsed = parseTradingRequest(request.body);

    if (!parsed.ok) {
      await audit.record({
        eventType: "trading.rejected",
        userId: context?.user.id,
        sessionId: context?.session.id,
        metadata: {
          reason: parsed.code,
          endpoint: "POST /api/trading/quote",
        },
      });
      return reply.status(400).send({
        data: null,
        error: {
          code: parsed.code,
          message: parsed.message,
        },
      });
    }

    const market = (await marketData.getMarketDetail(parsed.marketId)).data;
    const result = await createCoinTradingQuote({
      market,
      side: parsed.side,
      action: parsed.action,
      amountCoinMicros: parsed.amountCoinMicros,
      shares: parsed.shares,
      userId: context.user.id,
      tradingMode,
      coinLedger: runtime.coinLedger,
      portfolioRepository: runtime.portfolioRepository,
      settlementRepository,
    });

    if (!result.ok) {
      await audit.record({
        eventType: "trading.rejected",
        userId: context?.user.id,
        sessionId: context?.session.id,
        metadata: {
          reason: result.code,
          marketId: parsed.marketId,
          side: parsed.side,
          action: parsed.action,
        },
      });
      return reply.status(400).send({
        data: null,
        error: {
          code: result.code,
          message: result.message,
        },
      });
    }

    await audit.record({
      eventType: "trading.quote",
      userId: context?.user.id,
      sessionId: context?.session.id,
      metadata: {
        marketId: parsed.marketId,
        side: parsed.side,
        action: parsed.action,
        amountCoinMicros: result.quote.amountCoinMicros,
        shares: result.quote.shares,
        tradingMode: result.quote.tradingMode.mode,
        realMoneyEnabled: result.quote.tradingMode.realMoneyEnabled,
      },
    });

    return {
      data: result.quote,
    };
  });

  app.post<{
    Body: {
      marketId?: unknown;
      side?: unknown;
      action?: unknown;
      amountCoinMicros?: unknown;
      shares?: unknown;
      idempotencyKey?: unknown;
    };
  }>("/api/trading/orders", authenticatedStateRoute, async (request, reply) => {
    const runtime = requireCoinRuntime(reply);
    if (!runtime) return reply;
    const eligibilityResult = await ensureEligibleForOrder(request, reply);
    if (!eligibilityResult.ok) {
      return reply;
    }

    const context = eligibilityResult.context;
    if (!context) {
      return reply.status(401).send({
        data: null,
        error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
      });
    }
    const parsed = parseTradingRequest(request.body);
    const idempotencyKey = getIdempotencyKey(request, request.body);

    if (!parsed.ok) {
      await audit.record({
        eventType: "trading.rejected",
        userId: context?.user.id,
        sessionId: context?.session.id,
        metadata: {
          reason: parsed.code,
          endpoint: "POST /api/trading/orders",
          idempotencyKey,
        },
      });
      return reply.status(400).send({
        data: null,
        error: {
          code: parsed.code,
          message: parsed.message,
        },
      });
    }

    const market = (await marketData.getMarketDetail(parsed.marketId)).data;
    const realExecutionRuntime = tradingMode.realMoneyEnabled
      ? await options.loadRealExecutionRuntime?.()
      : null;
    const result = await placeCoinTradingOrder({
      market,
      side: parsed.side,
      action: parsed.action,
      amountCoinMicros: parsed.amountCoinMicros,
      shares: parsed.shares,
      userId: context.user.id,
      idempotencyKey: idempotencyKey ?? "",
      tradingMode,
      coinLedger: runtime.coinLedger,
      portfolioRepository: runtime.portfolioRepository,
      settlementRepository,
      realExecutionRuntime,
      audit: {
        sessionId: context.session.id,
      },
    });

    if (!result.ok) {
      await audit.record({
        eventType: "trading.rejected",
        userId: context?.user.id,
        sessionId: context?.session.id,
        metadata: {
          reason: result.code,
          marketId: parsed.marketId,
          side: parsed.side,
          action: parsed.action,
          idempotencyKey,
        },
      });
      return reply.status(400).send({
        data: null,
        error: {
          code: result.code,
          message: result.message,
        },
      });
    }

    const activitySync = !result.idempotent
      ? await syncTradingMarketActivity({
        repository: marketActivityRepository,
        displayName: context?.user.displayName ?? "Pulse Trader",
        result,
      })
      : null;

    const freshMarket = await marketData.getMarketDetail(parsed.marketId).catch(() => null);
    return {
      data: {
        ...result,
        market: freshMarket?.data ?? null,
        marketOdds: freshMarket
          ? {
              marketId: freshMarket.data.id,
              outcomes: freshMarket.data.outcomes,
              prices: freshMarket.data.prices,
              volume: freshMarket.data.volume,
              liquidity: freshMarket.data.liquidity,
              history: freshMarket.data.history,
            }
          : null,
      },
    };
  });

  app.get("/api/trading/positions", authenticatedStateRoute, async (request, reply) => {
    const runtime = requireCoinRuntime(reply);
    const context = getRequiredContext(request);
    if (!runtime || !context) return reply;
    return {
      data: await getCoinPortfolio({
        userId: context.user.id,
        tradingMode,
        coinLedger: runtime.coinLedger,
        portfolioRepository: runtime.portfolioRepository,
        settlementRepository,
        marketResolver: resolvePortfolioMarket,
      }),
    };
  });

  app.get("/api/trading/trades", authenticatedStateRoute, async (request, reply) => {
    const runtime = requireCoinRuntime(reply);
    const context = getRequiredContext(request);
    if (!runtime || !context) return reply;
    return {
      data: (
        await getCoinPortfolio({
          userId: context.user.id,
          tradingMode,
          coinLedger: runtime.coinLedger,
          portfolioRepository: runtime.portfolioRepository,
          settlementRepository,
        })
      ).trades,
    };
  });

  app.post<{
    Body: {
      marketId?: string;
      side?: TradeSide;
      amountCoinMicros?: string;
    };
  }>("/api/trading/trades", authenticatedStateRoute, async (request, reply) => {
    const runtime = requireCoinRuntime(reply);
    if (!runtime) return reply;
    const eligibilityResult = await ensureEligibleForOrder(request, reply);
    if (!eligibilityResult.ok) {
      return reply;
    }

    const context = eligibilityResult.context;
    if (!context) {
      return reply.status(401).send({
        data: null,
        error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
      });
    }
    const { marketId, side, amountCoinMicros } = request.body;

    if (
      !marketId ||
      (side !== "yes" && side !== "no") ||
      typeof amountCoinMicros !== "string"
    ) {
      return reply.status(400).send({
        data: null,
        error: {
          code: "INVALID_TRADE_REQUEST",
          message: "marketId, side, and amountCoinMicros are required.",
        },
      });
    }

    const market = (await marketData.getMarketDetail(marketId)).data;
    const result = await placeCoinTradingOrder({
      market,
      side,
      action: "buy",
      amountCoinMicros,
      userId: context.user.id,
      idempotencyKey: getIdempotencyKey(request, null) ?? "",
      tradingMode,
      coinLedger: runtime.coinLedger,
      portfolioRepository: runtime.portfolioRepository,
      settlementRepository,
      realExecutionRuntime: tradingMode.realMoneyEnabled
        ? await options.loadRealExecutionRuntime?.()
        : null,
    });

    if (!result.ok) {
      return reply.status(400).send({
        data: null,
        error: {
          code: result.code,
          message: result.message,
        },
      });
    }

    return {
      data: result,
    };
  });

  app.post("/api/portfolio/reset", authenticatedStateRoute, async (_request, reply) =>
    reply.status(410).send({
      data: null,
      error: {
        code: "PORTFOLIO_RESET_DISABLED",
        message:
          "Portfolio reset is disabled because Coin ledger history is immutable.",
      },
    }),
  );
}
