import type { AppConfig } from "./config.js";

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const allowedQueryParams = new Set([
  "active",
  "archived",
  "ascending",
  "category",
  "closed",
  "featured",
  "id",
  "limit",
  "offset",
  "order",
  "q",
  "search",
  "sort",
  "tag",
  "slug",
  "tag_id",
]);

export function buildPolymarketClient(config: AppConfig) {
  async function request<T>(
    path: string,
    query: Record<string, unknown> = {},
  ): Promise<T> {
    const url = new URL(path, config.polymarketGammaUrl);

    for (const [key, value] of Object.entries(query)) {
      if (!allowedQueryParams.has(key) || value === undefined || value === null) {
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.polymarketRequestTimeoutMs);
    let response: Response;

    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "arabic-prediction-market-api/0.1.0",
        },
      });
    } catch (error) {
      throw new UpstreamError(
        error instanceof Error && error.name === "AbortError"
          ? "Polymarket request timed out"
          : "Polymarket request failed",
        0,
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const details = await response.text().catch(() => undefined);
      throw new UpstreamError(
        `Polymarket request failed: ${response.status} ${response.statusText}`,
        response.status,
        details,
      );
    }

    return (await response.json()) as T;
  }

  return {
    getEvents: <T>(query: Record<string, unknown>) => request<T>("/events", query),
    getEvent: <T>(id: string) => request<T>(`/events/${encodeURIComponent(id)}`),
    getMarkets: <T>(query: Record<string, unknown>) =>
      request<T>("/markets", query),
    getMarket: <T>(id: string) => request<T>(`/markets/${encodeURIComponent(id)}`),
    getTags: <T>(query: Record<string, unknown>) => request<T>("/tags", query),
    search: <T>(query: Record<string, unknown>) =>
      request<T>("/public-search", query),
  };
}

export type PolymarketClient = ReturnType<typeof buildPolymarketClient>;
