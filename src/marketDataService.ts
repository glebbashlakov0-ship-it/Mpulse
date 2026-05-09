import type { AppConfig } from "./config.js";
import { createCacheKey, type CacheReadResult, type CacheStore } from "./cache.js";
import { getCategories, normalizeCategoryValue } from "./categories.js";
import { buildKeywordVisibilityRules, isMarketVisible } from "./moderation.js";
import {
  normalizeMarket,
  normalizeMarketDetail,
  normalizePriceSummary,
  toNumber,
} from "./normalizers.js";
import type {
  MarketSnapshot,
  NormalizedCategory,
  NormalizedMarket,
  NormalizedMarketDetail,
  PolymarketEvent,
  PolymarketMarket,
} from "./types.js";
import { UpstreamError } from "./polymarketClient.js";

type PolymarketClient = {
  getMarkets: <T>(query: Record<string, unknown>) => Promise<T>;
  getMarket: <T>(id: string) => Promise<T>;
  search: <T>(query: Record<string, unknown>) => Promise<T>;
};

export type MarketSort =
  | "volume"
  | "liquidity"
  | "newest"
  | "closing_soon"
  | "trending"
  | "popular"
  | "relevance";

export type MarketListParams = {
  limit?: unknown;
  offset?: unknown;
  cursor?: unknown;
  category?: unknown;
  topic?: unknown;
  search?: unknown;
  q?: unknown;
  sort?: unknown;
  active?: unknown;
  closed?: unknown;
  status?: unknown;
  min_volume?: unknown;
  max_volume?: unknown;
  closing_before?: unknown;
  closing_after?: unknown;
};

export type MarketListResult = {
  data: NormalizedMarket[];
  meta: {
    limit: number;
    offset: number;
    next_cursor: string | null;
    total: number;
    sort: MarketSort;
    lastSyncedAt: string | null;
    isStale: boolean;
    sourceStatus: MarketSourceStatus;
    warnings: string[];
  };
};

export type MarketSourceStatus = "fresh" | "cache" | "stale" | "fallback" | "unavailable";

export type MarketDataMeta = {
  lastSyncedAt: string | null;
  isStale: boolean;
  sourceStatus: MarketSourceStatus;
  warnings: string[];
};

export class MarketDataError extends Error {
  constructor(
    public readonly code:
      | "INVALID_QUERY"
      | "MARKET_NOT_FOUND"
      | "UPSTREAM_UNAVAILABLE",
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const relatedStopWords = new Set([
  "after",
  "before",
  "close",
  "market",
  "this",
  "will",
  "with",
  "from",
  "what",
  "when",
]);

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  if (["true", "1", "yes"].includes(value.toLowerCase())) {
    return true;
  }

  if (["false", "0", "no"].includes(value.toLowerCase())) {
    return false;
  }

  return undefined;
}

function parseNonNegativeInteger(value: unknown, fieldName: string, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new MarketDataError(
      "INVALID_QUERY",
      `${fieldName} must be a non-negative integer.`,
      400,
    );
  }

  return parsed;
}

function parseOptionalNonNegativeNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new MarketDataError(
      "INVALID_QUERY",
      `${fieldName} must be a non-negative number.`,
      400,
    );
  }

  return parsed;
}

function toDateMs(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new MarketDataError("INVALID_QUERY", `${fieldName} must be an ISO date string.`, 400);
  }

  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) {
    throw new MarketDataError("INVALID_QUERY", `${fieldName} must be a valid date.`, 400);
  }

  return parsed;
}

function decodeCursor(value: unknown): number | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      offset?: unknown;
    };
    return parseNonNegativeInteger(decoded.offset, "cursor offset", 0);
  } catch {
    throw new MarketDataError("INVALID_QUERY", "cursor must be a valid pagination cursor.", 400);
  }
}

function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function getSearchText(market: PolymarketMarket | NormalizedMarket) {
  const title =
    "title" in market
      ? market.title
      : "question" in market
        ? market.question
        : "";
  return `${market.category ?? ""} ${title ?? ""} ${market.description ?? ""}`.toLowerCase();
}

function getMarketKeywords(market: PolymarketMarket) {
  return (market.question ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !relatedStopWords.has(word))
    .slice(0, 8);
}

function getStatus(market: NormalizedMarket) {
  const now = Date.now();
  const endsAtMs = market.ends_at ? new Date(market.ends_at).getTime() : null;
  const startsAtMs = market.starts_at ? new Date(market.starts_at).getTime() : null;

  if (market.closed || market.archived) {
    return "closed";
  }

  if (endsAtMs !== null && Number.isFinite(endsAtMs) && endsAtMs <= now) {
    return "expired";
  }

  if (startsAtMs !== null && Number.isFinite(startsAtMs) && startsAtMs > now) {
    return "upcoming";
  }

  return "live";
}

function parseSort(value: unknown, hasSearch: boolean): MarketSort {
  if (value === undefined || value === null || value === "") {
    return hasSearch ? "relevance" : "trending";
  }

  if (typeof value === "string") {
    const normalized = value.toLowerCase().replace(/-/g, "_");
    if (
      normalized === "volume" ||
      normalized === "liquidity" ||
      normalized === "newest" ||
      normalized === "closing_soon" ||
      normalized === "trending" ||
      normalized === "popular" ||
      normalized === "relevance"
    ) {
      return normalized;
    }
  }

  throw new MarketDataError(
    "INVALID_QUERY",
    "sort must be one of volume, liquidity, newest, closing_soon, trending, popular, relevance.",
    400,
  );
}

function relevanceScore(market: NormalizedMarket, search: string) {
  if (!search) {
    return 0;
  }

  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const title = market.title.toLowerCase();
  const description = market.description?.toLowerCase() ?? "";
  const category = market.category?.toLowerCase() ?? "";

  return terms.reduce((score, term) => {
    if (title === term) {
      return score + 12;
    }
    if (title.includes(term)) {
      return score + 8;
    }
    if (category.includes(term)) {
      return score + 4;
    }
    if (description.includes(term)) {
      return score + 2;
    }
    return score;
  }, 0);
}

function trendingScore(market: NormalizedMarket) {
  const yes = normalizePriceSummary(market).yes ?? 0.5;
  const confidence = Math.abs(yes - 0.5);
  return market.volume * 0.7 + market.liquidity * 0.25 + confidence * 100_000;
}

function sortMarkets(markets: NormalizedMarket[], sort: MarketSort, search: string) {
  return [...markets].sort((left, right) => {
    if (sort === "liquidity") {
      return right.liquidity - left.liquidity;
    }

    if (sort === "newest") {
      return (
        new Date(right.starts_at ?? right.ends_at ?? 0).getTime() -
        new Date(left.starts_at ?? left.ends_at ?? 0).getTime()
      );
    }

    if (sort === "closing_soon") {
      const leftEnd = left.ends_at ? new Date(left.ends_at).getTime() : Number.MAX_SAFE_INTEGER;
      const rightEnd = right.ends_at ? new Date(right.ends_at).getTime() : Number.MAX_SAFE_INTEGER;
      return leftEnd - rightEnd;
    }

    if (sort === "relevance") {
      return (
        relevanceScore(right, search) - relevanceScore(left, search) ||
        right.volume - left.volume
      );
    }

    if (sort === "trending" || sort === "popular") {
      return trendingScore(right) - trendingScore(left);
    }

    return right.volume - left.volume;
  });
}

function extractSearchMarkets(results: { events?: PolymarketEvent[]; markets?: PolymarketMarket[] }) {
  return [
    ...(results.markets ?? []),
    ...(results.events ?? []).flatMap((event) => event.markets ?? []),
  ];
}

function dedupeMarkets(markets: PolymarketMarket[]) {
  const byId = new Map<string, PolymarketMarket>();
  for (const market of markets) {
    if (market.id) {
      byId.set(market.id, market);
    }
  }

  return [...byId.values()];
}

function isWithinDateRange(market: NormalizedMarket, before: number | null, after: number | null) {
  const endsAtMs = market.ends_at ? new Date(market.ends_at).getTime() : null;
  if (endsAtMs === null || !Number.isFinite(endsAtMs)) {
    return before === null && after === null;
  }

  if (before !== null && endsAtMs > before) {
    return false;
  }

  if (after !== null && endsAtMs < after) {
    return false;
  }

  return true;
}

function toMarketFilter(params: MarketListParams, config: AppConfig) {
  const search =
    typeof params.search === "string" && params.search.trim()
      ? params.search.trim()
      : typeof params.q === "string" && params.q.trim()
        ? params.q.trim()
        : "";
  const limit = Math.min(
    parseNonNegativeInteger(params.limit, "limit", config.defaultMarketLimit),
    config.maxMarketLimit,
  );
  const cursorOffset = decodeCursor(params.cursor);
  const offset = cursorOffset ?? parseNonNegativeInteger(params.offset, "offset", 0);
  const sort = parseSort(params.sort, search.length > 0);
  const category = normalizeCategoryValue(typeof params.category === "string" ? params.category : null);
  const topic =
    typeof params.topic === "string" && params.topic.trim().toLowerCase() !== "all"
      ? normalizeCategoryValue(params.topic)
      : null;
  const status =
    typeof params.status === "string" && params.status
      ? params.status.toLowerCase()
      : null;
  const allowedStatuses = new Set(["live", "upcoming", "closed", "expired"]);
  if (status !== null && !allowedStatuses.has(status)) {
    throw new MarketDataError(
      "INVALID_QUERY",
      "status must be one of live, upcoming, closed, expired.",
      400,
    );
  }
  const minVolume = parseOptionalNonNegativeNumber(params.min_volume, "min_volume");
  const maxVolume = parseOptionalNonNegativeNumber(params.max_volume, "max_volume");
  if (minVolume !== null && maxVolume !== null && minVolume > maxVolume) {
    throw new MarketDataError("INVALID_QUERY", "min_volume cannot be greater than max_volume.", 400);
  }

  return {
    active: toBoolean(params.active),
    closed: toBoolean(params.closed),
    category,
    topic,
    search,
    sort,
    limit,
    offset,
    status,
    minVolume,
    maxVolume,
    closingBefore: toDateMs(params.closing_before, "closing_before"),
    closingAfter: toDateMs(params.closing_after, "closing_after"),
  };
}

function buildCacheMeta<T>(
  entry: CacheReadResult<T> | null,
  sourceStatus: MarketSourceStatus,
  warnings: string[] = [],
): MarketDataMeta {
  return {
    lastSyncedAt: entry?.createdAt ?? null,
    isStale: sourceStatus === "stale" || sourceStatus === "fallback",
    sourceStatus,
    warnings,
  };
}

async function loadWithStaleFallback<T>({
  cache,
  key,
  ttlMs,
  loader,
  fallback,
}: {
  cache: CacheStore;
  key: string;
  ttlMs: number;
  loader: () => Promise<T>;
  fallback?: () => T;
}): Promise<{ value: T; meta: MarketDataMeta }> {
  const cached = cache.getEntry<T>(key);
  if (cached && !cached.isStale) {
    return {
      value: cached.value,
      meta: buildCacheMeta(cached, "cache"),
    };
  }

  try {
    const value = await loader();
    cache.set(key, value, ttlMs);
    const refreshed = cache.getEntry<T>(key);

    return {
      value,
      meta: buildCacheMeta(refreshed, "fresh"),
    };
  } catch (error) {
    if (cached) {
      return {
        value: cached.value,
        meta: buildCacheMeta(cached, "stale", [
          "Upstream unavailable; stale cached market data returned.",
        ]),
      };
    }

    if (fallback) {
      return {
        value: fallback(),
        meta: buildCacheMeta(null, "fallback", [
          "Upstream unavailable; generated fallback market data returned.",
        ]),
      };
    }

    if (error instanceof UpstreamError) {
      throw new MarketDataError(
        "UPSTREAM_UNAVAILABLE",
        "Market data upstream is unavailable and no stale cache exists.",
        503,
        {
          upstreamStatusCode: error.statusCode,
          upstreamMessage: error.message,
        },
      );
    }

    throw error;
  }
}

function mergeSourceMeta(...items: MarketDataMeta[]): MarketDataMeta {
  const priority: Record<MarketSourceStatus, number> = {
    unavailable: 5,
    fallback: 4,
    stale: 3,
    fresh: 2,
    cache: 1,
  };
  const sourceStatus = items.reduce<MarketSourceStatus>(
    (current, item) =>
      priority[item.sourceStatus] > priority[current] ? item.sourceStatus : current,
    "cache",
  );

  return {
    lastSyncedAt: items.find((item) => item.lastSyncedAt)?.lastSyncedAt ?? null,
    isStale: items.some((item) => item.isStale),
    sourceStatus,
    warnings: [...new Set(items.flatMap((item) => item.warnings))],
  };
}

export function buildMarketDataService({
  config,
  cache,
  polymarket,
  getSnapshots,
}: {
  config: AppConfig;
  cache: CacheStore;
  polymarket: PolymarketClient;
  getSnapshots?: (marketId: string) => MarketSnapshot[];
}) {
  const visibilityRules = buildKeywordVisibilityRules(config.blockedMarketTerms);

  async function getRawMarkets(params: { active?: boolean; closed?: boolean; search?: string }) {
    const baseQuery = {
      limit: config.upstreamMarketLimit,
      active: params.active,
      closed: params.closed,
      order: "volumeNum",
      ascending: false,
    };
    const ttl = params.closed ? config.cacheTtlMs.closedMarkets : config.cacheTtlMs.activeMarkets;
    const baseMarkets = await loadWithStaleFallback({
      cache,
      key: createCacheKey("polymarket:markets", baseQuery),
      ttlMs: ttl,
      loader: () => polymarket.getMarkets<PolymarketMarket[]>(baseQuery),
    });

    if (!params.search) {
      return baseMarkets;
    }

    const searchQuery = { q: params.search, limit: config.upstreamMarketLimit };
    const searchMarkets = await loadWithStaleFallback({
      cache,
      key: createCacheKey("polymarket:search", searchQuery),
      ttlMs: config.cacheTtlMs.searchResults,
      loader: async () => extractSearchMarkets(await polymarket.search(searchQuery)),
      fallback: () => [],
    });

    return {
      value: dedupeMarkets([...searchMarkets.value, ...baseMarkets.value]),
      meta: mergeSourceMeta(baseMarkets.meta, searchMarkets.meta),
    };
  }

  async function listMarkets(params: MarketListParams): Promise<MarketListResult> {
    const filter = toMarketFilter(params, config);
    const rawMarketsResult = await getRawMarkets({
      active: filter.active,
      closed: filter.closed,
      search: filter.search,
    });
    const normalized = rawMarketsResult.value
      .filter((market) => isMarketVisible(market, visibilityRules))
      .map(normalizeMarket)
      .filter((market) => {
        if (filter.active !== undefined && market.active !== filter.active) {
          return false;
        }

        if (filter.closed !== undefined && market.closed !== filter.closed) {
          return false;
        }

        if (filter.category && market.category !== filter.category) {
          return false;
        }

        if (
          filter.topic &&
          market.category !== filter.topic &&
          !market.topics.includes(filter.topic)
        ) {
          return false;
        }

        if (filter.search) {
          const text = getSearchText(market);
          const terms = filter.search.toLowerCase().split(/\s+/).filter(Boolean);
          if (!terms.every((term) => text.includes(term))) {
            return false;
          }
        }

        if (filter.status && getStatus(market) !== filter.status) {
          return false;
        }

        if (filter.minVolume !== null && market.volume < filter.minVolume) {
          return false;
        }

        if (filter.maxVolume !== null && market.volume > filter.maxVolume) {
          return false;
        }

        return isWithinDateRange(market, filter.closingBefore, filter.closingAfter);
      });
    const sorted = sortMarkets(normalized, filter.sort, filter.search);
    const data = sorted.slice(filter.offset, filter.offset + filter.limit);
    const nextOffset = filter.offset + filter.limit;

    return {
      data,
      meta: {
        limit: filter.limit,
        offset: filter.offset,
        next_cursor: nextOffset < sorted.length ? encodeCursor(nextOffset) : null,
        total: sorted.length,
        sort: filter.sort,
        ...rawMarketsResult.meta,
      },
    };
  }

  async function getRelatedMarkets(market: PolymarketMarket) {
    const keywords = getMarketKeywords(market);
    const category = normalizeMarket(market).category;
    const query = {
      active: true,
      closed: false,
      limit: Math.min(config.upstreamMarketLimit, 200),
      order: "volumeNum",
      ascending: false,
      q: keywords.slice(0, 2).join(" ") || category,
    };

    const primary = await loadWithStaleFallback({
      cache,
      key: createCacheKey("markets:related", { id: market.id, ...query }),
      ttlMs: config.cacheTtlMs.relatedMarkets,
      loader: async () => {
        const candidates = await polymarket.getMarkets<PolymarketMarket[]>(query);
        const sourceKeywords = new Set(keywords);
        const sourceCategory = category;
        const seen = new Set<string>();

        return candidates
          .filter((candidate) => {
            if (!candidate.id || candidate.id === market.id || seen.has(candidate.id)) {
              return false;
            }

            seen.add(candidate.id);
            return isMarketVisible(candidate, visibilityRules);
          })
          .map((candidate) => {
            const normalized = normalizeMarket(candidate);
            const text = getSearchText(candidate);
            const keywordScore = [...sourceKeywords].filter((keyword) => text.includes(keyword)).length;
            const categoryScore = normalized.category === sourceCategory ? 3 : 0;
            return {
              candidate,
              score: categoryScore + keywordScore + Math.log10(Math.max(1, toNumber(candidate.volumeNum ?? candidate.volume))),
            };
          })
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score)
          .map((item) => item.candidate)
          .slice(0, config.relatedMarketLimit);
      },
      fallback: () => [],
    });

    if (primary.value.length > 0) {
      return primary;
    }

    const fallbackCandidates = await getRawMarkets({ active: true, closed: false });
    const seen = new Set<string>();
    const related = fallbackCandidates.value
      .filter((candidate) => {
        if (!candidate.id || candidate.id === market.id || seen.has(candidate.id)) {
          return false;
        }

        seen.add(candidate.id);
        return isMarketVisible(candidate, visibilityRules);
      })
      .map((candidate) => ({
        candidate,
        normalized: normalizeMarket(candidate),
      }))
      .filter(
        (item) =>
          category !== null &&
          (item.normalized.category === category || item.normalized.topics.includes(category)),
      )
      .sort((left, right) => right.normalized.volume - left.normalized.volume)
      .map((item) => item.candidate)
      .slice(0, config.relatedMarketLimit);

    return {
      value: related,
      meta: mergeSourceMeta(primary.meta, fallbackCandidates.meta),
    };
  }

  async function getMarketDetail(id: string): Promise<{ data: NormalizedMarketDetail; meta: MarketDataMeta }> {
    const market = await loadWithStaleFallback({
      cache,
      key: createCacheKey("polymarket:market-detail", { id }),
      ttlMs: config.cacheTtlMs.marketDetail,
      loader: async () => {
        try {
          return await polymarket.getMarket<PolymarketMarket>(id);
        } catch (error) {
          if (error instanceof UpstreamError && error.statusCode === 404) {
            throw new MarketDataError("MARKET_NOT_FOUND", "Market not found.", 404);
          }

          throw error;
        }
      },
    });

    const relatedMarkets = await getRelatedMarkets(market.value).catch(() => ({
      value: [],
      meta: buildCacheMeta(null, "fallback", [
        "Related markets unavailable; empty fallback returned.",
      ]),
    }));
    const meta = mergeSourceMeta(market.meta, relatedMarkets.meta);
    return {
      data: normalizeMarketDetail(market.value, relatedMarkets.value, getSnapshots?.(id) ?? []),
      meta,
    };
  }

  async function listCategories(): Promise<NormalizedCategory[]> {
    return cache.getOrSet("markets:categories", config.cacheTtlMs.categories, async () =>
      getCategories(),
    );
  }

  return {
    listMarkets,
    getMarketDetail,
    listCategories,
    visibilityRules,
  };
}

export type MarketDataService = ReturnType<typeof buildMarketDataService>;
