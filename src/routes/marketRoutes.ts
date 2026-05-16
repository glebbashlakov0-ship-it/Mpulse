import type { FastifyInstance } from "fastify";
import { type MarketDataService } from "../marketDataService.js";
import { marketSnapshotSchema } from "../snapshots.js";

export function registerMarketRoutes(app: FastifyInstance, marketData: MarketDataService) {
  app.get("/api/markets", async (request) => {
    const result = await marketData.listMarkets(request.query as Record<string, unknown>);

    return {
      data: result.data,
      meta: result.meta,
    };
  });

  app.get<{ Params: { id: string } }>("/api/markets/:id", async (request) => {
    const result = await marketData.getMarketDetail(request.params.id);

    return {
      data: result.data,
      meta: result.meta,
    };
  });

  app.get<{ Params: { marketId: string } }>("/api/market-groups/by-market/:marketId", async (request) => {
    const result = await marketData.getMarketGroupByMarketId(request.params.marketId);

    return {
      data: result.data,
      meta: result.meta,
    };
  });

  app.post<{ Params: { id: string } }>("/api/markets/:id/snapshots/collect", async (request) => {
    const result = await marketData.collectMarketSnapshot(request.params.id);

    return {
      data: result.data,
      meta: result.meta,
    };
  });

  app.get("/api/categories", async () => ({
    data: await marketData.listCategories(),
  }));

  app.get("/api/tags", async () => ({
    data: await marketData.listTags(),
  }));

  app.get("/api/search", async (request) => {
    const query = request.query as Record<string, unknown>;
    const result = await marketData.listMarkets({
      ...query,
      search: query.search ?? query.q,
      sort: query.sort ?? "relevance",
    });

    return {
      data: result.data,
      meta: result.meta,
    };
  });

  app.get("/api/market-snapshots/schema", async () => ({
    data: marketSnapshotSchema,
  }));
}
