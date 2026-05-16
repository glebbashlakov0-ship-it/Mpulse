import type {
  MarketSnapshot,
  NormalizedEvent,
  NormalizedMarketDetail,
  NormalizedMarketPriceSummary,
  NormalizedRelatedMarket,
  NormalizedMarket,
  NormalizedGroupMarket,
  NormalizedOutcome,
  MarketPriceHistoryPoint,
  PolymarketEvent,
  PolymarketMarket,
} from "./types.js";
import { getCategoryImage, inferCategory, inferTopics } from "./categories.js";

export function parseJsonArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function toNumber(value: string | number | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: number | string | undefined): number | null {
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseDateMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizeOutcomes(market: PolymarketMarket): NormalizedOutcome[] {
  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices);
  const clobTokenIds = parseJsonArray(market.clobTokenIds);

  return outcomes.map((name, index) => {
    const parsedPrice = Number(prices[index]);

    return {
      name,
      price: Number.isFinite(parsedPrice) ? clampProbability(parsedPrice) : null,
      probability: Number.isFinite(parsedPrice) ? clampProbability(parsedPrice) : null,
      price_cents: Number.isFinite(parsedPrice)
        ? Math.round(clampProbability(parsedPrice) * 100)
        : null,
      clobTokenId: clobTokenIds[index] ?? null,
    };
  });
}

function getPrimaryEventContext(market: PolymarketMarket) {
  return market.events?.[0] ?? null;
}

function normalizeGroupValue(value: string | number | undefined) {
  return value === undefined || value === null ? null : String(value);
}

function getGroupMarketLabel(market: PolymarketMarket | NormalizedMarket) {
  const label = market.groupItemTitle?.trim();

  return label || ("title" in market ? market.title : market.question) || "Market";
}

export function normalizeMarket(market: PolymarketMarket): NormalizedMarket {
  const category = inferCategory(market);
  const topics = inferTopics(market);
  const sourceImage = market.image ?? market.icon ?? null;
  const normalizedDates = normalizeDateFields(market);
  const eventContext = getPrimaryEventContext(market);
  const eventSlug = eventContext?.slug ?? null;

  return {
    id: market.id,
    slug: market.slug ?? null,
    title: market.question ?? "",
    title_ar: null,
    description: market.description ?? null,
    category: category.slug,
    category_label: category.label,
    topics,
    image: sourceImage ?? getCategoryImage(category.slug),
    icon: market.icon ?? null,
    starts_at: market.startDate ?? null,
    ends_at: market.endDate ?? null,
    status: normalizedDates.status,
    active: Boolean(market.active),
    closed: Boolean(market.closed),
    archived: Boolean(market.archived),
    restricted: Boolean(market.restricted),
    volume: toNumber(market.volumeNum ?? market.volume),
    volume_24h: toNumber(market.volume24hr),
    liquidity: toNumber(market.liquidityNum ?? market.liquidity),
    outcomes: normalizeOutcomes(market),
    trading: {
      order_book_enabled: Boolean(market.enableOrderBook),
      accepting_orders: Boolean(market.acceptingOrders),
      best_bid: nullableNumber(market.bestBid),
      best_ask: nullableNumber(market.bestAsk),
      last_trade_price: nullableNumber(market.lastTradePrice),
    },
    event_id: eventContext?.id ?? null,
    event_slug: eventSlug,
    event_title: eventContext?.title ?? null,
    groupItemTitle: market.groupItemTitle ?? null,
    groupItemThreshold: normalizeGroupValue(market.groupItemThreshold),
    canonical_market_id: market.id,
    canonical_event_slug: eventSlug,
    group_markets: normalizeGroupMarkets(market.groupMarkets ?? []),
    source: "polymarket",
  };
}

function getOutcomePrice(market: NormalizedMarket, outcomeName: string): number | null {
  return (
    market.outcomes.find(
      (outcome) => outcome.name.toLowerCase() === outcomeName.toLowerCase(),
    )?.price ?? null
  );
}

export function normalizePriceSummary(market: NormalizedMarket): NormalizedMarketPriceSummary {
  const yes = getOutcomePrice(market, "yes") ?? market.outcomes[0]?.price ?? null;
  const no = getOutcomePrice(market, "no") ?? (yes === null ? null : 1 - yes);
  const bestBid = market.trading.best_bid;
  const bestAsk = market.trading.best_ask;
  const midpoint =
    bestBid !== null && bestAsk !== null ? clampProbability((bestBid + bestAsk) / 2) : null;
  const spread =
    bestBid !== null && bestAsk !== null ? Math.max(0, bestAsk - bestBid) : null;

  return {
    yes,
    no: no === null ? null : clampProbability(no),
    best_bid: bestBid,
    best_ask: bestAsk,
    last_trade: market.trading.last_trade_price,
    midpoint,
    spread,
  };
}

function normalizeDateFields(market: {
  starts_at?: string | null;
  ends_at?: string | null;
  startDate?: string;
  endDate?: string;
  closed?: boolean;
  archived?: boolean;
}): NormalizedMarketDetail["dates"] {
  const startsAt = "starts_at" in market ? market.starts_at ?? null : market.startDate ?? null;
  const endsAt = "ends_at" in market ? market.ends_at ?? null : market.endDate ?? null;
  const startsAtMs = parseDateMs(startsAt);
  const endsAtMs = parseDateMs(endsAt);
  const now = Date.now();
  let status: NormalizedMarketDetail["dates"]["status"] = "live";

  if (market.closed || market.archived) {
    status = "closed";
  } else if (endsAtMs !== null && endsAtMs <= now) {
    status = "expired";
  } else if (startsAtMs !== null && startsAtMs > now) {
    status = "upcoming";
  }

  return {
    starts_at: startsAt,
    ends_at: endsAt,
    starts_at_ms: startsAtMs,
    ends_at_ms: endsAtMs,
    status,
    seconds_to_close:
      endsAtMs !== null && endsAtMs > now ? Math.round((endsAtMs - now) / 1000) : null,
  };
}

export function normalizeDateSummary(market: NormalizedMarket): NormalizedMarketDetail["dates"] {
  return normalizeDateFields(market);
}

function normalizeRelatedMarket(market: PolymarketMarket): NormalizedRelatedMarket {
  const normalized = normalizeMarket(market);

  return {
    id: normalized.id,
    slug: normalized.slug,
    title: normalized.title,
    category: normalized.category,
    image: normalized.image,
    icon: normalized.icon,
    volume: normalized.volume,
    ends_at: normalized.ends_at,
    probability: normalizePriceSummary(normalized).yes,
  };
}

function buildPriceHistory(
  snapshots: MarketSnapshot[],
  fallbackMarket: NormalizedMarket,
  clobHistory: MarketPriceHistoryPoint[] = [],
): { snapshots: MarketSnapshot[]; price_history: MarketPriceHistoryPoint[]; is_synthetic: boolean } {
  if (clobHistory.length > 0) {
    return {
      snapshots,
      price_history: clobHistory,
      is_synthetic: false,
    };
  }

  if (snapshots.length > 0) {
    return {
      snapshots,
      price_history: snapshots.map((snapshot, index) => ({
        timestamp: snapshot.captured_at,
        yes: snapshot.prices.yes,
        no: snapshot.prices.no,
        outcomes:
          snapshot.synthetic === true
            ? buildSyntheticOutcomeHistory(fallbackMarket.outcomes, index, snapshots.length)
            : undefined,
        volume: snapshot.volume,
        liquidity: snapshot.liquidity,
        synthetic: snapshot.synthetic,
      })),
      is_synthetic: snapshots.every((snapshot) => snapshot.synthetic === true),
    };
  }

  const prices = normalizePriceSummary(fallbackMarket);
  const now = Date.now();
  const syntheticSnapshots = Array.from({ length: 12 }).map((_, index) => {
    const progress = index / 11;
    const drift = Math.sin(index * 0.9) * 0.015;
    const isLatest = index === 11;
    const yes =
      prices.yes === null
        ? null
        : isLatest
          ? prices.yes
          : clampProbability(prices.yes + (progress - 1) * 0.04 + drift);
    const no = isLatest ? prices.no : yes === null ? prices.no : clampProbability(1 - yes);
    const capturedAt = new Date(now - (11 - index) * 60 * 60 * 1000).toISOString();

    return {
      id: `${fallbackMarket.id}:synthetic:${index}`,
      market_id: fallbackMarket.id,
      captured_at: capturedAt,
      prices: {
        ...prices,
        yes,
        no,
      },
      volume: Math.max(0, Math.round(fallbackMarket.volume * (0.85 + progress * 0.15))),
      liquidity: fallbackMarket.liquidity,
      source: fallbackMarket.source,
      synthetic: true,
    } satisfies MarketSnapshot;
  });

  return {
    snapshots: syntheticSnapshots,
    price_history: syntheticSnapshots.map((snapshot) => ({
      timestamp: snapshot.captured_at,
      yes: snapshot.prices.yes,
      no: snapshot.prices.no,
      outcomes: buildSyntheticOutcomeHistory(
        fallbackMarket.outcomes,
        Number(snapshot.id.split(":").at(-1) ?? 0),
        syntheticSnapshots.length,
      ),
      volume: snapshot.volume,
      liquidity: snapshot.liquidity,
      synthetic: true,
    })),
    is_synthetic: true,
  };
}

function buildSyntheticOutcomeHistory(
  outcomes: NormalizedMarket["outcomes"],
  index: number,
  total: number,
) {
  const progress = total <= 1 ? 1 : index / (total - 1);

  return outcomes.map((outcome, outcomeIndex) => {
    const basePrice = outcome.price ?? outcome.probability;
    const isLatest = index === total - 1;
    const drift = Math.sin((index + 1) * (outcomeIndex + 1) * 0.7) * 0.01;
    const trend = (progress - 1) * 0.02;

    return {
      name: outcome.name,
      price:
        basePrice === null
          ? null
          : isLatest
            ? basePrice
            : clampProbability(basePrice + drift + trend),
    };
  });
}

export function normalizeMarketDetail(
  market: PolymarketMarket,
  relatedMarkets: PolymarketMarket[] = [],
  snapshots: MarketSnapshot[] = [],
  clobHistory: MarketPriceHistoryPoint[] = [],
  groupMarkets: PolymarketMarket[] = [],
): NormalizedMarketDetail {
  const normalized = normalizeMarket(market);
  const history = buildPriceHistory(snapshots, normalized, clobHistory);
  const related = relatedMarkets
    .filter((relatedMarket) => relatedMarket.id !== market.id)
    .map(normalizeRelatedMarket)
    .slice(0, 8);

  return {
    ...normalized,
    prices: normalizePriceSummary(normalized),
    dates: normalizeDateSummary(normalized),
    volume_detail: {
      volume: normalized.volume,
      liquidity: normalized.liquidity,
    },
    related_markets: related,
    history,
    group_markets: normalizeGroupMarkets(groupMarkets),
  };
}

export function normalizeGroupMarket(market: PolymarketMarket): NormalizedGroupMarket {
  const normalized = normalizeMarket(market);
  const prices = normalizePriceSummary(normalized);

  return {
    ...normalized,
    label: getGroupMarketLabel(market),
    yes_price: prices.yes,
    no_price: prices.no,
    clobTokenIds: parseJsonArray(market.clobTokenIds),
  };
}

export function normalizeGroupMarkets(markets: PolymarketMarket[]): NormalizedGroupMarket[] {
  return [...markets]
    .sort((left, right) => {
      const leftThreshold = Number(left.groupItemThreshold);
      const rightThreshold = Number(right.groupItemThreshold);
      const thresholdSort =
        Number.isFinite(leftThreshold) && Number.isFinite(rightThreshold)
          ? leftThreshold - rightThreshold
          : 0;

      return (
        thresholdSort ||
        toNumber(right.volumeNum ?? right.volume) - toNumber(left.volumeNum ?? left.volume)
      );
    })
    .map(normalizeGroupMarket);
}

export function normalizeEvent(event: PolymarketEvent): NormalizedEvent {
  const category = inferCategory({
    category: event.category,
    question: event.title,
    description: event.description,
  });
  const topics = inferTopics({
    category: event.category,
    question: event.title,
    description: event.description,
  });
  const sourceImage = event.image ?? event.icon ?? null;
  const dates = normalizeDateFields({
    startDate: event.startDate,
    endDate: event.endDate,
    closed: event.closed,
    archived: event.archived,
  });

  return {
    id: event.id,
    slug: event.slug ?? null,
    title: event.title ?? "",
    title_ar: null,
    description: event.description ?? null,
    category: category.slug,
    category_label: category.label,
    topics,
    image: sourceImage ?? getCategoryImage(category.slug),
    icon: event.icon ?? null,
    starts_at: event.startDate ?? null,
    ends_at: event.endDate ?? null,
    status: dates.status,
    active: Boolean(event.active),
    closed: Boolean(event.closed),
    archived: Boolean(event.archived),
    restricted: Boolean(event.restricted),
    volume: toNumber(event.volume),
    volume_24h: toNumber(event.volume24hr),
    liquidity: toNumber(event.liquidity),
    open_interest: toNumber(event.openInterest),
    tags: (event.tags ?? []).map((tag) => ({
      id: tag.id ?? null,
      label: tag.label ?? null,
      slug: tag.slug ?? null,
    })),
    markets: (event.markets ?? []).map((market) =>
      normalizeMarket({
        ...market,
        question: market.question ?? event.title,
        category: market.category ?? event.category,
        image: event.image ?? event.icon ?? market.image,
        icon: event.icon ?? event.image ?? market.icon,
        events: [event],
      }),
    ),
    source: "polymarket",
  };
}
