import { formatMarketText } from "./marketText";
import type { Outcome } from "./types";

export const chartRanges = ["1H", "6H", "1D", "1W", "1M", "ALL"] as const;

export type ChartRange = (typeof chartRanges)[number];

export type ChartHistoryOutcomePoint = {
  name: string;
  price: number | null | undefined;
};

export type ChartHistoryPoint = {
  timestamp: string;
  yes: number | null;
  no: number | null;
  volume: number;
  liquidity: number;
  synthetic?: boolean;
  outcomes?: ChartHistoryOutcomePoint[] | Record<string, number | null | undefined>;
};

export type ChartPoint = {
  timestamp: string;
  timestampMs: number;
  value: number;
  x: number;
  y: number;
};

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  points: ChartPoint[];
  latest: number | null;
  path: string;
};

export type ChartYAxisScale = {
  min: number;
  max: number;
  ticks: number[];
};

const rangeMs: Record<Exclude<ChartRange, "ALL">, number> = {
  "1H": 60 * 60 * 1000,
  "6H": 6 * 60 * 60 * 1000,
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
};

const fallbackRangeMs: Record<ChartRange, number> = {
  ...rangeMs,
  ALL: 315 * 24 * 60 * 60 * 1000,
};

const maxMultiOutcomeSeries = 4;
const seriesColors = ["#87BFFF", "#2797FF", "#FDC503", "#FF7F0E"];
const maxSeriesPoints = 180;
const yAxisPaddingRatio = 0.1;
const minYAxisSpan = 0.04;
const maxSeriesPointsByRange: Record<ChartRange, number> = {
  "1H": 90,
  "6H": 90,
  "1D": 100,
  "1W": 100,
  "1M": 90,
  ALL: 180,
};

export function filterPriceHistoryByRange(
  history: ChartHistoryPoint[],
  range: ChartRange,
  nowMs = Date.now(),
) {
  const ordered = history
    .map((point) => ({ point, timestampMs: Date.parse(point.timestamp) }))
    .filter(({ timestampMs }) => Number.isFinite(timestampMs))
    .sort((left, right) => left.timestampMs - right.timestampMs);

  if (range === "ALL") {
    return ordered.map(({ point }) => point);
  }

  const minimumTimestamp = nowMs - rangeMs[range];
  return ordered
    .filter(({ timestampMs }) => timestampMs >= minimumTimestamp)
    .map(({ point }) => point);
}

export function buildChartSeries({
  priceHistory,
  outcomes,
  range,
  nowMs = Date.now(),
  width = 900,
  height = 190,
  paddingX = 18,
  paddingY = 18,
  yMin = 0,
  yMax = 1,
  selectedOutcomeName,
}: {
  priceHistory: ChartHistoryPoint[];
  outcomes: Outcome[];
  range: ChartRange;
  nowMs?: number;
  width?: number;
  height?: number;
  paddingX?: number;
  paddingY?: number;
  yMin?: number;
  yMax?: number;
  selectedOutcomeName?: string | null;
}): ChartSeries[] {
  const visibleHistory = downsampleHistory(
    filterPriceHistoryByRange(priceHistory, range, nowMs),
    maxSeriesPointsByRange[range],
  );
  const targets = getSeriesTargets(outcomes, selectedOutcomeName);
  const timestamps = visibleHistory
    .map((point) => Date.parse(point.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp));
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const plotWidth = Math.max(1, width - paddingX * 2);
  const plotHeight = Math.max(1, height - paddingY * 2);
  const ySpan = Math.max(0.0001, yMax - yMin);

  return targets
    .map((target, index) => {
      const points = visibleHistory
        .map((historyPoint) => {
          const timestampMs = Date.parse(historyPoint.timestamp);
          const value = getTargetPrice(historyPoint, target);

          if (!Number.isFinite(timestampMs) || value === null) {
            return null;
          }

          const x =
            minTimestamp === maxTimestamp
              ? paddingX + plotWidth
              : paddingX + ((timestampMs - minTimestamp) / (maxTimestamp - minTimestamp)) * plotWidth;
          const y = paddingY + (1 - (value - yMin) / ySpan) * plotHeight;

          return {
            timestamp: historyPoint.timestamp,
            timestampMs,
            value,
            x: round(x),
            y: round(y),
          };
        })
        .filter((point): point is ChartPoint => point !== null);

      return {
        key: target.key,
        label: target.label,
        color: seriesColors[index % seriesColors.length],
        points,
        latest: points.at(-1)?.value ?? null,
        path: pointsToSvgPath(points),
      };
    })
    .filter((series) => series.points.length > 0);
}

export function buildChartYAxisScale(series: ChartSeries[], tickCount = 6): ChartYAxisScale {
  const values = series
    .flatMap((item) => item.points.map((point) => point.value))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return { min: 0, max: 1, ticks: buildProbabilityTicks(0, 1, tickCount) };
  }

  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  const initialSpan = maxValue - minValue;

  if (initialSpan < minYAxisSpan) {
    const center = (minValue + maxValue) / 2;
    minValue = center - minYAxisSpan / 2;
    maxValue = center + minYAxisSpan / 2;
  }

  const span = Math.max(minYAxisSpan, maxValue - minValue);
  const padding = Math.max(0.005, span * yAxisPaddingRatio);
  let min = Math.max(0, minValue - padding);
  let max = Math.min(1, maxValue + padding);

  if (max - min < minYAxisSpan) {
    const center = (min + max) / 2;
    min = Math.max(0, center - minYAxisSpan / 2);
    max = Math.min(1, center + minYAxisSpan / 2);
  }

  const ticks = buildProbabilityTicks(min, max, tickCount);

  return {
    min: ticks[0] ?? min,
    max: ticks.at(-1) ?? max,
    ticks,
  };
}

export function buildCurrentPriceHistory(
  outcomes: Outcome[],
  range: ChartRange,
  nowMs = Date.now(),
): ChartHistoryPoint[] {
  const pricedOutcomes = outcomes
    .map((outcome) => ({
      name: outcome.name,
      price: clampProbability(outcome.price ?? outcome.probability),
    }))
    .filter((outcome): outcome is { name: string; price: number } => outcome.price !== null);

  if (pricedOutcomes.length === 0) {
    return [];
  }

  const yes = pricedOutcomes.find((outcome) => outcome.name.trim().toLowerCase() === "yes")?.price
    ?? (outcomes.length <= 2 ? pricedOutcomes[0]?.price ?? null : null);
  const no = pricedOutcomes.find((outcome) => outcome.name.trim().toLowerCase() === "no")?.price
    ?? (yes !== null && outcomes.length <= 2 ? 1 - yes : null);
  const pointCount = range === "ALL" ? 12 : 8;
  const spanMs = fallbackRangeMs[range];
  const startMs = nowMs - spanMs * 0.98;

  return Array.from({ length: pointCount }, (_, index) => {
    const progress = index / (pointCount - 1);
    return {
      timestamp: new Date(startMs + spanMs * 0.98 * progress).toISOString(),
      yes,
      no,
      volume: 0,
      liquidity: 0,
      synthetic: true,
      outcomes: pricedOutcomes,
    };
  });
}

export function downsampleHistory<T>(history: T[], maxPoints = maxSeriesPoints): T[] {
  if (history.length <= maxPoints || maxPoints < 3) {
    return history;
  }

  const timestamped = history.map((point, index) => ({
    index,
    point,
    timestampMs: getPointTimestampMs(point),
  }));
  const canSampleByTime = timestamped.every(
    (item, index) =>
      Number.isFinite(item.timestampMs) &&
      (index === 0 || item.timestampMs >= (timestamped[index - 1]?.timestampMs ?? item.timestampMs)),
  );

  if (!canSampleByTime) {
    return downsampleHistoryByIndex(history, maxPoints);
  }

  const first = timestamped[0];
  const last = timestamped[timestamped.length - 1];
  const minTimestamp = first?.timestampMs ?? 0;
  const maxTimestamp = last?.timestampMs ?? minTimestamp;

  if (!first || !last || maxTimestamp <= minTimestamp) {
    return downsampleHistoryByIndex(history, maxPoints);
  }

  const innerLimit = maxPoints - 2;
  const bucketSpan = (maxTimestamp - minTimestamp) / innerLimit;
  const buckets = new Map<number, (typeof timestamped)[number]>();

  for (const item of timestamped.slice(1, -1)) {
    const bucket = Math.min(
      innerLimit - 1,
      Math.max(0, Math.floor((item.timestampMs - minTimestamp) / bucketSpan)),
    );
    const bucketCenter = minTimestamp + (bucket + 0.5) * bucketSpan;
    const current = buckets.get(bucket);

    if (
      !current ||
      Math.abs(item.timestampMs - bucketCenter) < Math.abs(current.timestampMs - bucketCenter)
    ) {
      buckets.set(bucket, item);
    }
  }

  return [first, ...[...buckets.values()].sort((left, right) => left.index - right.index), last]
    .map((item) => item.point);
}

function downsampleHistoryByIndex<T>(history: T[], maxPoints: number): T[] {
  const first = history[0];
  const last = history[history.length - 1];
  const innerLimit = maxPoints - 2;
  const bucketSize = (history.length - 2) / innerLimit;
  const sampled: T[] = first === undefined ? [] : [first];

  for (let bucket = 0; bucket < innerLimit; bucket += 1) {
    const index = Math.min(
      history.length - 2,
      1 + Math.floor(bucket * bucketSize + bucketSize / 2),
    );
    const point = history[index];

    if (point !== undefined && point !== sampled.at(-1)) {
      sampled.push(point);
    }
  }

  if (last !== undefined && last !== sampled.at(-1)) {
    sampled.push(last);
  }

  return sampled;
}

function getPointTimestampMs(point: unknown) {
  if (!point || typeof point !== "object" || !("timestamp" in point)) {
    return Number.NaN;
  }

  return Date.parse(String(point.timestamp));
}

function buildProbabilityTicks(min: number, max: number, count: number) {
  const safeCount = Math.max(2, count);
  const boundedMin = Math.max(0, Math.min(1, min));
  const boundedMax = Math.max(boundedMin, Math.min(1, max));
  let start = Math.max(0, Math.floor(boundedMin * 100) / 100);
  let end = Math.min(1, Math.ceil(boundedMax * 100) / 100);

  if (end - start < minYAxisSpan) {
    const center = (start + end) / 2;
    start = Math.max(0, center - minYAxisSpan / 2);
    end = Math.min(1, center + minYAxisSpan / 2);
  }

  const step = (end - start) / (safeCount - 1);
  return Array.from({ length: safeCount }, (_, index) => roundAxisValue(start + step * index));
}

export function pointsToSvgPath(points: ChartPoint[]) {
  if (points.length === 0) {
    return "";
  }

  const [first, ...rest] = points;
  return [
    `M${first.x} ${first.y}`,
    ...rest.map((point) => `L${point.x} ${point.y}`),
  ].join(" ");
}

function getSeriesTargets(outcomes: Outcome[], selectedOutcomeName?: string | null) {
  const yes = outcomes.find((outcome) => outcome.name.trim().toLowerCase() === "yes");
  const no = outcomes.find((outcome) => outcome.name.trim().toLowerCase() === "no");

  if (yes && no && outcomes.length <= 2) {
    return [
      { key: "yes", label: "Yes" },
      { key: "no", label: "No" },
    ];
  }

  const sorted = [...outcomes]
    .sort((left, right) => toPrice(right) - toPrice(left));
  const targets = sorted.slice(0, maxMultiOutcomeSeries);

  return targets.map((outcome) => ({
    key: `outcome:${outcome.name.trim().toLowerCase()}`,
    label: formatMarketText(outcome.name),
    outcomeName: outcome.name,
  }));
}

function getTargetPrice(
  historyPoint: ChartHistoryPoint,
  target: ReturnType<typeof getSeriesTargets>[number],
) {
  if (target.key === "yes") {
    return clampProbability(historyPoint.yes);
  }

  if (target.key === "no") {
    return clampProbability(historyPoint.no);
  }

  const name = ("outcomeName" in target ? target.outcomeName : target.label).trim().toLowerCase();
  const outcomePrice = getOutcomePointPrice(historyPoint.outcomes, name);
  return clampProbability(outcomePrice);
}

function getOutcomePointPrice(
  outcomes: ChartHistoryPoint["outcomes"],
  name: string,
): number | null {
  if (!outcomes) {
    return null;
  }

  if (Array.isArray(outcomes)) {
    const match = outcomes.find((outcome) => outcome.name.trim().toLowerCase() === name);
    return toNullableNumber(match?.price);
  }

  return toNullableNumber(outcomes[name]);
}

function toPrice(outcome: Outcome) {
  return outcome.price ?? outcome.probability ?? 0;
}

function clampProbability(value: number | null | undefined) {
  const numeric = toNullableNumber(value);

  if (numeric === null) {
    return null;
  }

  return Math.max(0, Math.min(1, numeric));
}

function toNullableNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function roundAxisValue(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
