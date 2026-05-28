import type { MarketTradeActivityRecord } from "./marketActivityRepository.js";
import type {
  MarketPriceHistoryPoint,
  NormalizedGroupMarket,
  NormalizedMarket,
  NormalizedOutcome,
} from "./types.js";

export type OwnMarketStats = {
  outcomes: NormalizedOutcome[];
  volume: number;
  volume24h: number;
  liquidity: number;
  yes: number | null;
  no: number | null;
  outcomeVolumes: Record<string, number>;
  outcomePools: Record<string, number>;
};

export type GroupedMarketStats = {
  markets: NormalizedGroupMarket[];
  volume: number;
  volume24h: number;
  liquidity: number;
  outcomeVolumes: Record<string, number>;
  outcomePools: Record<string, number>;
};

type MarketLike = Pick<NormalizedMarket, "id" | "outcomes"> & {
  starts_at?: string | null;
  created_at?: string | null;
};

type PoolState = {
  pools: Map<string, number>;
  volumes: Map<string, number>;
  volume: number;
  volume24h: number;
};

const oneDayMs = 24 * 60 * 60 * 1000;

export function buildOwnMarketStats(
  market: Pick<NormalizedMarket, "outcomes">,
  trades: MarketTradeActivityRecord[],
  now = Date.now(),
): OwnMarketStats {
  const outcomes = getMarketOutcomes(market.outcomes);
  const state = createPoolState(outcomes);
  const recentCutoff = now - oneDayMs;

  for (const trade of trades) {
    applyTradeToPoolState(state, outcomes, trade, recentCutoff);
  }

  return buildStatsFromPoolState(outcomes, state);
}

export function buildOwnMarketHistory(
  market: MarketLike,
  trades: MarketTradeActivityRecord[],
  now = Date.now(),
): MarketPriceHistoryPoint[] {
  const outcomes = getMarketOutcomes(market.outcomes);
  const orderedTrades = sortTradesAscending(trades);
  const state = createPoolState(outcomes);
  const recentCutoff = now - oneDayMs;
  const initialTimestamp = getInitialHistoryTimestamp(market, orderedTrades, now);
  const points: MarketPriceHistoryPoint[] = [
    buildHistoryPoint({
      timestamp: initialTimestamp,
      outcomes,
      state,
    }),
  ];

  for (const trade of orderedTrades) {
    applyTradeToPoolState(state, outcomes, trade, recentCutoff);
    const timestamp = toIsoTimestamp(trade.createdAt);

    if (!timestamp) {
      continue;
    }

    points.push(
      buildHistoryPoint({
        timestamp,
        outcomes,
        state,
      }),
    );
  }

  return points;
}

export function buildGroupedMarketStats(
  markets: NormalizedGroupMarket[],
  tradesByMarketId: Map<string, MarketTradeActivityRecord[]>,
  now = Date.now(),
): GroupedMarketStats {
  const state = createGroupedPoolState(markets);
  const recentCutoff = now - oneDayMs;

  for (const market of markets) {
    for (const trade of tradesByMarketId.get(market.id) ?? []) {
      applyGroupedTrade(state, markets, trade, recentCutoff);
    }
  }

  return buildGroupedStatsFromState(markets, state);
}

export function buildGroupedMarketHistory(
  markets: NormalizedGroupMarket[],
  tradesByMarketId: Map<string, MarketTradeActivityRecord[]>,
  now = Date.now(),
): MarketPriceHistoryPoint[] {
  const state = createGroupedPoolState(markets);
  const trades = sortTradesAscending(
    markets.flatMap((market) => tradesByMarketId.get(market.id) ?? []),
  );
  const initialTimestamp = getGroupedInitialHistoryTimestamp(markets, trades, now);
  const recentCutoff = now - oneDayMs;
  const points: MarketPriceHistoryPoint[] = [
    buildGroupedHistoryPoint({
      timestamp: initialTimestamp,
      markets,
      state,
    }),
  ];

  for (const trade of trades) {
    applyGroupedTrade(state, markets, trade, recentCutoff);
    const timestamp = toIsoTimestamp(trade.createdAt);

    if (!timestamp) {
      continue;
    }

    points.push(
      buildGroupedHistoryPoint({
        timestamp,
        markets,
        state,
      }),
    );
  }

  return points;
}

function getMarketOutcomes(outcomes: NormalizedOutcome[]) {
  return outcomes.length > 0 ? outcomes : getDefaultBinaryOutcomes();
}

function getDefaultBinaryOutcomes(): NormalizedOutcome[] {
  return [
    { name: "Yes", price: 0.5, probability: 0.5, price_cents: 50, clobTokenId: null },
    { name: "No", price: 0.5, probability: 0.5, price_cents: 50, clobTokenId: null },
  ];
}

function createPoolState(outcomes: NormalizedOutcome[]): PoolState {
  return {
    pools: new Map(outcomes.map((outcome) => [getOutcomeKey(outcome.name), 0])),
    volumes: new Map(outcomes.map((outcome) => [getOutcomeKey(outcome.name), 0])),
    volume: 0,
    volume24h: 0,
  };
}

function createGroupedPoolState(markets: NormalizedGroupMarket[]): PoolState {
  return {
    pools: new Map(markets.map((market) => [market.id, 0])),
    volumes: new Map(markets.map((market) => [market.id, 0])),
    volume: 0,
    volume24h: 0,
  };
}

function applyTradeToPoolState(
  state: PoolState,
  outcomes: NormalizedOutcome[],
  trade: MarketTradeActivityRecord,
  recentCutoff: number,
) {
  const amount = getTradeStakeAmount(trade);
  if (amount <= 0) {
    return;
  }

  const outcomeKey = getTradeOutcomeKey(outcomes, trade.side);
  const signedAmount = trade.action === "sell" ? -amount : amount;

  state.pools.set(outcomeKey, Math.max(0, (state.pools.get(outcomeKey) ?? 0) + signedAmount));

  if (trade.action === "buy") {
    state.volumes.set(outcomeKey, (state.volumes.get(outcomeKey) ?? 0) + amount);
    state.volume += amount;
    if (Date.parse(trade.createdAt) >= recentCutoff) {
      state.volume24h += amount;
    }
  }
}

function applyGroupedTrade(
  state: PoolState,
  markets: NormalizedGroupMarket[],
  trade: MarketTradeActivityRecord,
  recentCutoff: number,
) {
  const amount = getTradeStakeAmount(trade);
  if (amount <= 0 || markets.length === 0) {
    return;
  }

  if (trade.side === "no") {
    const alternatives = markets.filter((market) => market.id !== trade.marketId);
    const signedAmount = trade.action === "sell" ? -amount : amount;
    const splitAmount = alternatives.length > 0 ? signedAmount / alternatives.length : 0;
    for (const market of alternatives) {
      state.pools.set(market.id, Math.max(0, (state.pools.get(market.id) ?? 0) + splitAmount));
    }
  } else {
    const signedAmount = trade.action === "sell" ? -amount : amount;
    state.pools.set(trade.marketId, Math.max(0, (state.pools.get(trade.marketId) ?? 0) + signedAmount));
  }

  if (trade.action === "buy") {
    state.volumes.set(trade.marketId, (state.volumes.get(trade.marketId) ?? 0) + amount);
    state.volume += amount;
    if (Date.parse(trade.createdAt) >= recentCutoff) {
      state.volume24h += amount;
    }
  }
}

function buildStatsFromPoolState(outcomes: NormalizedOutcome[], state: PoolState): OwnMarketStats {
  const totalPool = getTotalPool(state);
  const pricedOutcomes = outcomes.map((outcome, index) => {
    const key = getOutcomeKey(outcome.name);
    const probability =
      totalPool > 0
        ? clampProbability((state.pools.get(key) ?? 0) / totalPool)
        : getInitialProbability(index, outcomes.length, outcome.price ?? outcome.probability);

    return withOutcomeProbability(outcome, probability);
  });
  const yes = getOutcomeProbability(pricedOutcomes, "yes") ?? pricedOutcomes[0]?.price ?? null;
  const no =
    getOutcomeProbability(pricedOutcomes, "no") ??
    (pricedOutcomes.length === 2 ? pricedOutcomes[1]?.price ?? null : null);

  return {
    outcomes: pricedOutcomes,
    volume: roundMoney(state.volume),
    volume24h: roundMoney(state.volume24h),
    liquidity: roundMoney(totalPool),
    yes,
    no,
    outcomeVolumes: mapAmountsToOutcomeNames(outcomes, state.volumes),
    outcomePools: mapAmountsToOutcomeNames(outcomes, state.pools),
  };
}

function buildGroupedStatsFromState(
  markets: NormalizedGroupMarket[],
  state: PoolState,
): GroupedMarketStats {
  const totalPool = getTotalPool(state);
  const enrichedMarkets = markets.map((market, index) => {
    const probability =
      totalPool > 0
        ? clampProbability((state.pools.get(market.id) ?? 0) / totalPool)
        : getInitialProbability(index, markets.length, market.yes_price);
    const noProbability = clampProbability(1 - probability);
    const outcomes = applyBinaryOutcomePrices(market.outcomes, probability, noProbability);

    return {
      ...market,
      outcomes,
      volume: roundMoney(state.volumes.get(market.id) ?? 0),
      volume_24h: roundMoney(state.volumes.get(market.id) ?? 0),
      liquidity: roundMoney(state.pools.get(market.id) ?? 0),
      yes_price: probability,
      no_price: noProbability,
    };
  });

  return {
    markets: enrichedMarkets,
    volume: roundMoney(state.volume),
    volume24h: roundMoney(state.volume24h),
    liquidity: roundMoney(totalPool),
    outcomeVolumes: Object.fromEntries(
      markets.map((market) => [market.label, roundMoney(state.volumes.get(market.id) ?? 0)]),
    ),
    outcomePools: Object.fromEntries(
      markets.map((market) => [market.label, roundMoney(state.pools.get(market.id) ?? 0)]),
    ),
  };
}

function buildHistoryPoint({
  timestamp,
  outcomes,
  state,
}: {
  timestamp: string;
  outcomes: NormalizedOutcome[];
  state: PoolState;
}): MarketPriceHistoryPoint {
  const stats = buildStatsFromPoolState(outcomes, state);

  return {
    timestamp,
    yes: stats.yes,
    no: stats.no,
    outcomes: stats.outcomes.map((outcome) => ({
      name: outcome.name,
      price: outcome.price,
      volume: stats.outcomeVolumes[outcome.name] ?? 0,
    })),
    outcomeVolumes: stats.outcomeVolumes,
    volume: stats.volume,
    liquidity: stats.liquidity,
    synthetic: false,
  };
}

function buildGroupedHistoryPoint({
  timestamp,
  markets,
  state,
}: {
  timestamp: string;
  markets: NormalizedGroupMarket[];
  state: PoolState;
}): MarketPriceHistoryPoint {
  const stats = buildGroupedStatsFromState(markets, state);
  const outcomes = stats.markets.map((market) => ({
    name: market.label,
    price: market.yes_price,
    volume: stats.outcomeVolumes[market.label] ?? 0,
  }));

  return {
    timestamp,
    yes: outcomes[0]?.price ?? null,
    no: outcomes[1]?.price ?? null,
    outcomes,
    outcomeVolumes: stats.outcomeVolumes,
    volume: stats.volume,
    liquidity: stats.liquidity,
    synthetic: false,
  };
}

function applyBinaryOutcomePrices(
  outcomes: NormalizedOutcome[],
  yes: number,
  no: number,
): NormalizedOutcome[] {
  return getMarketOutcomes(outcomes).map((outcome, index) => {
    const normalized = outcome.name.trim().toLowerCase();
    const price = normalized === "no" || index === 1 ? no : yes;

    return withOutcomeProbability(outcome, price);
  });
}

function withOutcomeProbability(outcome: NormalizedOutcome, probability: number): NormalizedOutcome {
  return {
    ...outcome,
    price: probability,
    probability,
    price_cents: Math.round(probability * 100),
  };
}

function getTradeOutcomeKey(outcomes: NormalizedOutcome[], side: "yes" | "no") {
  const exact = outcomes.find((outcome) => outcome.name.trim().toLowerCase() === side);
  if (exact) {
    return getOutcomeKey(exact.name);
  }

  const fallback = side === "no" ? outcomes[1] : outcomes[0];
  return getOutcomeKey(fallback?.name ?? side);
}

function getOutcomeProbability(outcomes: NormalizedOutcome[], name: string) {
  return outcomes.find((outcome) => outcome.name.trim().toLowerCase() === name)?.price ?? null;
}

function mapAmountsToOutcomeNames(outcomes: NormalizedOutcome[], amounts: Map<string, number>) {
  return Object.fromEntries(
    outcomes.map((outcome) => [
      outcome.name,
      roundMoney(amounts.get(getOutcomeKey(outcome.name)) ?? 0),
    ]),
  );
}

function getTotalPool(state: PoolState) {
  return [...state.pools.values()].reduce((total, amount) => total + Math.max(0, amount), 0);
}

function getTradeStakeAmount(trade: MarketTradeActivityRecord) {
  return Math.max(0, trade.amount);
}

function sortTradesAscending(trades: MarketTradeActivityRecord[]) {
  return [...trades].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function getInitialHistoryTimestamp(
  market: MarketLike,
  trades: MarketTradeActivityRecord[],
  now: number,
) {
  const firstTradeMs = trades[0] ? Date.parse(trades[0].createdAt) : null;
  const candidate = market.starts_at ? Date.parse(market.starts_at) : Number.NaN;

  if (
    Number.isFinite(candidate) &&
    (firstTradeMs === null || candidate < firstTradeMs)
  ) {
    return new Date(candidate).toISOString();
  }

  if (firstTradeMs !== null && Number.isFinite(firstTradeMs)) {
    return new Date(Math.max(0, firstTradeMs - 1)).toISOString();
  }

  return new Date(now).toISOString();
}

function getGroupedInitialHistoryTimestamp(
  markets: NormalizedGroupMarket[],
  trades: MarketTradeActivityRecord[],
  now: number,
) {
  const startsAt = markets
    .map((market) => (market.starts_at ? Date.parse(market.starts_at) : Number.NaN))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  const firstTradeMs = trades[0] ? Date.parse(trades[0].createdAt) : null;

  if (
    startsAt !== undefined &&
    (firstTradeMs === null || startsAt < firstTradeMs)
  ) {
    return new Date(startsAt).toISOString();
  }

  if (firstTradeMs !== null && Number.isFinite(firstTradeMs)) {
    return new Date(Math.max(0, firstTradeMs - 1)).toISOString();
  }

  return new Date(now).toISOString();
}

function getInitialProbability(
  index: number,
  totalOutcomes: number,
  preferredPrice?: number | null,
) {
  if (preferredPrice !== undefined && preferredPrice !== null && Number.isFinite(preferredPrice)) {
    return clampProbability(preferredPrice);
  }

  return totalOutcomes > 0 ? clampProbability(1 / totalOutcomes) : index === 0 ? 1 : 0;
}

function getOutcomeKey(name: string) {
  return name.trim().toLowerCase();
}

function toIsoTimestamp(value: string) {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function clampProbability(value: number) {
  return Math.min(1, Math.max(0, value));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
