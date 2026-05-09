import type { FastifyInstance } from "fastify";
import { AuthError, getAuthContext, requireAuth, type AuthService } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { WatchlistRepository } from "../watchlistRepository.js";
import type { NormalizedMarket } from "../types.js";

export function registerWatchlistRoutes(
  app: FastifyInstance,
  auth: AuthService,
  config: AppConfig,
  watchlist: WatchlistRepository,
) {
  app.get(
    "/api/watchlist",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const records = await watchlist.list(context.user.id);
      return {
        data: {
          markets: records.map((record) => record.market),
        },
      };
    },
  );

  app.put<{
    Params: { marketId: string };
    Body: { market?: unknown };
  }>(
    "/api/watchlist/:marketId",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const market = request.body?.market;
      if (!isMarketSnapshot(market) || market.id !== request.params.marketId) {
        throw new AuthError("INVALID_WATCHLIST_MARKET", "A valid market snapshot is required.", 400);
      }

      const record = await watchlist.upsert({
        userId: context.user.id,
        marketId: request.params.marketId,
        market,
      });

      return {
        data: {
          market: record.market,
        },
      };
    },
  );

  app.delete<{
    Params: { marketId: string };
  }>(
    "/api/watchlist/:marketId",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      await watchlist.delete(context.user.id, request.params.marketId);
      return {
        data: {
          ok: true,
        },
      };
    },
  );
}

function isMarketSnapshot(value: unknown): value is NormalizedMarket {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      "title" in value &&
      typeof (value as { id?: unknown }).id === "string" &&
      typeof (value as { title?: unknown }).title === "string",
  );
}
