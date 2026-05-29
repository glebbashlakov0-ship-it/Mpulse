import { createHash } from "node:crypto";
import type { MarketDataService } from "./marketDataService.js";
import type {
  MarketPriceHistoryRepository,
  PulseMarketPriceHistoryOutcome,
  PulseMarketPriceHistoryPoint,
  SaveMarketPriceHistoryPointInput,
} from "./marketPriceHistoryRepository.js";
import { getMarketPriceHistoryScope, type MarketPriceHistoryScope } from "./marketPriceHistoryScope.js";
import type { NormalizedMarketDetail } from "./types.js";

export const chartSeedRanges = ["1H", "6H", "1D", "1W", "1M", "ALL"] as const;

export type SeedOddsHistoryOptions = {
  points?: unknown;
  volatility?: unknown;
  force?: unknown;
};

export type OddsOverrideInput = {
  outcomes?: unknown;
  reason?: unknown;
};

export class MarketSeedError extends Error {
  constructor(
    public readonly code:
      | "INVALID_MARKET_SEED_INPUT"
      | "INVALID_MARKET_ODDS"
      | "MARKET_SEED_UNAVAILABLE",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function buildMarketSeedService({
  marketData,
  priceHistoryRepository,
}: {
  marketData: MarketDataService;
  priceHistoryRepository: MarketPriceHistoryRepository;
}) {
  async function seedOddsHistory(input: {
    marketId: string;
    adminUserId: string | null;
    options?: SeedOddsHistoryOptions;
  }) {
    const market = (await marketData.getMarketDetail(input.marketId)).data;
    const scope = getMarketPriceHistoryScope(market);
    const force = input.options?.force === true;
    const existing = await priceHistoryRepository.listPoints({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      source: "pulse_seed",
      limit: 2000,
    });

    if (existing.length > 0 && !force) {
      return buildSeedResult({
        market,
        scope,
        points: existing,
        created: false,
      });
    }

    if (force) {
      await priceHistoryRepository.deletePoints({
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        source: "pulse_seed",
      });
    }

    const generated = generateSeedOddsHistory({
      scope,
      outcomes: getSeedOutcomes(market),
      points: parsePointCount(input.options?.points),
      volatility: parseVolatility(input.options?.volatility),
      createdBy: input.adminUserId,
    });
    const saved = await priceHistoryRepository.savePoints(generated);

    return buildSeedResult({
      market,
      scope,
      points: saved,
      created: true,
    });
  }

  async function overrideOdds(input: {
    marketId: string;
    adminUserId: string | null;
    body: OddsOverrideInput;
  }) {
    const market = (await marketData.getMarketDetail(input.marketId)).data;
    const scope = getMarketPriceHistoryScope(market);
    const outcomes = validateOverrideOutcomes(market, input.body?.outcomes);
    const yes = getOutcomePrice(outcomes, "yes") ?? outcomes[0]?.price ?? null;
    const no =
      getOutcomePrice(outcomes, "no") ??
      (outcomes.length === 2 ? outcomes[1]?.price ?? null : null);
    const latestPulsePoint = (await priceHistoryRepository.listPoints({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      limit: 1,
    })).at(-1);
    const volume = latestPulsePoint?.volume ?? market.volume_detail.volume;
    const liquidity = latestPulsePoint?.liquidity ?? market.volume_detail.liquidity;
    const reason =
      typeof input.body?.reason === "string" && input.body.reason.trim()
        ? input.body.reason.trim().slice(0, 500)
        : null;

    const point = await priceHistoryRepository.savePoint({
      ...scope,
      capturedAt: new Date().toISOString(),
      outcomes,
      yes,
      no,
      volume,
      liquidity,
      source: "admin",
      createdBy: input.adminUserId,
      metadata: {
        source: "admin",
        reason,
      },
    });

    return {
      marketId: market.id,
      scope,
      point,
      outcomes,
    };
  }

  return {
    seedOddsHistory,
    overrideOdds,
    repository: priceHistoryRepository,
  };
}

export type MarketSeedService = ReturnType<typeof buildMarketSeedService>;

export function generateSeedOddsHistory({
  scope,
  outcomes,
  points = 260,
  volatility = 0.12,
  nowMs = Date.now(),
  createdBy = null,
}: {
  scope: MarketPriceHistoryScope;
  outcomes: Array<{ name: string }>;
  points?: number;
  volatility?: number;
  nowMs?: number;
  createdBy?: string | null;
}): SaveMarketPriceHistoryPointInput[] {
  const normalizedOutcomes = normalizeSeedOutcomeNames(outcomes);
  const rng = createSeededRandom(`pulse-market:${scope.scopeType}:${scope.scopeId}:v8`);
  const basePrices = normalizedOutcomes.length <= 2
    ? buildBinarySeedPrices(rng)
    : buildMultiSeedPrices(normalizedOutcomes.length, rng);
  const timestamps = buildSeedTimestamps(points, nowMs);
  const multiOutcomeDrift = basePrices.length > 2
    ? buildMultiOutcomeDrift(basePrices.length, timestamps.length, volatility, rng)
    : [];
  const baseVolume = roundMoney(2_000 + rng() * 95_000);
  const baseLiquidity = roundMoney(500 + baseVolume * (0.12 + rng() * 0.38));
  const phase = rng() * Math.PI * 2;

  return timestamps.map((capturedAtMs, index) => {
    const isLatest = index === timestamps.length - 1;
    const progress = timestamps.length <= 1 ? 1 : index / (timestamps.length - 1);
    const prices = isLatest
      ? basePrices
      : perturbPrices(basePrices, {
          volatility,
          progress,
          phase,
          rng,
          drift: multiOutcomeDrift.map((drift) => drift[index] ?? 0),
        });
    const outcomesForPoint = normalizedOutcomes.map((outcome, outcomeIndex) => ({
      name: outcome.name,
      price: prices[outcomeIndex] ?? null,
      volume: roundMoney(baseVolume * progress * (0.35 + (prices[outcomeIndex] ?? 0) * 0.9)),
    }));
    const yes = getOutcomePrice(outcomesForPoint, "yes") ?? outcomesForPoint[0]?.price ?? null;
    const no =
      getOutcomePrice(outcomesForPoint, "no") ??
      (outcomesForPoint.length === 2 ? outcomesForPoint[1]?.price ?? null : null);

    return {
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      marketExternalId: scope.marketExternalId,
      capturedAt: new Date(capturedAtMs).toISOString(),
      outcomes: outcomesForPoint,
      yes,
      no,
      volume: roundMoney(baseVolume * progress),
      liquidity: roundMoney(baseLiquidity * (0.72 + progress * 0.28)),
      source: "pulse_seed",
      createdBy,
      metadata: {
        source: "pulse_seed",
        deterministicVersion: 8,
        chartRanges: [...chartSeedRanges],
      },
    };
  });
}

function buildSeedResult({
  market,
  scope,
  points,
  created,
}: {
  market: NormalizedMarketDetail;
  scope: MarketPriceHistoryScope;
  points: PulseMarketPriceHistoryPoint[];
  created: boolean;
}) {
  const latest = points.at(-1) ?? null;

  return {
    marketId: market.id,
    scope,
    created,
    outcomes: latest?.outcomes ?? [],
    latestPoint: latest,
    points,
    pointCount: points.length,
  };
}

function getSeedOutcomes(market: NormalizedMarketDetail) {
  const groupMarkets = market.group_markets ?? [];
  if (groupMarkets.length > 1) {
    return groupMarkets.map((groupMarket) => ({
      name: groupMarket.label,
    }));
  }

  return market.outcomes.length > 0
    ? market.outcomes.map((outcome) => ({ name: outcome.name }))
    : [{ name: "Yes" }, { name: "No" }];
}

function normalizeSeedOutcomeNames(outcomes: Array<{ name: string }>) {
  const names = outcomes
    .map((outcome) => outcome.name.trim())
    .filter(Boolean);

  if (names.length <= 2) {
    return [{ name: "Yes" }, { name: "No" }];
  }

  return names.map((name, index) => ({
    name: name || `Outcome ${index + 1}`,
  }));
}

function validateOverrideOutcomes(
  market: NormalizedMarketDetail,
  value: unknown,
): PulseMarketPriceHistoryOutcome[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MarketSeedError(
      "INVALID_MARKET_ODDS",
      "outcomes must be a non-empty array of { name, price }.",
    );
  }

  const expectedOutcomes = getSeedOutcomes(market);
  const expectedNames = new Set(expectedOutcomes.map((outcome) => getOutcomeKey(outcome.name)));
  const parsed = value.map((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("name" in candidate) ||
      !("price" in candidate)
    ) {
      throw new MarketSeedError(
        "INVALID_MARKET_ODDS",
        "Each outcome must include name and price.",
      );
    }

    const name = String((candidate as { name: unknown }).name).trim();
    const price = Number((candidate as { price: unknown }).price);

    if (!name || !Number.isFinite(price) || price < 0 || price > 1) {
      throw new MarketSeedError(
        "INVALID_MARKET_ODDS",
        "Outcome prices must be numbers from 0 to 1.",
      );
    }

    return {
      name,
      price: roundProbability(price),
    };
  });

  const names = new Set(parsed.map((outcome) => getOutcomeKey(outcome.name)));
  if (names.size !== parsed.length) {
    throw new MarketSeedError("INVALID_MARKET_ODDS", "Outcome names must be unique.");
  }

  for (const expectedName of expectedNames) {
    if (!names.has(expectedName)) {
      throw new MarketSeedError(
        "INVALID_MARKET_ODDS",
        "Override outcomes must include every current market outcome.",
      );
    }
  }

  if (parsed.length !== expectedNames.size) {
    throw new MarketSeedError(
      "INVALID_MARKET_ODDS",
      "Override outcomes must not include extra outcomes.",
    );
  }

  const sum = parsed.reduce((total, outcome) => total + outcome.price, 0);
  if (Math.abs(sum - 1) > 0.000001) {
    throw new MarketSeedError(
      "INVALID_MARKET_ODDS",
      "Override outcome prices must sum to 1.",
    );
  }

  return sortOutcomesLikeExpected(parsed, expectedOutcomes);
}

function sortOutcomesLikeExpected(
  outcomes: PulseMarketPriceHistoryOutcome[],
  expectedOutcomes: Array<{ name: string }>,
) {
  const byName = new Map(outcomes.map((outcome) => [getOutcomeKey(outcome.name), outcome]));
  return expectedOutcomes.map((expected) => {
    const outcome = byName.get(getOutcomeKey(expected.name));
    if (!outcome) {
      throw new MarketSeedError(
        "INVALID_MARKET_ODDS",
        "Override outcomes must include every current market outcome.",
      );
    }
    return outcome;
  });
}

function parsePointCount(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return 260;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 12 || parsed > 720) {
    throw new MarketSeedError(
      "INVALID_MARKET_SEED_INPUT",
      "points must be an integer between 12 and 720.",
    );
  }

  return parsed;
}

function parseVolatility(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return 0.12;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0.35) {
    throw new MarketSeedError(
      "INVALID_MARKET_SEED_INPUT",
      "volatility must be a number from 0 to 0.35.",
    );
  }

  return parsed;
}

function buildBinarySeedPrices(rng: () => number) {
  let yes = 0.18 + rng() * 0.64;
  if (yes > 0.47 && yes < 0.53) {
    yes += yes >= 0.5 ? 0.08 : -0.08;
  }
  yes = roundProbability(clampProbability(yes));

  return normalizePrices([yes, 1 - yes]);
}

function buildMultiSeedPrices(count: number, rng: () => number) {
  if (count <= 0) {
    return [];
  }

  const leaderPrice = 0.6;
  const headProfile = [leaderPrice, 0.105, 0.075, 0.045, 0.035, 0.025, 0.019, 0.014, 0.011, 0.009];
  const headCount = Math.min(count, headProfile.length);
  const prices = Array.from({ length: count }, () => 0);

  for (let index = 0; index < headCount; index += 1) {
    const target = headProfile[index] ?? 0;
    if (index === 0) {
      prices[index] = target;
    } else {
      const jitter = 0.88 + rng() * 0.24;
      prices[index] = roundProbability(target * jitter);
    }
  }

  const headTotal = prices.reduce((total, price) => total + price, 0);
  const remaining = Math.max(0.000001, 1 - headTotal);
  const tailCount = count - headCount;

  if (tailCount > 0) {
    const tailWeights = Array.from({ length: tailCount }, (_, index) => {
      const rank = index + 1;
      const powerLaw = 1 / Math.pow(rank, 0.82);
      return powerLaw * (0.72 + rng() * 0.56);
    });
    const tailTotal = tailWeights.reduce((total, weight) => total + weight, 0);

    for (let index = 0; index < tailCount; index += 1) {
      prices[headCount + index] = roundProbability(
        remaining * ((tailWeights[index] ?? 0) / tailTotal),
      );
    }
  }

  return normalizePrices(prices);
}

function perturbPrices(
  basePrices: number[],
  input: {
    volatility: number;
    progress: number;
    phase: number;
    rng: () => number;
    drift?: number[];
  },
) {
  if (basePrices.length <= 2) {
    const wave = Math.sin(input.progress * Math.PI * 5.5 + input.phase) * input.volatility * 0.85;
    const secondaryWave =
      Math.sin(input.progress * Math.PI * 17 + input.phase * 0.7) * input.volatility * 0.22;
    const noise = (input.rng() - 0.5) * input.volatility * 1.05;
    const jump = input.rng() < 0.045 ? (input.rng() - 0.5) * input.volatility * 2.1 : 0;
    const yes = clampProbability((basePrices[0] ?? 0.5) + wave + secondaryWave + noise + jump);
    return normalizePrices([yes, 1 - yes]);
  }

  const weights = basePrices.map((price, index) => {
    const broadWave = Math.sin(input.progress * Math.PI * (2.6 + (index % 4)) + input.phase + index);
    const fastWave = Math.sin(input.progress * Math.PI * (9 + (index % 5)) + input.phase * 0.6 + index * 1.7);
    const microNoise = (input.rng() - 0.5) * input.volatility * 0.42;
    const localShock = input.rng() < 0.032 + (index < 5 ? 0.016 : 0)
      ? (input.rng() - 0.5) * input.volatility * 1.6
      : 0;
    const drift = index === 0 ? (input.drift?.[index] ?? 0) * 0.45 : input.drift?.[index] ?? 0;
    return Math.max(
      0.000001,
      price * Math.exp(
        broadWave * input.volatility * 0.95 +
          fastWave * input.volatility * 0.28 +
          drift +
          microNoise +
          localShock,
      ),
    );
  });

  return normalizePrices(applyMultiOutcomeLeaderTrend(weights, input));
}

function applyMultiOutcomeLeaderTrend(
  weights: number[],
  input: {
    volatility: number;
    progress: number;
    phase: number;
    drift?: number[];
  },
) {
  if (weights.length <= 2) {
    return weights;
  }

  const latestLeader = 0.6;
  const startLeader = 0.3;
  const smoothProgress = input.progress * input.progress * (3 - 2 * input.progress);
  const trendTarget = startLeader + (latestLeader - startLeader) * smoothProgress;
  const wiggle =
    Math.sin(input.progress * Math.PI * 7 + input.phase) * input.volatility * 0.14 +
    Math.sin(input.progress * Math.PI * 15 + input.phase * 0.4) * input.volatility * 0.055 +
    (input.drift?.[0] ?? 0) * 0.025;
  const taper = Math.sin(Math.PI * input.progress);
  const leaderTarget = clampProbabilityToRange(
    trendTarget + wiggle * taper,
    0.26,
    latestLeader - 0.005,
  );
  const otherTotal = weights.slice(1).reduce((total, value) => total + value, 0);

  if (otherTotal <= 0) {
    return weights;
  }

  return [
    (leaderTarget / (1 - leaderTarget)) * otherTotal,
    ...weights.slice(1),
  ];
}

function buildMultiOutcomeDrift(
  outcomeCount: number,
  pointCount: number,
  volatility: number,
  rng: () => number,
) {
  const maxDrift = Math.max(0.12, volatility * 2.75);
  const stepEvery = Math.max(2, Math.floor(pointCount / 54));

  return Array.from({ length: outcomeCount }, (_, outcomeIndex) => {
    const drift: number[] = [];
    let level = (rng() - 0.5) * volatility * 1.15;
    let target = level;

    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      if (pointIndex % stepEvery === 0) {
        target += (rng() - 0.5) * volatility * 1.35;
      }

      if (rng() < 0.038 + (outcomeIndex < 5 ? 0.02 : 0)) {
        target += (rng() - 0.5) * volatility * 3.7;
      }

      target = Math.max(-maxDrift, Math.min(maxDrift, target));
      level += (target - level) * 0.5 + (rng() - 0.5) * volatility * 0.08;
      level = Math.max(-maxDrift, Math.min(maxDrift, level));
      drift.push(level);
    }

    return drift;
  });
}

function buildSeedTimestamps(points: number, nowMs: number) {
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const yearStart = nowMs - 365 * dayMs;
  const monthStart = nowMs - 30 * dayMs;
  const weekStart = nowMs - 7 * dayMs;
  const dayStart = nowMs - dayMs;
  const sixHourStart = nowMs - 6 * hourMs;
  const hourStart = nowMs - hourMs;
  const anchors = [
    yearStart,
    monthStart,
    weekStart,
    dayStart,
    sixHourStart,
    hourStart,
    nowMs - 55 * minuteMs,
    nowMs - 30 * minuteMs,
    nowMs - 5 * minuteMs,
    nowMs,
  ];
  const pointCount = Math.max(points, anchors.length);
  const yearCount = Math.max(anchors.length, Math.floor(pointCount * 0.64));
  const monthCount = Math.max(6, Math.floor(pointCount * 0.16));
  const weekCount = Math.max(5, Math.floor(pointCount * 0.08));
  const dayCount = Math.max(4, Math.floor(pointCount * 0.05));
  const sixHourCount = Math.max(18, Math.floor(pointCount * 0.1));
  const hourCount = Math.max(
    18,
    pointCount + anchors.length - yearCount - monthCount - weekCount - dayCount - sixHourCount,
  );
  const timestamps = new Set(anchors.map((timestamp) => roundTimestamp(timestamp, minuteMs)));

  addEvenTimestamps(timestamps, yearStart, nowMs, yearCount, minuteMs);
  addEvenTimestamps(timestamps, monthStart, nowMs, monthCount, minuteMs);
  addEvenTimestamps(timestamps, weekStart, nowMs, weekCount, minuteMs);
  addEvenTimestamps(timestamps, dayStart, nowMs, dayCount, minuteMs);
  addEvenTimestamps(timestamps, sixHourStart, nowMs, sixHourCount, minuteMs);
  addEvenTimestamps(timestamps, hourStart, nowMs, hourCount, minuteMs);

  return [...timestamps].sort((left, right) => left - right);
}

function addEvenTimestamps(
  timestamps: Set<number>,
  startMs: number,
  endMs: number,
  count: number,
  roundToMs: number,
) {
  if (count <= 0) {
    return;
  }

  for (let index = 0; index < count; index += 1) {
    const progress = count === 1 ? 1 : index / (count - 1);
    timestamps.add(roundTimestamp(startMs + (endMs - startMs) * progress, roundToMs));
  }
}

function roundTimestamp(timestamp: number, roundToMs: number) {
  return Math.round(timestamp / roundToMs) * roundToMs;
}

function normalizePrices(values: number[]) {
  const safeValues = values.map((value) => Math.max(0, Number.isFinite(value) ? value : 0));
  const total = safeValues.reduce((sum, value) => sum + value, 0);
  const normalized =
    total > 0
      ? safeValues.map((value) => value / total)
      : safeValues.map(() => 1 / Math.max(1, safeValues.length));
  const rounded = normalized.map(roundProbability);
  const diff = roundProbability(1 - rounded.reduce((sum, value) => sum + value, 0));
  const largestIndex = rounded.reduce(
    (largest, value, index) => (value > (rounded[largest] ?? 0) ? index : largest),
    0,
  );
  rounded[largestIndex] = roundProbability((rounded[largestIndex] ?? 0) + diff);

  return rounded;
}

function createSeededRandom(seed: string) {
  let state = createHash("sha256").update(seed).digest().readUInt32BE(0);

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function getOutcomePrice(outcomes: PulseMarketPriceHistoryOutcome[], name: string) {
  return outcomes.find((outcome) => getOutcomeKey(outcome.name) === name)?.price ?? null;
}

function getOutcomeKey(name: string) {
  return name.trim().toLowerCase();
}

function clampProbability(value: number) {
  return Math.min(0.99, Math.max(0.01, value));
}

function clampProbabilityToRange(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundProbability(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
