import type { FastifyInstance } from "fastify";
import type { PlatformActivityService } from "../platformActivity.js";

function parseActivityLimit(value: unknown) {
  if (typeof value !== "string") {
    return 30;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 30;
}

export function registerPlatformActivityRoutes(
  app: FastifyInstance,
  platformActivity: PlatformActivityService,
) {
  app.get<{ Querystring: { limit?: unknown } }>("/api/platform/activity", async (request) => ({
    data: {
      activity: await platformActivity.listRecent(parseActivityLimit(request.query.limit)),
    },
  }));
}
