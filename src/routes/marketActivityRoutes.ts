import type { FastifyInstance } from "fastify";
import { getAuthContext } from "../auth.js";
import { type AuditService } from "../audit.js";
import type { MarketDataService } from "../marketDataService.js";
import type {
  MarketActivityRepository,
  MarketCommentRecord,
  MarketTradeActivityRecord,
} from "../marketActivityRepository.js";
import { isLegacyDemoMarketActivity } from "../marketActivityRepository.js";

type MarketActivityItem =
  | (MarketTradeActivityRecord & { type: "trade" })
  | (MarketCommentRecord & { type: "comment" });

type MarketActivityQuery = {
  marketIds?: string | string[];
};

function parseCommentBody(body: { body?: unknown; positionLabel?: unknown }) {
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  const positionLabel =
    typeof body?.positionLabel === "string" && body.positionLabel.trim()
      ? body.positionLabel.trim().slice(0, 80)
      : null;

  if (!text || text.length > 1200) {
    return {
      ok: false as const,
      message: "Comment must be between 1 and 1200 characters.",
    };
  }

  return {
    ok: true as const,
    body: text,
    positionLabel,
  };
}

async function buildMarketActivityPayload(
  marketId: string,
  repository: MarketActivityRepository,
  marketData?: MarketDataService,
  requestedMarketIds?: string[],
) {
  const activityMarketIds =
    requestedMarketIds && requestedMarketIds.length > 0
      ? requestedMarketIds
      : await resolveActivityMarketIds(marketId, marketData);
  const [comments, topHolders, positions, trades] = await Promise.all([
    repository.listComments(marketId, 100),
    repository.listTopHolders(marketId, 20),
    repository.listPositions(marketId, 50),
    listActivityTrades(activityMarketIds, repository, 100),
  ]);
  const visibleComments = comments.filter((comment) => !isLegacyDemoMarketActivity(comment));
  const visibleTopHolders = topHolders.filter((holder) => !isLegacyDemoMarketActivity(holder));
  const visiblePositions = positions.filter((position) => !isLegacyDemoMarketActivity(position));
  const visibleTrades = trades.filter((trade) => !isLegacyDemoMarketActivity(trade));
  const activity: MarketActivityItem[] = [
    ...visibleTrades.map((trade) => ({ ...trade, type: "trade" as const })),
    ...visibleComments.map((comment) => ({ ...comment, type: "comment" as const })),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  return {
    comments: visibleComments,
    topHolders: visibleTopHolders,
    positions: visiblePositions,
    activity,
  };
}

async function resolveActivityMarketIds(marketId: string, marketData?: MarketDataService) {
  if (!marketData) {
    return [marketId];
  }

  try {
    const detail = (await marketData.getMarketDetail(marketId)).data;
    const groupMarketIds = (detail.group_markets ?? [])
      .map((groupMarket) => groupMarket.id)
      .filter(Boolean);

    if (groupMarketIds.length > 1) {
      return [...new Set(groupMarketIds)];
    }
  } catch {
    return [marketId];
  }

  return [marketId];
}

function parseRequestedMarketIds(marketId: string, query: MarketActivityQuery) {
  const rawValues = Array.isArray(query.marketIds) ? query.marketIds : [query.marketIds];
  const ids = rawValues
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9:_-]{1,80}$/.test(value));
  if (ids.length === 0) {
    return undefined;
  }

  const uniqueIds = [...new Set([marketId, ...ids])];

  return uniqueIds.slice(0, 200);
}

async function listActivityTrades(
  marketIds: string[],
  repository: MarketActivityRepository,
  limit: number,
) {
  if (repository.listTradesForMarkets) {
    return repository.listTradesForMarkets(marketIds, limit);
  }

  const trades = await Promise.all(
    marketIds.map((marketId) => repository.listTrades(marketId, limit)),
  );
  return trades
    .flat()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

export function registerMarketActivityRoutes(
  app: FastifyInstance,
  audit: AuditService,
  repository: MarketActivityRepository,
  marketData?: MarketDataService,
) {
  app.get<{ Params: { id: string }; Querystring: MarketActivityQuery }>(
    "/api/markets/:id/activity",
    async (request) => ({
      data: await buildMarketActivityPayload(
        request.params.id,
        repository,
        marketData,
        parseRequestedMarketIds(request.params.id, request.query),
      ),
    }),
  );

  app.post<{
    Params: { id: string };
    Querystring: MarketActivityQuery;
    Body: {
      body?: unknown;
      positionLabel?: unknown;
    };
  }>("/api/markets/:id/comments", async (request, reply) => {
    const parsed = parseCommentBody(request.body);

    if (!parsed.ok) {
      return reply.status(400).send({
        data: null,
        error: {
          code: "INVALID_COMMENT",
          message: parsed.message,
        },
      });
    }

    const authContext = getAuthContext(request);
    const displayName = authContext?.user.displayName ?? "Guest Trader";
    const comment = await repository.createComment({
      marketId: request.params.id,
      userId: authContext?.user.id ?? null,
      displayName,
      body: parsed.body,
      positionLabel: parsed.positionLabel,
    });

    await audit.record({
      eventType: "market.comment_created",
      userId: authContext?.user.id,
      sessionId: authContext?.session.id,
      metadata: {
        marketId: request.params.id,
        commentId: comment.id,
      },
    });

    return {
      data: await buildMarketActivityPayload(
        request.params.id,
        repository,
        marketData,
        parseRequestedMarketIds(request.params.id, request.query),
      ),
    };
  });
}
