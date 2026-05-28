import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, type AuthService, getAuthContext, requireAuth } from "../auth.js";
import { type AuditService } from "../audit.js";
import type { AppConfig } from "../config.js";
import type { ComplianceService } from "../compliance.js";
import { type MarketDataService } from "../marketDataService.js";
import {
  createTradingQuote,
  getPortfolio,
  placeLocalOrder,
  placeTrade,
  resetPortfolio,
  type TradeSide,
  type TradeAction,
} from "../trading.js";
import type { PortfolioRepository } from "../portfolioRepository.js";
import type { MarketActivityRepository } from "../marketActivityRepository.js";
import type { SettlementRepository } from "../settlement.js";
import { syncTradingMarketActivity } from "../tradingActivitySync.js";

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
  amount?: unknown;
  shares?: unknown;
}): (
  | {
      ok: true;
      marketId: string;
      side: TradeSide;
      action: TradeAction;
      amount?: number;
      shares?: number;
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
  const amount = typeof body?.amount === "number" ? body.amount : undefined;
  const shares = typeof body?.shares === "number" ? body.shares : undefined;

  if (!marketId || !side || !action || (amount === undefined && shares === undefined)) {
    return {
      ok: false,
      code: "INVALID_TRADE_REQUEST",
      message: "marketId, side, action, and amount or shares are required.",
    };
  }

  return {
    ok: true,
    marketId,
    side,
    action,
    amount,
    shares,
  };
}

export function registerTradingRoutes(
  app: FastifyInstance,
  auth: AuthService,
  config: AppConfig,
  audit: AuditService,
  marketData: MarketDataService,
  ledger: import("../ledger.js").LedgerService,
  portfolioRepository?: PortfolioRepository,
  compliance?: ComplianceService,
  marketActivityRepository?: MarketActivityRepository,
  settlementRepository?: SettlementRepository,
  options: { requirePersistentUserState?: boolean } = {},
) {
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

  async function ensureEligibleForOrder(request: FastifyRequest, reply: FastifyReply) {
    const context = getRequiredContext(request);

    if (!context || !compliance) {
      return { ok: true as const, context };
    }

    const eligibility = await compliance.getEligibility({
      userId: context.user.id,
      sessionId: context.session.id,
    });

    if (eligibility.canTradeLocal) {
      return { ok: true as const, context, eligibility };
    }

    await audit.record({
      eventType: "trading.rejected",
      userId: context.user.id,
      sessionId: context.session.id,
      metadata: {
        reason: "KYC_ELIGIBILITY_REQUIRED",
        reasons: eligibility.reasons,
      },
    });

    reply.status(403).send({
      data: null,
      error: {
        code: "KYC_ELIGIBILITY_REQUIRED",
        message: "Complete verification and legal acknowledgements before trading.",
        reasons: eligibility.reasons,
      },
    });
    return { ok: false as const };
  }

  app.get("/api/portfolio", authenticatedStateRoute, async (request) => ({
    data: await getPortfolio(
      getRequiredContext(request)?.user.id,
      ledger,
      getAuthContext(request) ? portfolioRepository : undefined,
      getAuthContext(request) ? settlementRepository : undefined,
    ),
  }));

  app.post<{
    Body: {
      marketId?: unknown;
      side?: unknown;
      action?: unknown;
      amount?: unknown;
      shares?: unknown;
    };
  }>("/api/trading/quote", authenticatedStateRoute, async (request, reply) => {
    const context = getRequiredContext(request);
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
    const result = await createTradingQuote({
      market,
      side: parsed.side,
      action: parsed.action,
      amount: parsed.amount,
      shares: parsed.shares,
      userId: context?.user.id,
      ledger,
      portfolioRepository: context ? portfolioRepository : undefined,
      settlementRepository: context ? settlementRepository : undefined,
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
        amount: result.quote.amount,
        shares: result.quote.shares,
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
      amount?: unknown;
      shares?: unknown;
      idempotencyKey?: unknown;
    };
  }>("/api/trading/orders", authenticatedStateRoute, async (request, reply) => {
    const eligibilityResult = await ensureEligibleForOrder(request, reply);
    if (!eligibilityResult.ok) {
      return reply;
    }

    const context = eligibilityResult.context;
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
    const result = await placeLocalOrder({
      market,
      side: parsed.side,
      action: parsed.action,
      amount: parsed.amount,
      shares: parsed.shares,
      userId: context?.user.id,
      idempotencyKey,
      ledger,
      portfolioRepository: context ? portfolioRepository : undefined,
      settlementRepository: context ? settlementRepository : undefined,
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

    if (!result.idempotent) {
      await syncTradingMarketActivity({
        repository: marketActivityRepository,
        displayName: context?.user.displayName ?? "Pulse Trader",
        result,
      });
    }

    if (!result.idempotent) {
      await audit.record({
        eventType: result.trade.action === "buy" ? "trading.buy_local" : "trading.sell_local",
        userId: context?.user.id,
        sessionId: context?.session.id,
        metadata: {
          marketId: result.trade.marketId,
          side: result.trade.side,
          amount: result.trade.amount,
          shares: result.trade.shares,
          price: result.trade.price,
          idempotencyKey,
        },
      });
    }

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

  app.get("/api/trading/positions", authenticatedStateRoute, async (request) => ({
    data: await getPortfolio(
      getRequiredContext(request)?.user.id,
      ledger,
      getAuthContext(request) ? portfolioRepository : undefined,
      getAuthContext(request) ? settlementRepository : undefined,
    ),
  }));

  app.get("/api/trading/trades", authenticatedStateRoute, async (request) => ({
    data: (
      await getPortfolio(
        getRequiredContext(request)?.user.id,
        ledger,
        getAuthContext(request) ? portfolioRepository : undefined,
        getAuthContext(request) ? settlementRepository : undefined,
      )
    ).trades,
  }));

  app.post<{
    Body: {
      marketId?: string;
      side?: TradeSide;
      amount?: number;
    };
  }>("/api/trading/trades", authenticatedStateRoute, async (request, reply) => {
    const { marketId, side, amount } = request.body;

    if (!marketId || (side !== "yes" && side !== "no") || typeof amount !== "number") {
      return reply.status(400).send({
        data: null,
        error: {
          code: "INVALID_TRADE_REQUEST",
          message: "marketId, side, and amount are required.",
        },
      });
    }

    const market = (await marketData.getMarketDetail(marketId)).data;
    const result = await placeTrade({
      market,
      side,
      amount,
      userId: getAuthContext(request)?.user.id,
      ledger,
      portfolioRepository: getAuthContext(request) ? portfolioRepository : undefined,
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

  app.post("/api/portfolio/reset", authenticatedStateRoute, async (request) => ({
    data: await resetPortfolio(
      getRequiredContext(request)?.user.id,
      ledger,
      getAuthContext(request) ? portfolioRepository : undefined,
      getAuthContext(request) ? settlementRepository : undefined,
    ),
  }));
}
