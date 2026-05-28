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
  points = 96,
  volatility = 0.06,
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
  const rng = createSeededRandom(`pulse-market:${scope.scopeType}:${scope.scopeId}:v1`);
  const basePrices = normalizedOutcomes.length <= 2
    ? buildBinarySeedPrices(rng)
    : buildMultiSeedPrices(normalizedOutcomes.length, rng);
  const timestamps = buildSeedTimestamps(points, nowMs);
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
        deterministicVersion: 1,
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
    return 96;
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
    return 0.06;
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
  const weights = Array.from({ length: count }, (_, index) => {
    const rankBoost = Math.max(0.35, 1.35 - index / Math.max(1, count));
    return Math.max(0.000001, Math.pow(rng(), 1.7) * rankBoost + rng() * 0.12);
  });

  return normalizePrices(weights);
}

function perturbPrices(
  basePrices: number[],
  input: {
    volatility: number;
    progress: number;
    phase: number;
    rng: () => number;
  },
) {
  if (basePrices.length <= 2) {
    const wave = Math.sin(input.progress * Math.PI * 4 + input.phase) * input.volatility * 0.55;
    const noise = (input.rng() - 0.5) * input.volatility;
    const yes = clampProbability((basePrices[0] ?? 0.5) + wave + noise);
    return normalizePrices([yes, 1 - yes]);
  }

  const weights = basePrices.map((price, index) => {
    const wave = Math.sin(input.progress * Math.PI * (2 + (index % 3)) + input.phase + index);
    const noise = (input.rng() - 0.5) * input.volatility * 3;
    return Math.max(0.000001, price * Math.exp(wave * input.volatility + noise));
  });

  return normalizePrices(weights);
}

function buildSeedTimestamps(points: number, nowMs: number) {
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const anchors = [
    nowMs - 365 * dayMs,
    nowMs - 30 * dayMs,
    nowMs - 7 * dayMs,
    nowMs - dayMs,
    nowMs - 6 * hourMs,
    nowMs - hourMs,
    nowMs - 55 * minuteMs,
    nowMs - 30 * minuteMs,
    nowMs - 5 * minuteMs,
    nowMs,
  ];
  const start = nowMs - 30 * dayMs;
  const pointCount = Math.max(points, anchors.length);
  const evenPoints = Array.from({ length: Math.max(0, pointCount - 1) }, (_, index) => {
    const progress = index / Math.max(1, pointCount - 2);
    return start + (nowMs - start) * progress;
  });
  const timestamps = new Set(
    [...anchors, ...evenPoints, nowMs].map((timestamp) =>
      Math.round(timestamp / minuteMs) * minuteMs,
    ),
  );

  return [...timestamps].sort((left, right) => left - right);
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

function roundProbability(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
