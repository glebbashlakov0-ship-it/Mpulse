import type { AppConfig } from "./config.js";
import type { PolymarketPriceHistoryResponse, PolymarketTag } from "./types.js";
import {
  coinMicros,
  formatAtomic,
  parseDecimalToAtomic,
  type CoinMicros,
} from "./money.js";

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
  "is_carousel",
  "limit",
  "offset",
  "order",
  "q",
  "search",
  "sort",
  "tag",
  "slug",
  "tag_id",
  "tag_slug",
  "trending",
]);

const allowedClobQueryParams = new Set(["market", "interval", "fidelity"]);

export const CLOB_QUOTE_DECIMALS = 6;
export const CLOB_SHARE_DECIMALS = 6;
export const CLOB_PRICE_DECIMALS = 9;

export function coinMicrosToClobQuoteAmount(value: CoinMicros): string {
  return formatAtomic(value, CLOB_QUOTE_DECIMALS);
}

export function clobQuoteAmountToCoinMicros(value: string): CoinMicros {
  return coinMicros(
    parseDecimalToAtomic(value, CLOB_QUOTE_DECIMALS, { allowZero: false }),
    false,
  );
}

export function normalizeClobShares(value: string): string {
  const atomic = parseDecimalToAtomic(value, CLOB_SHARE_DECIMALS, {
    allowZero: false,
  });
  return formatAtomic(atomic, CLOB_SHARE_DECIMALS);
}

export function normalizeClobPrice(value: string): string {
  const atomic = parseDecimalToAtomic(value, CLOB_PRICE_DECIMALS, {
    allowZero: false,
  });
  if (atomic > 10n ** BigInt(CLOB_PRICE_DECIMALS)) {
    throw new UpstreamError("Polymarket CLOB price must be between 0 and 1.", 400);
  }
  return formatAtomic(atomic, CLOB_PRICE_DECIMALS);
}

export function clobDecimalToSdkNumber(value: string, decimals: number): number {
  const atomic = parseDecimalToAtomic(value, decimals, { allowZero: false });
  const normalized = formatAtomic(atomic, decimals);
  const sdkValue = Number(normalized);
  if (!Number.isFinite(sdkValue) || sdkValue <= 0) {
    throw new UpstreamError("Polymarket CLOB amount is outside the SDK range.", 400);
  }
  return sdkValue;
}

export function clobSdkNumberToDecimal(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new UpstreamError("Polymarket CLOB returned an invalid decimal value.", 502);
  }
  const raw = value.toString();
  if (/e/i.test(raw)) {
    throw new UpstreamError(
      "Polymarket CLOB returned an unsupported exponential decimal.",
      502,
    );
  }
  const atomic = parseDecimalToAtomic(raw, decimals, { allowZero: false });
  return formatAtomic(atomic, decimals);
}

export function buildPolymarketClient(config: AppConfig) {
  async function requestPolymarketHomepageTags(): Promise<PolymarketTag[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.polymarketRequestTimeoutMs);
    let response: Response;

    try {
      response = await fetch("https://polymarket.com/", {
        signal: controller.signal,
        headers: {
          accept: "text/html",
          "user-agent": "arabic-prediction-market-api/0.1.0",
        },
      });
    } catch (error) {
      throw new UpstreamError(
        error instanceof Error && error.name === "AbortError"
          ? "Polymarket homepage request timed out"
          : "Polymarket homepage request failed",
        0,
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const details = await response.text().catch(() => undefined);
      throw new UpstreamError(
        `Polymarket homepage request failed: ${response.status} ${response.statusText}`,
        response.status,
        details,
      );
    }

    const html = await response.text();
    const nextData = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    )?.[1];

    if (!nextData) {
      return [];
    }

    const parsed = JSON.parse(nextData) as {
      props?: {
        pageProps?: {
          dehydratedState?: {
            queries?: Array<{
              queryKey?: unknown[];
              state?: { data?: unknown };
            }>;
          };
        };
      };
    };
    const queries = parsed.props?.pageProps?.dehydratedState?.queries ?? [];
    const homepageTags = queries.find((query) => {
      const key = query.queryKey ?? [];
      return (
        key[0] === "/api/tags" &&
        key[1] === "filteredTagsBySlug" &&
        key[2] === "all" &&
        key[3] === "active"
      );
    })?.state?.data;

    return Array.isArray(homepageTags) ? (homepageTags as PolymarketTag[]) : [];
  }

  async function request<T>(
    path: string,
    query: Record<string, unknown> = {},
    baseUrl = config.polymarketGammaUrl,
    allowedParams = allowedQueryParams,
  ): Promise<T> {
    const url = new URL(path, baseUrl);

    for (const [key, value] of Object.entries(query)) {
      if (!allowedParams.has(key) || value === undefined || value === null) {
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
    getHomepageTags: requestPolymarketHomepageTags,
    search: <T>(query: Record<string, unknown>) =>
      request<T>("/public-search", query),
    getPriceHistory: (
      tokenId: string,
      options: { interval?: string; fidelity?: number } = {},
    ) => {
      const market = tokenId.trim();

      if (!market) {
        throw new UpstreamError("Polymarket CLOB token id is required.", 400);
      }

      return request<PolymarketPriceHistoryResponse>(
        "/prices-history",
        {
          market,
          interval: options.interval ?? "all",
          fidelity: options.fidelity,
        },
        config.polymarketClobUrl,
        allowedClobQueryParams,
      );
    },
  };
}

export type PolymarketClient = ReturnType<typeof buildPolymarketClient>;
