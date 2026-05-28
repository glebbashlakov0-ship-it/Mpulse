import type { AppConfig } from "./config.js";
import { createCacheKey, type CacheReadResult, type CacheStore } from "./cache.js";
import { getCategories, normalizeCategoryValue } from "./categories.js";
import { buildKeywordVisibilityRules, isMarketVisible } from "./moderation.js";
import {
  compactMarketForList,
  normalizeEvent,
  normalizeMarket,
  normalizeMarketDetail,
  normalizeDateSummary,
  normalizePriceSummary,
  toNumber,
} from "./normalizers.js";
import {
  buildGroupedMarketHistory,
  buildGroupedMarketStats,
  buildOwnMarketHistory,
  buildOwnMarketStats,
} from "./marketOdds.js";
import type {
  MarketSnapshot,
  NormalizedCategory,
  NormalizedEvent,
  NormalizedGroupMarket,
  NormalizedMarket,
  NormalizedMarketDetail,
  NormalizedTag,
  MarketPriceHistoryPoint,
  PolymarketEvent,
  PolymarketMarket,
  PolymarketPriceHistoryResponse,
  PolymarketTag,
} from "./types.js";
import { UpstreamError } from "./polymarketClient.js";
import { buildSnapshotFromMarket } from "./snapshots.js";
import type { MarketRepository } from "./marketRepository.js";
import {
  isLegacyDemoMarketActivity,
  type MarketActivityRepository,
  type MarketTradeActivityRecord,
} from "./marketActivityRepository.js";
import type {
  MarketPriceHistoryRepository,
  PulseMarketPriceHistoryPoint,
} from "./marketPriceHistoryRepository.js";
import { getMarketPriceHistoryScope } from "./marketPriceHistoryScope.js";

type PolymarketClient = {
  getEvents: <T>(query: Record<string, unknown>) => Promise<T>;
  getMarkets: <T>(query: Record<string, unknown>) => Promise<T>;
  getMarket: <T>(id: string) => Promise<T>;
  getTags?: <T>(query: Record<string, unknown>) => Promise<T>;
  getHomepageTags?: () => Promise<PolymarketTag[]>;
  getPriceHistory?: (
    tokenId: string,
    options?: { interval?: string; fidelity?: number },
  ) => Promise<PolymarketPriceHistoryResponse>;
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

export type MarketSnapshotCollectResult = {
  data: MarketSnapshot;
  meta: MarketDataMeta;
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
      | "EVENT_NOT_FOUND"
      | "MARKET_GROUP_NOT_FOUND"
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

const genericDiscoveryTagSlugs = new Set([
  "agreement",
  "awards",
  "business",
  "ceasefire",
  "china",
  "crypto",
  "crypto-prices",
  "culture",
  "economy",
  "elections",
  "finance",
  "games",
  "geopolitics",
  "global-elections",
  "hide-from-new",
  "main-election",
  "mention-markets",
  "multi-strikes",
  "music",
  "politics",
  "pop-culture",
  "recurring",
  "rewards-100-4pt5-100",
  "rewards-automation-200",
  "soccer",
  "sports",
  "tech",
  "weekly",
  "world",
  "world-elections",
]);

const maxDiscoveryMarketsPerEvent = 1;
const polymarketDiscoveryEventLimit = 150;
const polymarketEventPageLimit = 100;
const polymarketMarketPageLimit = 100;
const maxGroupedMarketTradeLookups = 24;
const marketListCacheScope = "markets:list:v7";
const foregroundCacheLoads = new Map<string, Promise<unknown>>();
const backgroundCacheRefreshes = new Set<string>();

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
  const topics = "topics" in market ? market.topics.join(" ") : "";
  const eventTitle = "event_title" in market ? (market.event_title ?? "") : "";
  const groupItemTitle = "groupItemTitle" in market ? (market.groupItemTitle ?? "") : "";
  const groupTitles =
    "group_markets" in market
      ? (market.group_markets ?? []).map((groupMarket) => groupMarket.title).join(" ")
      : "";

  return [
    market.category ?? "",
    topics,
    title ?? "",
    eventTitle,
    groupItemTitle,
    groupTitles,
    market.description ?? "",
  ]
    .join(" ")
    .toLowerCase();
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

  if (market.active === false && endsAtMs !== null && Number.isFinite(endsAtMs) && endsAtMs <= now) {
    return "expired";
  }

  if (market.active === false && startsAtMs !== null && Number.isFinite(startsAtMs) && startsAtMs > now) {
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
  return (
    (market.volume_24h ?? 0) * 3 +
    market.volume * 0.35 +
    market.liquidity * 0.2 +
    confidence * 100_000
  );
}

function groupedMarketWeight(market: NormalizedMarket) {
  return (market.group_markets?.length ?? 0) > 1 ? 1 : 0;
}

function sortMarkets(markets: NormalizedMarket[], sort: MarketSort, search: string) {
  return [...markets].sort((left, right) => {
    if (sort === "liquidity") {
      return right.liquidity - left.liquidity || groupedMarketWeight(right) - groupedMarketWeight(left);
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
        right.volume - left.volume ||
        groupedMarketWeight(right) - groupedMarketWeight(left)
      );
    }

    if (sort === "trending" || sort === "popular") {
      return trendingScore(right) - trendingScore(left);
    }

    return right.volume - left.volume || groupedMarketWeight(right) - groupedMarketWeight(left);
  });
}

function discoveryFamilyKey(market: NormalizedMarket) {
  const title = market.title.toLowerCase();

  if (/\b2028\b/.test(title) && /(presidential|president|nomination|election)/.test(title)) {
    return "us-2028-election-series";
  }

  if (title.includes("2026 fifa world cup")) {
    return "2026-fifa-world-cup-series";
  }

  if (/^will .+ win\b/.test(title)) {
    return title.replace(/^will .+ win\b/, "will-x-win").replace(/\d+/g, "#");
  }

  return `${market.category ?? "other"}:${title}`;
}

function diversifyDiscoveryMarkets(markets: NormalizedMarket[]) {
  const familyCounts = new Map<string, number>();
  const familyLimited: NormalizedMarket[] = [];
  const overflow: NormalizedMarket[] = [];

  for (const market of markets) {
    const key = discoveryFamilyKey(market);
    const count = familyCounts.get(key) ?? 0;
    familyCounts.set(key, count + 1);

    if (count < 2) {
      familyLimited.push(market);
    } else {
      overflow.push(market);
    }
  }

  const buckets = new Map<string, NormalizedMarket[]>();
  for (const market of familyLimited) {
    const key = market.category ?? "other";
    buckets.set(key, [...(buckets.get(key) ?? []), market]);
  }

  const categories = [...buckets.keys()].sort((left, right) => {
    const leftTop = buckets.get(left)?.[0];
    const rightTop = buckets.get(right)?.[0];
    return trendingScore(rightTop as NormalizedMarket) - trendingScore(leftTop as NormalizedMarket);
  });
  const balanced: NormalizedMarket[] = [];

  while (balanced.length < familyLimited.length) {
    let added = false;
    for (const category of categories) {
      const next = buckets.get(category)?.shift();
      if (next) {
        balanced.push(next);
        added = true;
      }
    }

    if (!added) {
      break;
    }
  }

  const questionCards = balanced.filter((market) => /^will\b/i.test(market.title));
  const nonQuestionCards = balanced.filter((market) => !/^will\b/i.test(market.title));
  const questionLimit = Math.ceil(balanced.length * 0.35);

  return [
    ...nonQuestionCards,
    ...questionCards.slice(0, questionLimit),
    ...questionCards.slice(questionLimit),
    ...overflow,
  ];
}

function extractSearchMarkets(results: { events?: PolymarketEvent[]; markets?: PolymarketMarket[] }) {
  return [
    ...(results.markets ?? []),
    ...extractEventMarkets(results.events ?? [], { titleMode: "market" }),
  ];
}

function dedupeMarkets(markets: PolymarketMarket[]) {
  const byId = new Map<string, PolymarketMarket>();
  for (const market of markets) {
    if (market.id && !byId.has(market.id)) {
      byId.set(market.id, market);
    }
  }

  return [...byId.values()];
}

function getEventKey(event: PolymarketEvent | undefined) {
  if (!event) {
    return null;
  }

  if (event.id) {
    return `id:${event.id}`;
  }

  return event.slug ? `slug:${event.slug}` : null;
}

function getMarketEventKeys(market: PolymarketMarket) {
  return (market.events ?? [])
    .flatMap((event) => [event.id ? `id:${event.id}` : null, event.slug ? `slug:${event.slug}` : null])
    .filter((key): key is string => Boolean(key));
}

function suppressEventChildrenWhenGrouped(
  groupedEventMarkets: PolymarketMarket[],
  fallbackMarkets: PolymarketMarket[],
) {
  if (groupedEventMarkets.length === 0 || fallbackMarkets.length === 0) {
    return fallbackMarkets;
  }

  const representedEventIds = new Set(
    groupedEventMarkets
      .filter((market) => (market.groupMarkets?.length ?? 0) > 1)
      .flatMap(getMarketEventKeys),
  );

  if (representedEventIds.size === 0) {
    return fallbackMarkets;
  }

  return fallbackMarkets.filter(
    (market) => !getMarketEventKeys(market).some((eventId) => representedEventIds.has(eventId)),
  );
}

function eventTags(event: PolymarketEvent) {
  return (event.tags ?? [])
    .flatMap((tag) => [tag.slug, tag.label])
    .filter((tag): tag is string => Boolean(tag))
    .map((tag) => tag.toLowerCase());
}

function slugifyTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeDiscoveryTag(tag: PolymarketTag | NonNullable<PolymarketEvent["tags"]>[number]) {
  const label = tag.label?.trim();
  const slug = tag.slug?.trim() || (label ? slugifyTag(label) : "");

  if (!label || !slug) {
    return null;
  }

  return {
    id: String(tag.id ?? slug),
    slug: slugifyTag(slug),
    label,
  } satisfies NormalizedTag;
}

function isUsefulDiscoveryTag(tag: NormalizedTag) {
  if (tag.label.length < 2 || tag.label.length > 32) {
    return false;
  }

  if (genericDiscoveryTagSlugs.has(tag.slug)) {
    return false;
  }

  if (/^(hide|rewards?|reward|macro-election|test)\b/i.test(tag.label)) {
    return false;
  }

  return true;
}

function addDiscoveryTag(
  tags: Map<string, NormalizedTag & { score: number }>,
  tag: PolymarketTag | NonNullable<PolymarketEvent["tags"]>[number],
  score: number,
) {
  const normalized = normalizeDiscoveryTag(tag);

  if (!normalized || !isUsefulDiscoveryTag(normalized)) {
    return;
  }

  const current = tags.get(normalized.slug);
  tags.set(normalized.slug, {
    ...normalized,
    score: (current?.score ?? 0) + score,
  });
}

function normalizeHomepageTags(tags: PolymarketTag[]) {
  const seen = new Set<string>();
  const normalizedTags: NormalizedTag[] = [];

  for (const tag of tags) {
    const normalized = normalizeDiscoveryTag(tag);
    if (!normalized || normalized.slug === "all" || seen.has(normalized.slug)) {
      continue;
    }

    seen.add(normalized.slug);
    normalizedTags.push(normalized);
  }

  return normalizedTags.slice(0, 48);
}

function compactEventContext(event: PolymarketEvent): PolymarketEvent {
  return {
    id: event.id,
    ticker: event.ticker,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    image: event.image,
    icon: event.icon,
    startDate: event.startDate,
    endDate: event.endDate,
    active: event.active,
    closed: event.closed,
    archived: event.archived,
    restricted: event.restricted,
    volume: event.volume,
    volume24hr: event.volume24hr,
    liquidity: event.liquidity,
    openInterest: event.openInterest,
    commentCount: event.commentCount,
    tags: event.tags,
    markets: [],
  };
}

function getEventDisplayTitle(
  event: PolymarketEvent,
  market: PolymarketMarket,
  options: { titleMode?: "event" | "market" } = {},
) {
  const eventTitle = event.title?.trim();
  const marketTitle = market.question?.trim();
  const marketCount = event.markets?.length ?? 0;

  if (options.titleMode === "market") {
    return marketTitle || eventTitle || "";
  }

  if (eventTitle && marketCount > 1) {
    return eventTitle;
  }

  return marketTitle || eventTitle || "";
}

function marketFromEvent(
  event: PolymarketEvent,
  market: PolymarketMarket,
  options: { titleMode?: "event" | "market" } = {},
): PolymarketMarket {
  const displayTitle = getEventDisplayTitle(event, market, options);
  const eventMarkets = sortEventMarkets(event.markets ?? []);
  const originalQuestion = market.question?.trim();
  const originalDescription =
    market.description ?? event.description ?? (originalQuestion && originalQuestion !== displayTitle
      ? originalQuestion
      : undefined);
  const groupMarkets =
    eventMarkets.length > 1
      ? eventMarkets.map((childMarket) => ({
          ...childMarket,
          category: childMarket.category ?? event.category,
          description: childMarket.description ?? event.description,
          image: childMarket.image ?? childMarket.icon ?? event.image ?? event.icon,
          icon: childMarket.icon ?? childMarket.image ?? event.icon ?? event.image,
          startDate: childMarket.startDate ?? event.startDate,
          endDate: childMarket.endDate ?? event.endDate,
          active: childMarket.active ?? event.active,
          closed: childMarket.closed ?? event.closed,
          archived: childMarket.archived ?? event.archived,
          restricted: childMarket.restricted ?? event.restricted,
          volume24hr: childMarket.volume24hr ?? event.volume24hr,
          commentCount: childMarket.commentCount ?? event.commentCount,
          events: [compactEventContext(event)],
        }))
      : undefined;

  return {
    ...market,
    question: displayTitle,
    category: market.category ?? event.category,
    description: originalDescription,
    image: event.image ?? event.icon ?? market.image,
    icon: event.icon ?? event.image ?? market.icon,
    startDate: event.startDate ?? market.startDate,
    endDate: event.endDate ?? market.endDate,
    active: event.active ?? market.active,
    closed: event.closed ?? market.closed,
    archived: event.archived ?? market.archived,
    restricted: event.restricted ?? market.restricted,
    volume:
      toNumber(event.volume) > toNumber(market.volumeNum ?? market.volume)
        ? event.volume
        : market.volume,
    volumeNum: Math.max(toNumber(market.volumeNum ?? market.volume), toNumber(event.volume)),
    volume24hr: market.volume24hr ?? event.volume24hr,
    commentCount: market.commentCount ?? event.commentCount,
    liquidity:
      toNumber(event.liquidity) > toNumber(market.liquidityNum ?? market.liquidity)
        ? event.liquidity
        : market.liquidity,
    liquidityNum: Math.max(
      toNumber(market.liquidityNum ?? market.liquidity),
      toNumber(event.liquidity),
    ),
    events: [compactEventContext(event)],
    groupMarkets,
  };
}

function inferEmbeddedGroupItemTitle(event: PolymarketEvent, market: PolymarketMarket) {
  if (market.groupItemTitle?.trim()) {
    return market.groupItemTitle;
  }

  const question = market.question?.trim().replace(/\?$/, "") ?? "";
  const eventTitle = event.title?.trim().replace(/\?$/, "") ?? "";

  if (!question || question === eventTitle) {
    return market.groupItemTitle;
  }

  const winner = /^will\s+(.+?)\s+win\b/i.exec(question);
  if (winner?.[1]) {
    return winner[1].trim();
  }

  const dated = /\bby\s+(.+)$/i.exec(question);
  if (dated?.[1] && /^when\s+will\b/i.test(eventTitle)) {
    return `by ${dated[1].trim()}`;
  }

  return market.groupItemTitle;
}

function collapseEmbeddedEventGroups(markets: PolymarketMarket[]) {
  const buckets = new Map<
    string,
    {
      event: PolymarketEvent;
      markets: PolymarketMarket[];
    }
  >();
  const passthrough: PolymarketMarket[] = [];

  for (const market of markets) {
    if ((market.groupMarkets?.length ?? 0) > 1) {
      passthrough.push(market);
      continue;
    }

    const event = market.events?.find((candidate) => getEventKey(candidate));
    const key = getEventKey(event);

    if (!event || !key) {
      passthrough.push(market);
      continue;
    }

    const bucket = buckets.get(key) ?? {
      event,
      markets: [],
    };
    bucket.markets.push(market);
    buckets.set(key, bucket);
  }

  const grouped: PolymarketMarket[] = [];
  const singles: PolymarketMarket[] = [];

  for (const { event, markets: eventMarkets } of buckets.values()) {
    const uniqueMarkets = dedupeMarkets(eventMarkets);

    if (uniqueMarkets.length <= 1) {
      singles.push(uniqueMarkets[0]);
      continue;
    }

    const groupedChildren = sortEventMarkets(uniqueMarkets).map((market) => ({
      ...market,
      groupItemTitle: inferEmbeddedGroupItemTitle(event, market),
      category: market.category ?? event.category,
      image: market.image ?? market.icon ?? event.image ?? event.icon,
      icon: market.icon ?? market.image ?? event.icon ?? event.image,
      events: [compactEventContext(event)],
    }));
    const selectedMarket = groupedChildren[0];

    grouped.push(
      marketFromEvent(
        {
          ...event,
          markets: groupedChildren,
        },
        selectedMarket,
      ),
    );
  }

  return dedupeMarkets([...passthrough, ...grouped, ...singles]);
}

function sortEventMarkets(markets: PolymarketMarket[]) {
  return [...markets].sort(
    (left, right) =>
      toNumber(right.volume24hr) - toNumber(left.volume24hr) ||
      toNumber(right.volumeNum ?? right.volume) - toNumber(left.volumeNum ?? left.volume),
  );
}

function extractEventMarkets(
  events: PolymarketEvent[],
  options: { titleMode?: "event" | "market" } = {},
) {
  return events.flatMap((event) =>
    sortEventMarkets(event.markets ?? []).map((market) => marketFromEvent(event, market, options)),
  );
}

function extractDiverseEventMarkets(events: PolymarketEvent[]) {
  const markets: PolymarketMarket[] = [];
  const seen = new Set<string>();
  const sortedEvents = [...events].sort(
    (left, right) =>
      toNumber(right.volume24hr) - toNumber(left.volume24hr) ||
      toNumber(right.volume) - toNumber(left.volume),
  );

  for (const event of sortedEvents) {
    let addedForEvent = 0;
    for (const market of sortEventMarkets(event.markets ?? [])) {
      if (!market.id || seen.has(market.id)) {
        continue;
      }

      seen.add(market.id);
      markets.push(marketFromEvent(event, market));
      addedForEvent += 1;

      if (addedForEvent >= maxDiscoveryMarketsPerEvent) {
        break;
      }
    }
  }

  return markets;
}

function dedupeEvents(events: PolymarketEvent[]) {
  const byId = new Map<string, PolymarketEvent>();
  for (const event of events) {
    if (event.id && !byId.has(event.id)) {
      byId.set(event.id, event);
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

const strictTopicCategorySlugs = new Set([
  "crypto",
  "sports",
  "finance",
  "tech",
  "culture",
  "economy",
  "weather",
  "geopolitics",
  "other",
]);

function matchesTopicFilter(market: NormalizedMarket, topic: string | null) {
  if (!topic) {
    return true;
  }

  if (topic === "esports") {
    return market.category === "esports" || market.topics.includes("esports");
  }

  if (strictTopicCategorySlugs.has(topic)) {
    return market.category === topic;
  }

  if (topic === "elections") {
    return market.category === "elections" || market.category === "politics";
  }

  return market.category === topic || market.topics.includes(topic);
}

function matchesCategoryFilter(market: NormalizedMarket, category: string | null) {
  if (!category) {
    return true;
  }

  return market.category === category || market.topics.includes(category);
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
      ? slugifyTag(params.topic)
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

type ParsedMarketFilter = ReturnType<typeof toMarketFilter>;

function getListCacheKey(filter: ParsedMarketFilter) {
  return createCacheKey(marketListCacheScope, {
    active: filter.active,
    closed: filter.closed,
    category: filter.category,
    topic: filter.topic,
    search: filter.search,
    sort: filter.sort,
    limit: filter.limit,
    offset: filter.offset,
    status: filter.status,
    minVolume: filter.minVolume,
    maxVolume: filter.maxVolume,
    closingBefore: filter.closingBefore,
    closingAfter: filter.closingAfter,
  });
}

function getListCacheTtlMs(filter: ParsedMarketFilter, config: AppConfig) {
  if (filter.search) {
    return config.cacheTtlMs.searchResults;
  }

  return filter.closed ? config.cacheTtlMs.closedMarkets : config.cacheTtlMs.activeMarkets;
}

function getListUpstreamScanLimit(filter: ParsedMarketFilter, config: AppConfig) {
  const requestedThrough = filter.offset + filter.limit;
  const hasFocusedFilter = Boolean(filter.category || filter.topic);
  const multiplier = filter.search ? 2 : hasFocusedFilter ? 2 : 4;
  const minimum = filter.search ? 80 : hasFocusedFilter ? 100 : 120;

  return Math.min(
    config.upstreamMarketLimit,
    Math.max(minimum, requestedThrough * multiplier),
  );
}

function listMetaToMarketDataMeta(meta: MarketListResult["meta"]): MarketDataMeta {
  return {
    lastSyncedAt: meta.lastSyncedAt,
    isStale: meta.isStale,
    sourceStatus: meta.sourceStatus,
    warnings: meta.warnings,
  };
}

function withListCacheMeta(
  result: MarketListResult,
  cacheMeta: MarketDataMeta,
): MarketListResult {
  const mergedMeta = mergeSourceMeta(listMetaToMarketDataMeta(result.meta), cacheMeta);

  return {
    data: result.data,
    meta: {
      ...result.meta,
      ...mergedMeta,
    },
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

function normalizeClobTokenHistory(response: PolymarketPriceHistoryResponse) {
  return (response.history ?? [])
    .map((point) => {
      const timestamp = Number(point.t);
      const price = Number(point.p);

      if (!Number.isFinite(timestamp) || !Number.isFinite(price)) {
        return null;
      }

      return {
        timestamp,
        price: Math.min(1, Math.max(0, price)),
      };
    })
    .filter((point): point is { timestamp: number; price: number } => point !== null)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function toIsoFromClobTimestamp(timestamp: number) {
  const timestampMs = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(timestampMs);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mergeBinaryClobHistory({
  yesPoints,
  noPoints,
  volume,
  liquidity,
}: {
  yesPoints: Array<{ timestamp: number; price: number }>;
  noPoints: Array<{ timestamp: number; price: number }>;
  volume: number;
  liquidity: number;
}): MarketPriceHistoryPoint[] {
  const byTimestamp = new Map<number, { yes?: number; no?: number }>();

  for (const point of yesPoints) {
    byTimestamp.set(point.timestamp, {
      ...byTimestamp.get(point.timestamp),
      yes: point.price,
    });
  }

  for (const point of noPoints) {
    byTimestamp.set(point.timestamp, {
      ...byTimestamp.get(point.timestamp),
      no: point.price,
    });
  }

  let lastYes: number | null = null;
  let lastNo: number | null = null;

  const merged: MarketPriceHistoryPoint[] = [];

  for (const [timestamp, prices] of [...byTimestamp.entries()].sort(([left], [right]) => left - right)) {
    lastYes = prices.yes ?? lastYes;
    lastNo = prices.no ?? lastNo;
    const isoTimestamp = toIsoFromClobTimestamp(timestamp);

    if (!isoTimestamp || (lastYes === null && lastNo === null)) {
      continue;
    }

    merged.push({
      timestamp: isoTimestamp,
      yes: lastYes,
      no: lastNo,
      volume,
      liquidity,
      synthetic: false,
    });
  }

  return merged;
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

  if (cached) {
    refreshCacheInBackground({ cache, key, ttlMs, loader });

    return {
      value: cached.value,
      meta: buildCacheMeta(cached, "stale", [
        "Upstream refresh is running; stale cached market data returned immediately.",
      ]),
    };
  }

  const pending = foregroundCacheLoads.get(key);
  const loadPromise = pending ?? loader();

  if (!pending) {
    foregroundCacheLoads.set(key, loadPromise);
  }

  try {
    const value = (await loadPromise) as T;
    cache.set(key, value, ttlMs);
    const refreshed = cache.getEntry<T>(key);

    return {
      value,
      meta: buildCacheMeta(refreshed, "fresh"),
    };
  } catch (error) {
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
  } finally {
    if (!pending && foregroundCacheLoads.get(key) === loadPromise) {
      foregroundCacheLoads.delete(key);
    }
  }
}

function refreshCacheInBackground<T>({
  cache,
  key,
  ttlMs,
  loader,
}: {
  cache: CacheStore;
  key: string;
  ttlMs: number;
  loader: () => Promise<T>;
}) {
  if (backgroundCacheRefreshes.has(key)) {
    return;
  }

  backgroundCacheRefreshes.add(key);
  void loader()
    .then((value) => {
      cache.set(key, value, ttlMs);
    })
    .catch(() => {
      // Keep serving the stale entry until a later refresh succeeds.
    })
    .finally(() => {
      backgroundCacheRefreshes.delete(key);
    });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new UpstreamError(message, 0));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
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
  marketRepository,
  marketActivityRepository,
  priceHistoryRepository,
  getSnapshots,
}: {
  config: AppConfig;
  cache: CacheStore;
  polymarket: PolymarketClient;
  marketRepository?: MarketRepository;
  marketActivityRepository?: MarketActivityRepository;
  priceHistoryRepository?: MarketPriceHistoryRepository;
  getSnapshots?: (marketId: string, limit?: number) => MarketSnapshot[] | Promise<MarketSnapshot[]>;
}) {
  const visibilityRules = buildKeywordVisibilityRules(config.blockedMarketTerms);
  const topicSearchTimeoutMs = Math.min(
    1800,
    Math.max(750, Math.floor(config.polymarketRequestTimeoutMs / 3)),
  );
  const topicSearchTerms: Record<string, string[]> = {
    ai: ["ai", "openai", "gpt"],
    culture: ["movies", "music", "box office", "eurovision", "gta vi"],
    esports: ["esports", "dota", "valorant", "cs2"],
  };

  function eventQueries(params: {
    active?: boolean;
    closed?: boolean;
    category?: string | null;
    topic?: string | null;
    search?: string | null;
    maxItems: number;
  }) {
    const base = {
      active: params.active,
      closed: params.closed,
      order: "volume24hr",
      ascending: false,
    };
    const focusedTags = [
      params.topic,
      params.category,
      params.search ? slugifyTag(params.search) : null,
    ].filter((tag): tag is string => Boolean(tag));
    const broadDiscovery = !params.search && !params.category && !params.topic;
    const maxItems = Math.max(1, Math.min(params.maxItems, config.upstreamMarketLimit));

    const queries: Array<{ query: Record<string, unknown>; paginate: boolean; maxItems?: number }> =
      params.search
        ? []
        : broadDiscovery
          ? [
              {
                query: base,
                paginate: true,
                maxItems: Math.min(maxItems, polymarketDiscoveryEventLimit),
              },
              { query: { ...base, featured: true }, paginate: false },
              { query: { ...base, trending: true }, paginate: false },
            ]
          : [];

    for (const focusedTag of new Set(focusedTags)) {
      queries.push({
        query: {
          ...base,
          tag_slug: focusedTag,
        },
        paginate: true,
        maxItems,
      });
    }

    return queries;
  }

  function eventQueryPages(query: Record<string, unknown>, maxItems = config.upstreamMarketLimit) {
    const pageLimit = Math.min(maxItems, polymarketEventPageLimit);
    const pageCount = Math.max(1, Math.ceil(maxItems / pageLimit));

    return Array.from({ length: pageCount }).map((_, index) => ({
      ...query,
      limit: Math.min(pageLimit, maxItems - index * pageLimit),
      offset: index * pageLimit,
    }));
  }

  function marketQueryPages(query: Record<string, unknown>, maxItems = config.upstreamMarketLimit) {
    const pageLimit = Math.min(maxItems, polymarketMarketPageLimit);
    const pageCount = Math.max(1, Math.ceil(maxItems / pageLimit));

    return Array.from({ length: pageCount }).map((_, index) => ({
      ...query,
      limit: Math.min(pageLimit, maxItems - index * pageLimit),
      offset: index * pageLimit,
    }));
  }

  async function getEventBackedMarkets(params: {
    active?: boolean;
    closed?: boolean;
    category?: string | null;
    topic?: string | null;
    search?: string | null;
    maxItems: number;
  }) {
    const ttl = params.closed ? config.cacheTtlMs.closedMarkets : config.cacheTtlMs.activeMarkets;
    const queries = eventQueries(params).flatMap(({ query, paginate, maxItems }) =>
      paginate
        ? eventQueryPages(query, maxItems)
        : [
            {
              ...query,
              limit: Math.min(params.maxItems, config.upstreamMarketLimit, polymarketEventPageLimit),
              offset: 0,
            },
          ],
    );
    const results = await Promise.all(
      queries.map(async (query) => {
        try {
          return await loadWithStaleFallback({
            cache,
            key: createCacheKey("polymarket:events", query),
            ttlMs: ttl,
            loader: () => polymarket.getEvents<PolymarketEvent[]>(query),
            fallback: () => [],
          });
        } catch (error) {
          if (error instanceof MarketDataError && error.code === "UPSTREAM_UNAVAILABLE") {
            return {
              value: [],
              meta: buildCacheMeta(null, "fallback", [
                "Event discovery upstream unavailable; market fallback used.",
              ]),
            };
          }

          throw error;
        }
      }),
    );
    const events = dedupeEvents(results.flatMap((result) => result.value));

    return {
      value: extractDiverseEventMarkets(events),
      meta: mergeSourceMeta(...results.map((result) => result.meta)),
    };
  }

  async function getTopicSearchMarkets(topic: string | null, maxItems: number) {
    const terms = topic ? topicSearchTerms[topic] : undefined;
    if (!terms?.length) {
      return {
        value: [] as PolymarketMarket[],
        meta: buildCacheMeta(null, "cache"),
      };
    }

    const results = await Promise.all(
      terms.map((term) => {
        const searchQuery = {
          q: term,
          limit: Math.min(maxItems, config.upstreamMarketLimit),
        };

        return loadWithStaleFallback({
          cache,
          key: createCacheKey("polymarket:topic-search", searchQuery),
          ttlMs: config.cacheTtlMs.searchResults,
          loader: async () =>
            extractSearchMarkets(
              await withTimeout(
                polymarket.search<{ events?: PolymarketEvent[]; markets?: PolymarketMarket[] }>(
                  searchQuery,
                ),
                topicSearchTimeoutMs,
                "Polymarket topic search timed out",
              ),
            ),
          fallback: () => [],
        });
      }),
    );

    return {
      value: collapseEmbeddedEventGroups(dedupeMarkets(results.flatMap((result) => result.value))),
      meta: mergeSourceMeta(...results.map((result) => result.meta)),
    };
  }

  async function getRawMarkets(params: {
    active?: boolean;
    closed?: boolean;
    category?: string | null;
    search?: string;
    topic?: string | null;
    discovery?: boolean;
    maxItems?: number;
  }) {
    const focusedTag = params.topic ?? params.category ?? null;
    const maxItems = Math.max(
      1,
      Math.min(params.maxItems ?? config.upstreamMarketLimit, config.upstreamMarketLimit),
    );
    const baseQuery = {
      active: params.active,
      closed: params.closed,
      order: "volumeNum",
      ascending: false,
    };
    const marketQueries: Array<Record<string, unknown>> = [];

    if (params.search) {
      marketQueries.push({
        ...baseQuery,
        q: params.search,
      });
    }

    if (!params.search && !focusedTag && !params.category) {
      marketQueries.push(baseQuery);
    }

    const ttl = params.closed ? config.cacheTtlMs.closedMarkets : config.cacheTtlMs.activeMarkets;
    const tolerateEmptyMarketQueryFallback = Boolean(params.search || focusedTag || params.category);
    const baseMarketsPromise =
      marketQueries.length > 0
        ? Promise.all(
            marketQueries.flatMap((query) => marketQueryPages(query, maxItems)).map((query) =>
              loadWithStaleFallback({
                cache,
                key: createCacheKey("polymarket:markets", query),
                ttlMs: ttl,
                loader: () => polymarket.getMarkets<PolymarketMarket[]>(query),
                fallback: tolerateEmptyMarketQueryFallback ? () => [] : undefined,
              }),
            ),
          ).then((results) => ({
            value: collapseEmbeddedEventGroups(dedupeMarkets(results.flatMap((result) => result.value))),
            meta: mergeSourceMeta(...results.map((result) => result.meta)),
          }))
        : Promise.resolve({
            value: [] as PolymarketMarket[],
            meta: buildCacheMeta(null, "cache"),
          });
    const eventMarketsPromise = getEventBackedMarkets({
      active: params.active,
      closed: params.closed,
      category: params.category ?? null,
      topic: params.topic ?? null,
      search: params.search ?? null,
      maxItems,
    });
    const topicMarketsPromise = getTopicSearchMarkets(params.topic ?? params.category ?? null, maxItems);
    const [baseMarkets, eventMarkets, topicMarkets] = await Promise.all([
      baseMarketsPromise,
      eventMarketsPromise,
      topicMarketsPromise,
    ]);

    if (!params.search && params.discovery && eventMarkets.value.length > 0) {
      const topicFallbackMarkets = suppressEventChildrenWhenGrouped(
        eventMarkets.value,
        [...topicMarkets.value, ...baseMarkets.value],
      );

      return {
        value: dedupeMarkets([...eventMarkets.value, ...topicFallbackMarkets]),
        meta: mergeSourceMeta(eventMarkets.meta, baseMarkets.meta, topicMarkets.meta),
      };
    }

    if (!params.search) {
      const fallbackMarkets = suppressEventChildrenWhenGrouped(eventMarkets.value, [
        ...topicMarkets.value,
        ...baseMarkets.value,
      ]);

      return {
        value: dedupeMarkets([...eventMarkets.value, ...fallbackMarkets]),
        meta: mergeSourceMeta(eventMarkets.meta, baseMarkets.meta, topicMarkets.meta),
      };
    }

    const searchQuery = { q: params.search, limit: maxItems };
    const searchMarkets = await loadWithStaleFallback({
      cache,
      key: createCacheKey("polymarket:search", searchQuery),
      ttlMs: config.cacheTtlMs.searchResults,
      loader: async () => extractSearchMarkets(await polymarket.search(searchQuery)),
      fallback: () => [],
    });
    const searchFallbackMarkets = suppressEventChildrenWhenGrouped(
      eventMarkets.value,
      collapseEmbeddedEventGroups([
        ...searchMarkets.value,
        ...topicMarkets.value,
        ...baseMarkets.value,
      ]),
    );

    return {
      value: dedupeMarkets([...eventMarkets.value, ...searchFallbackMarkets]),
      meta: mergeSourceMeta(baseMarkets.meta, eventMarkets.meta, searchMarkets.meta, topicMarkets.meta),
    };
  }

  async function buildMarketList(filter: ParsedMarketFilter): Promise<MarketListResult> {
    const maxItems = getListUpstreamScanLimit(filter, config);
    const rawMarketsResult = await getRawMarkets({
      active: filter.active ?? (filter.status === "live" || filter.status === "upcoming" ? true : undefined),
      closed: filter.closed ?? (filter.status === "live" || filter.status === "upcoming" ? false : filter.status === "closed" ? true : undefined),
      category: filter.category,
      search: filter.search,
      topic: filter.topic,
      discovery: !filter.search && (filter.sort === "trending" || filter.sort === "popular"),
      maxItems,
    });
    const normalized = rawMarketsResult.value
      .filter((market) => isMarketVisible(market, visibilityRules))
      .map(normalizeMarket)
      .filter((market) => marketMatchesListFilter(market, filter));
    const sorted = sortMarkets(normalized, filter.sort, filter.search);
    const discoverySorted = sorted;
    const compactData = discoverySorted
      .slice(filter.offset, filter.offset + filter.limit)
      .map(compactMarketForList);
    const data = await enrichMarketsWithOwnActivity(compactData);
    const nextOffset = filter.offset + filter.limit;

    return {
      data,
      meta: {
        limit: filter.limit,
        offset: filter.offset,
        next_cursor: nextOffset < discoverySorted.length ? encodeCursor(nextOffset) : null,
        total: discoverySorted.length,
        sort: filter.sort,
        ...rawMarketsResult.meta,
      },
    };
  }

  async function buildStoredMarketList(filter: ParsedMarketFilter): Promise<MarketListResult | null> {
    if (!marketRepository) {
      return null;
    }

    const storedMarkets = await marketRepository.listMarkets(
      Math.max(filter.offset + filter.limit, config.defaultMarketLimit),
    );
    const filtered = storedMarkets.filter((market) => marketMatchesListFilter(market, filter));
    const sorted = sortMarkets(filtered, filter.sort, filter.search);
    const compactData = sorted
      .slice(filter.offset, filter.offset + filter.limit)
      .map(compactMarketForList);
    const data = await enrichMarketsWithOwnActivity(compactData);
    const nextOffset = filter.offset + filter.limit;

    if (data.length === 0) {
      return null;
    }

    return {
      data,
      meta: {
        limit: filter.limit,
        offset: filter.offset,
        next_cursor: nextOffset < sorted.length ? encodeCursor(nextOffset) : null,
        total: sorted.length,
        sort: filter.sort,
        lastSyncedAt: null,
        isStale: true,
        sourceStatus: "fallback",
        warnings: ["Polymarket is unavailable; returning stored Pulse Market data."],
      },
    };
  }

  async function listMarkets(params: MarketListParams): Promise<MarketListResult> {
    const filter = toMarketFilter(params, config);
    let cached: { value: MarketListResult; meta: MarketDataMeta };

    try {
      cached = await loadWithStaleFallback({
        cache,
        key: getListCacheKey(filter),
        ttlMs: getListCacheTtlMs(filter, config),
        loader: () => buildMarketList(filter),
      });
    } catch (error) {
      if (error instanceof MarketDataError && error.code === "UPSTREAM_UNAVAILABLE") {
        const stored = await buildStoredMarketList(filter);
        if (stored) {
          return stored;
        }
      }

      throw error;
    }

    return withListCacheMeta(cached.value, cached.meta);
  }

  function marketMatchesListFilter(market: NormalizedMarket, filter: ParsedMarketFilter) {
    if (filter.active !== undefined && market.active !== filter.active) {
      return false;
    }

    if (filter.closed !== undefined && market.closed !== filter.closed) {
      return false;
    }

    if (!matchesCategoryFilter(market, filter.category)) {
      return false;
    }

    if (!matchesTopicFilter(market, filter.topic)) {
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
  }

  async function enrichMarketsWithOwnActivity(markets: NormalizedMarket[]) {
    if (!marketActivityRepository) {
      return markets;
    }

    return Promise.all(markets.map((market) => enrichMarketWithOwnActivity(market)));
  }

  async function enrichMarketWithOwnActivity<T extends NormalizedMarket>(market: T): Promise<T> {
    if (!marketActivityRepository) {
      return market;
    }

    const groupMarkets = market.group_markets ?? [];
    if (groupMarkets.length > 0) {
      const tradesByMarketId =
        groupMarkets.length <= maxGroupedMarketTradeLookups
          ? await listOwnTradesForMarkets(groupMarkets)
          : new Map<string, MarketTradeActivityRecord[]>();
      const groupedStats = buildGroupedMarketStats(groupMarkets, tradesByMarketId);

      return {
        ...market,
        group_markets: groupedStats.markets,
        volume: groupedStats.volume,
        volume_24h: groupedStats.volume24h,
        liquidity: groupedStats.liquidity,
      };
    }

    const trades = await listOwnTrades(market.id);
    const stats = buildOwnMarketStats(market, trades);

    return applyOwnStatsToMarket(market, stats);
  }

  async function enrichGroupMarketWithOwnActivity(
    market: NormalizedGroupMarket,
  ): Promise<NormalizedGroupMarket> {
    const trades = await listOwnTrades(market.id);
    const stats = buildOwnMarketStats(market, trades);
    const enriched = applyOwnStatsToMarket(market, stats);

    return {
      ...enriched,
      outcomes: market.outcomes.length > 0 ? enriched.outcomes : market.outcomes,
      yes_price: stats.yes,
      no_price: stats.no,
    };
  }

  async function enrichMarketDetailWithOwnActivity(
    detail: NormalizedMarketDetail,
    marketTrades?: MarketTradeActivityRecord[],
  ): Promise<NormalizedMarketDetail> {
    const groupMarkets = detail.group_markets ?? [];
    const tradesByMarketId =
      marketActivityRepository &&
      groupMarkets.length > 0 &&
      groupMarkets.length <= maxGroupedMarketTradeLookups
        ? await listOwnTradesForMarkets(groupMarkets)
        : new Map<string, MarketTradeActivityRecord[]>();
    const hasGroupedTrades = [...tradesByMarketId.values()].some((trades) => trades.length > 0);
    const groupedStats =
      groupMarkets.length > 0 && hasGroupedTrades
        ? buildGroupedMarketStats(groupMarkets, tradesByMarketId)
        : null;
    const enrichedGroups = groupedStats?.markets ?? groupMarkets;
    const trades = marketTrades ?? (marketActivityRepository ? await listOwnTrades(detail.id) : []);
    const stats = trades.length > 0 ? buildOwnMarketStats(detail, trades) : null;
    const market = stats ? applyOwnStatsToMarket(detail, stats) : detail;
    const volume = groupedStats ? groupedStats.volume : stats ? stats.volume : detail.volume;
    const volume24h = groupedStats
      ? groupedStats.volume24h
      : stats
        ? stats.volume24h
        : detail.volume_24h;
    const liquidity = groupedStats ? groupedStats.liquidity : stats ? stats.liquidity : detail.liquidity;
    const groupedHistory = groupedStats
      ? buildGroupedMarketHistory(enrichedGroups, tradesByMarketId)
      : null;

    return {
      ...market,
      group_markets: enrichedGroups,
      volume,
      volume_24h: volume24h,
      liquidity,
      prices: normalizePriceSummary(market),
      volume_detail: {
        volume,
        liquidity,
      },
      history: groupedHistory
        ? {
            ...detail.history,
            price_history: groupedHistory,
            is_synthetic: false,
          }
        : market.history,
    };
  }

  async function listOwnTrades(marketId: string) {
    if (!marketActivityRepository) {
      return [];
    }

    return marketActivityRepository
      .listTrades(marketId, 500)
      .then((trades) => trades.filter((trade) => !isLegacyDemoMarketActivity(trade)))
      .catch(() => []);
  }

  async function listOwnTradesForMarkets(markets: Array<Pick<NormalizedMarket, "id">>) {
    const entries = await Promise.all(
      markets.map(async (market) => [market.id, await listOwnTrades(market.id)] as const),
    );

    return new Map(entries);
  }

  function applyOwnStatsToMarket<T extends NormalizedMarket>(
    market: T,
    stats: ReturnType<typeof buildOwnMarketStats>,
  ): T {
    return {
      ...market,
      outcomes: stats.outcomes,
      volume: stats.volume,
      volume_24h: stats.volume24h,
      liquidity: stats.liquidity,
      trading: {
        ...market.trading,
        best_bid: null,
        best_ask: null,
        last_trade_price: null,
      },
    };
  }

  function sumMarketStats(markets: NormalizedMarket[]) {
    return markets.reduce(
      (totals, market) => ({
        volume: totals.volume + market.volume,
        volume24h: totals.volume24h + (market.volume_24h ?? 0),
        liquidity: totals.liquidity + market.liquidity,
      }),
      { volume: 0, volume24h: 0, liquidity: 0 },
    );
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

    if (primary.meta.sourceStatus === "fallback" || primary.meta.sourceStatus === "unavailable") {
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

  async function getEventBySlugOrId(identifier: string): Promise<{ data: NormalizedEvent; meta: MarketDataMeta }> {
    const isNumericId = /^\d+$/.test(identifier);
    const query = isNumericId ? { id: identifier } : { slug: identifier };
    const eventResult = await loadWithStaleFallback({
      cache,
      key: createCacheKey("polymarket:event-detail", query),
      ttlMs: config.cacheTtlMs.marketDetail,
      loader: () => polymarket.getEvents<PolymarketEvent[]>(query),
    });
    const event = eventResult.value.find((candidate) =>
      isNumericId ? candidate.id === identifier : candidate.slug === identifier,
    ) ?? eventResult.value[0];

    if (!event) {
      throw new MarketDataError("EVENT_NOT_FOUND", "Event not found.", 404);
    }

    return {
      data: normalizeEvent(event),
      meta: eventResult.meta,
    };
  }

  async function findParentEventForMarket(market: PolymarketMarket) {
    const marketEvents = market.events ?? [];
    const embeddedEvent = marketEvents.find((event) =>
      (event.markets ?? []).some((childMarket) => childMarket.id === market.id),
    );

    if (embeddedEvent) {
      return embeddedEvent;
    }

    if (!market.groupItemTitle) {
      return null;
    }

    const searchText = market.question?.trim() || market.groupItemTitle.trim();
    if (!searchText) {
      return null;
    }

    const searchQuery = { q: searchText, limit: config.upstreamMarketLimit };
    const searchResult = await loadWithStaleFallback({
      cache,
      key: createCacheKey("polymarket:event-by-market", { id: market.id, q: searchText }),
      ttlMs: config.cacheTtlMs.marketDetail,
      loader: async () => polymarket.search<{ events?: PolymarketEvent[] }>(searchQuery),
      fallback: () => ({ events: [] }),
    });

    return (
      (searchResult.value.events ?? []).find((event) =>
        (event.markets ?? []).some((childMarket) => childMarket.id === market.id),
      ) ?? null
    );
  }

  function getGroupedEventMarkets(event: PolymarketEvent) {
    const markets = event.markets ?? [];

    if (markets.length <= 1) {
      return [];
    }

    return sortEventMarkets(markets).map((childMarket) => ({
      ...childMarket,
      category: childMarket.category ?? event.category,
      description: childMarket.description ?? event.description,
      image: childMarket.image ?? childMarket.icon ?? event.image ?? event.icon,
      icon: childMarket.icon ?? childMarket.image ?? event.icon ?? event.image,
      startDate: childMarket.startDate ?? event.startDate,
      endDate: childMarket.endDate ?? event.endDate,
      active: childMarket.active ?? event.active,
      closed: childMarket.closed ?? event.closed,
      archived: childMarket.archived ?? event.archived,
      restricted: childMarket.restricted ?? event.restricted,
      volume24hr: childMarket.volume24hr ?? event.volume24hr,
      commentCount: childMarket.commentCount ?? event.commentCount,
      events: [compactEventContext(event)],
    }));
  }

  async function getMarketGroupByMarketId(id: string): Promise<{ data: NormalizedMarketDetail; meta: MarketDataMeta }> {
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
    const event = await findParentEventForMarket(market.value);

    if (!event) {
      throw new MarketDataError("MARKET_GROUP_NOT_FOUND", "Grouped event not found for market.", 404);
    }

    const groupMarkets = getGroupedEventMarkets(event);
    const selectedMarket = marketFromEvent(
      event,
      (event.markets ?? []).find((childMarket) => childMarket.id === id) ?? market.value,
    );
    const relatedMarkets = await getRelatedMarkets(selectedMarket).catch(() => ({
      value: [],
      meta: buildCacheMeta(null, "fallback", [
        "Related markets unavailable; empty fallback returned.",
      ]),
    }));
    const snapshots = await listStoredSnapshots(id);
    const selectedMarketBase = normalizeMarket(selectedMarket);
    const ownTrades = await listOwnTrades(selectedMarketBase.id);
    const ownHistory = buildOwnMarketHistory(selectedMarketBase, ownTrades);

    const detail = await applyPulsePriceHistory(
      normalizeMarketDetail(selectedMarket, relatedMarkets.value, snapshots, ownHistory, groupMarkets),
    );

    return {
      data: await enrichMarketDetailWithOwnActivity(detail, ownTrades),
      meta: mergeSourceMeta(market.meta, relatedMarkets.meta),
    };
  }

  async function getRawMarketByIdOrSlug(identifier: string) {
    return loadWithStaleFallback({
      cache,
      key: createCacheKey("polymarket:market-detail", { identifier }),
      ttlMs: config.cacheTtlMs.marketDetail,
      loader: async () => {
        try {
          return await polymarket.getMarket<PolymarketMarket>(identifier);
        } catch (error) {
          if (!(error instanceof UpstreamError && (error.statusCode === 404 || error.statusCode === 422))) {
            throw error;
          }

          const candidates = await polymarket.getMarkets<PolymarketMarket[]>({
            slug: identifier,
            limit: 1,
          });
          const market = candidates.find((candidate) => candidate.slug === identifier) ?? candidates[0];

          if (!market) {
            throw new MarketDataError("MARKET_NOT_FOUND", "Market not found.", 404);
          }

          return market;
        }
      },
    });
  }

  async function listStoredSnapshots(marketId: string) {
    const snapshots = marketRepository
      ? await marketRepository.listSnapshots(marketId, config.marketSnapshotHistoryLimit)
      : await getSnapshots?.(marketId, config.marketSnapshotHistoryLimit);

    return (snapshots ?? []).filter((snapshot) => snapshot.synthetic !== true);
  }

  async function applyPulsePriceHistory(
    detail: NormalizedMarketDetail,
  ): Promise<NormalizedMarketDetail> {
    if (!priceHistoryRepository) {
      return detail;
    }

    const scope = getMarketPriceHistoryScope(detail);
    const points = await priceHistoryRepository.listPoints({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      limit: 2000,
    });

    if (points.length === 0) {
      return detail;
    }

    return applyPulsePriceHistoryToDetail(detail, points);
  }

  function applyPulsePriceHistoryToDetail(
    detail: NormalizedMarketDetail,
    points: PulseMarketPriceHistoryPoint[],
  ): NormalizedMarketDetail {
    const priceHistory = points.map(mapPulsePointToHistoryPoint);
    const latest = points.at(-1);

    if (!latest) {
      return detail;
    }

    const latestVolume = latest.volume;
    const latestLiquidity = latest.liquidity;
    const groupMarkets = detail.group_markets ?? [];

    if (groupMarkets.length > 1) {
      const enrichedGroups = applyPulsePricesToGroupMarkets(groupMarkets, latest);
      const market = {
        ...detail,
        group_markets: enrichedGroups,
        volume: latestVolume,
        liquidity: latestLiquidity,
        volume_detail: {
          volume: latestVolume,
          liquidity: latestLiquidity,
        },
        history: {
          ...detail.history,
          price_history: priceHistory,
          is_synthetic: false,
        },
      };

      return {
        ...market,
        prices: normalizePriceSummary(market),
      };
    }

    const outcomes = applyPulsePricesToOutcomes(detail.outcomes, latest);
    const market = {
      ...detail,
      outcomes,
      volume: latestVolume,
      liquidity: latestLiquidity,
      volume_detail: {
        volume: latestVolume,
        liquidity: latestLiquidity,
      },
      history: {
        ...detail.history,
        price_history: priceHistory,
        is_synthetic: false,
      },
    };

    return {
      ...market,
      prices: normalizePriceSummary(market),
    };
  }

  function mapPulsePointToHistoryPoint(point: PulseMarketPriceHistoryPoint): MarketPriceHistoryPoint {
    return {
      timestamp: point.capturedAt,
      yes: point.yes,
      no: point.no,
      outcomes: point.outcomes,
      outcomeVolumes: Object.fromEntries(
        point.outcomes.map((outcome) => [outcome.name, outcome.volume ?? 0]),
      ),
      volume: point.volume,
      liquidity: point.liquidity,
      synthetic: false,
    };
  }

  function applyPulsePricesToOutcomes(
    outcomes: NormalizedMarket["outcomes"],
    point: PulseMarketPriceHistoryPoint,
  ) {
    const byName = new Map(
      point.outcomes.map((outcome) => [outcome.name.trim().toLowerCase(), outcome]),
    );
    const sourceOutcomes = outcomes.length > 0
      ? outcomes
      : point.outcomes.map((outcome) => ({
          name: outcome.name,
          price: outcome.price,
          probability: outcome.price,
          price_cents: outcome.price === null ? null : Math.round(outcome.price * 100),
          clobTokenId: null,
        }));

    return sourceOutcomes.map((outcome, index) => {
      const pulseOutcome =
        byName.get(outcome.name.trim().toLowerCase()) ??
        point.outcomes[index] ??
        null;
      const price = pulseOutcome?.price ?? outcome.price;

      return {
        ...outcome,
        price,
        probability: price,
        price_cents: price === null ? null : Math.round(price * 100),
      };
    });
  }

  function applyPulsePricesToGroupMarkets(
    groupMarkets: NormalizedGroupMarket[],
    point: PulseMarketPriceHistoryPoint,
  ) {
    const byName = new Map(
      point.outcomes.map((outcome) => [outcome.name.trim().toLowerCase(), outcome]),
    );

    return groupMarkets.map((groupMarket, index) => {
      const pulseOutcome =
        byName.get(groupMarket.label.trim().toLowerCase()) ??
        point.outcomes[index] ??
        null;
      const yesPrice = pulseOutcome?.price ?? groupMarket.yes_price;
      const noPrice = yesPrice === null ? null : Math.max(0, Math.min(1, 1 - yesPrice));

      return {
        ...groupMarket,
        outcomes: applyBinaryPulsePrice(groupMarket.outcomes, yesPrice, noPrice),
        volume: pulseOutcome?.volume ?? groupMarket.volume,
        liquidity: groupMarket.liquidity,
        yes_price: yesPrice,
        no_price: noPrice,
      };
    });
  }

  function applyBinaryPulsePrice(
    outcomes: NormalizedMarket["outcomes"],
    yesPrice: number | null,
    noPrice: number | null,
  ) {
    const sourceOutcomes = outcomes.length > 0
      ? outcomes
      : [
          { name: "Yes", price: yesPrice, probability: yesPrice, price_cents: null, clobTokenId: null },
          { name: "No", price: noPrice, probability: noPrice, price_cents: null, clobTokenId: null },
        ];

    return sourceOutcomes.map((outcome, index) => {
      const normalized = outcome.name.trim().toLowerCase();
      const price = normalized === "no" || index === 1 ? noPrice : yesPrice;

      return {
        ...outcome,
        price,
        probability: price,
        price_cents: price === null ? null : Math.round(price * 100),
      };
    });
  }

  async function loadClobPriceHistory(market: PolymarketMarket): Promise<MarketPriceHistoryPoint[]> {
    const getPriceHistory = polymarket.getPriceHistory;

    if (!getPriceHistory) {
      return [];
    }

    const normalized = normalizeMarket(market);

    if (normalized.outcomes.length !== 2) {
      return [];
    }

    const yesOutcome =
      normalized.outcomes.find((outcome) => outcome.name.trim().toLowerCase() === "yes")
      ?? normalized.outcomes[0];
    const noOutcome =
      normalized.outcomes.find((outcome) => outcome.name.trim().toLowerCase() === "no")
      ?? normalized.outcomes[1];

    if (!yesOutcome?.clobTokenId || !noOutcome?.clobTokenId) {
      return [];
    }

    const loadTokenHistory = (tokenId: string) =>
      cache.getOrSet(
        createCacheKey("polymarket:clob-price-history", { interval: "all", tokenId }),
        config.cacheTtlMs.marketDetail,
        () => getPriceHistory(tokenId, { interval: "all" }),
      );

    const [yesHistory, noHistory] = await Promise.allSettled([
      loadTokenHistory(yesOutcome.clobTokenId),
      loadTokenHistory(noOutcome.clobTokenId),
    ]);
    const yesPoints =
      yesHistory.status === "fulfilled" ? normalizeClobTokenHistory(yesHistory.value) : [];
    const noPoints =
      noHistory.status === "fulfilled" ? normalizeClobTokenHistory(noHistory.value) : [];

    return mergeBinaryClobHistory({
      yesPoints,
      noPoints,
      volume: normalized.volume,
      liquidity: normalized.liquidity,
    });
  }

  async function collectMarketSnapshot(id: string): Promise<MarketSnapshotCollectResult> {
    const market = await polymarket.getMarket<PolymarketMarket>(id).catch((error) => {
      if (error instanceof UpstreamError && error.statusCode === 404) {
        throw new MarketDataError("MARKET_NOT_FOUND", "Market not found.", 404);
      }

      if (error instanceof UpstreamError) {
        throw new MarketDataError(
          "UPSTREAM_UNAVAILABLE",
          "Market data upstream is unavailable; snapshot was not collected.",
          503,
          {
            upstreamStatusCode: error.statusCode,
            upstreamMessage: error.message,
          },
        );
      }

      throw error;
    });
    const normalized = normalizeMarket(market);
    const snapshot = buildSnapshotFromMarket(normalized);

    if (marketRepository) {
      await marketRepository.upsertMarket(normalized);
      await marketRepository.upsertOutcomes(normalized.id, normalized.outcomes);
      await marketRepository.saveSnapshot(snapshot);
    }

    return {
      data: snapshot,
      meta: buildCacheMeta(
        {
          value: snapshot,
          createdAt: snapshot.captured_at,
          expiresAt: snapshot.captured_at,
          isStale: false,
        },
        "fresh",
      ),
    };
  }

  async function collectMarketSnapshots(ids: string[]) {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    const results = await Promise.allSettled(uniqueIds.map((id) => collectMarketSnapshot(id)));

    return {
      data: results.flatMap((result) => (result.status === "fulfilled" ? [result.value.data] : [])),
      errors: results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              {
                market_id: uniqueIds[index] ?? null,
                message: result.reason instanceof Error ? result.reason.message : "Snapshot collection failed.",
              },
            ]
          : [],
      ),
    };
  }

  async function buildStoredMarketDetail(
    market: NormalizedMarket,
    meta: MarketDataMeta,
  ): Promise<{ data: NormalizedMarketDetail; meta: MarketDataMeta }> {
    const snapshots = await listStoredSnapshots(market.id);
    const ownTrades = await listOwnTrades(market.id);
    const ownHistory = buildOwnMarketHistory(market, ownTrades);
    const prices = normalizePriceSummary(market);
    const snapshotHistory = snapshots.map((snapshot) => ({
      timestamp: snapshot.captured_at,
      yes: snapshot.prices.yes,
      no: snapshot.prices.no,
      outcomes: market.outcomes.map((outcome) => ({
        name: outcome.name,
        price: outcome.price,
      })),
      volume: snapshot.volume,
      liquidity: snapshot.liquidity,
      synthetic: snapshot.synthetic,
    }));
    const fallbackHistory =
      ownHistory.length > 0
        ? ownHistory
        : snapshotHistory.length > 0
          ? snapshotHistory
          : [
              {
                timestamp: new Date().toISOString(),
                yes: prices.yes,
                no: prices.no,
                outcomes: market.outcomes.map((outcome) => ({
                  name: outcome.name,
                  price: outcome.price,
                })),
                volume: market.volume,
                liquidity: market.liquidity,
                synthetic: true,
              },
            ];

    const detail = await applyPulsePriceHistory({
      ...market,
      prices,
      dates: normalizeDateSummary(market),
      volume_detail: {
        volume: market.volume,
        liquidity: market.liquidity,
      },
      related_markets: [],
      history: {
        snapshots,
        price_history: fallbackHistory,
        is_synthetic: ownHistory.length === 0,
      },
      group_markets: market.group_markets ?? [],
    });

    return {
      data: await enrichMarketDetailWithOwnActivity(detail, ownTrades),
      meta,
    };
  }

  async function getMarketDetail(id: string): Promise<{ data: NormalizedMarketDetail; meta: MarketDataMeta }> {
    let market: Awaited<ReturnType<typeof getRawMarketByIdOrSlug>>;

    try {
      market = await getRawMarketByIdOrSlug(id);
    } catch (error) {
      if (error instanceof MarketDataError && error.code === "UPSTREAM_UNAVAILABLE") {
        const storedMarket = await marketRepository?.getMarketById(id);
        if (storedMarket) {
          return buildStoredMarketDetail(storedMarket, {
            lastSyncedAt: null,
            isStale: true,
            sourceStatus: "fallback",
            warnings: ["Polymarket is unavailable; returning stored Pulse Market detail."],
          });
        }
      }

      throw error;
    }

    const marketId = market.value.id || id;

    const emptyRelatedMarkets = {
      value: [] as PolymarketMarket[],
      meta: buildCacheMeta(null, "fallback", [
        "Related markets unavailable; empty fallback returned.",
      ]),
    };
    const [relatedMarkets, snapshots, event] = await Promise.all([
      withTimeout(
        getRelatedMarkets(market.value),
        2_000,
        "Related markets request timed out",
      ).catch(() => emptyRelatedMarkets),
      listStoredSnapshots(marketId),
      withTimeout(
        findParentEventForMarket(market.value),
        2_000,
        "Parent event lookup timed out",
      ).catch(() => null),
    ]);
    const meta = mergeSourceMeta(market.meta, relatedMarkets.meta);

    if (event) {
      const groupMarkets = getGroupedEventMarkets(event);
      if (groupMarkets.length > 1) {
        const selectedMarket = marketFromEvent(
          event,
          (event.markets ?? []).find(
            (childMarket) => childMarket.id === marketId || childMarket.slug === id,
          ) ?? market.value,
        );
        const selectedMarketBase = normalizeMarket(selectedMarket);
        const ownTrades = await listOwnTrades(selectedMarketBase.id);
        const ownHistory = buildOwnMarketHistory(selectedMarketBase, ownTrades);
        const detail = await applyPulsePriceHistory(
          normalizeMarketDetail(
            selectedMarket,
            relatedMarkets.value,
            snapshots,
            ownHistory,
            groupMarkets,
          ),
        );

        return {
          data: await enrichMarketDetailWithOwnActivity(detail, ownTrades),
          meta,
        };
      }
    }

    const normalizedMarket = normalizeMarket(market.value);
    const ownTrades = await listOwnTrades(normalizedMarket.id);
    const ownHistory = buildOwnMarketHistory(normalizedMarket, ownTrades);
    const detail = await applyPulsePriceHistory(
      normalizeMarketDetail(market.value, relatedMarkets.value, snapshots, ownHistory),
    );

    return {
      data: await enrichMarketDetailWithOwnActivity(detail, ownTrades),
      meta,
    };
  }

  async function listCategories(): Promise<NormalizedCategory[]> {
    return cache.getOrSet("markets:categories", config.cacheTtlMs.categories, async () =>
      getCategories(),
    );
  }

  async function listTags(): Promise<NormalizedTag[]> {
    return cache.getOrSet("markets:discovery-tags", config.cacheTtlMs.categories, async () => {
      const homepageTags = polymarket.getHomepageTags
        ? normalizeHomepageTags(await polymarket.getHomepageTags().catch(() => []))
        : [];

      if (homepageTags.length >= 8) {
        return homepageTags;
      }

      const collected = new Map<string, NormalizedTag & { score: number }>();

      if (polymarket.getTags) {
        const carouselTags = await polymarket
          .getTags<PolymarketTag[]>({ limit: 50, is_carousel: true })
          .catch(() => []);
        for (const tag of carouselTags) {
          addDiscoveryTag(collected, tag, 1000000);
        }
      }

      const eventQuery = {
        active: true,
        closed: false,
        limit: Math.min(config.upstreamMarketLimit, 100),
        order: "volume24hr",
        ascending: false,
      };
      const events = await polymarket
        .getEvents<PolymarketEvent[]>(eventQuery)
        .catch(() => []);

      events.forEach((event, index) => {
        const eventVolume = Math.max(1, toNumber(event.volume24hr ?? event.volume));
        const positionBoost = Math.max(1, events.length - index);
        for (const tag of event.tags ?? []) {
          addDiscoveryTag(collected, tag, Math.log10(eventVolume + 10) * 100 + positionBoost);
        }
      });

      return [...collected.values()]
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .map(({ score: _score, ...tag }) => tag)
        .slice(0, 48);
    });
  }

  return {
    listMarkets,
    getMarketDetail,
    getEventBySlugOrId,
    getMarketGroupByMarketId,
    collectMarketSnapshot,
    collectMarketSnapshots,
    listCategories,
    listTags,
    visibilityRules,
  };
}

export type MarketDataService = ReturnType<typeof buildMarketDataService>;
