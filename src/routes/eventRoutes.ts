import type { FastifyInstance } from "fastify";
import { normalizeEvent } from "../normalizers.js";
import { type PolymarketClient } from "../polymarketClient.js";
import type { PolymarketEvent } from "../types.js";

export function registerEventRoutes(
  app: FastifyInstance,
  polymarket: PolymarketClient,
) {
  // TODO: Route events through marketDataService for normalization and caching
  // For now, directly use polymarket client with normalization
  app.get("/api/events", async (request) => {
    const events = await polymarket.getEvents<PolymarketEvent[]>(
      request.query as Record<string, unknown>,
    );

    return {
      data: events.map(normalizeEvent),
    };
  });

  app.get<{ Params: { id: string } }>("/api/events/:id", async (request) => {
    const event = await polymarket.getEvent<PolymarketEvent>(request.params.id);

    return {
      data: normalizeEvent(event),
    };
  });
}
