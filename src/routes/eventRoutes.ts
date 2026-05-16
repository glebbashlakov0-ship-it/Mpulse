import type { FastifyInstance } from "fastify";
import { normalizeEvent } from "../normalizers.js";
import { type MarketDataService } from "../marketDataService.js";
import { type PolymarketClient } from "../polymarketClient.js";
import type { PolymarketEvent } from "../types.js";

export function registerEventRoutes(
  app: FastifyInstance,
  polymarket: PolymarketClient,
  marketData?: MarketDataService,
) {
  app.get("/api/events", async (request) => {
    const events = await polymarket.getEvents<PolymarketEvent[]>(
      request.query as Record<string, unknown>,
    );

    return {
      data: events.map(normalizeEvent),
    };
  });

  app.get<{ Params: { slug: string } }>("/api/events/:slug", async (request) => {
    if (marketData) {
      const result = await marketData.getEventBySlugOrId(request.params.slug);

      return {
        data: result.data,
        meta: result.meta,
      };
    }

    const events = await polymarket.getEvents<PolymarketEvent[]>({
      slug: request.params.slug,
    });
    const event = events[0];

    return {
      data: event ? normalizeEvent(event) : null,
    };
  });
}
