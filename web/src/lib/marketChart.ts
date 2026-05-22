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

const rangeMs: Record<Exclude<ChartRange, "ALL">, number> = {
  "1H": 60 * 60 * 1000,
  "6H": 6 * 60 * 60 * 1000,
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
};

const seriesColors = ["#b8e1fe", "#0093fd", "#f7d022", "#fe6e00", "#ac4bff"];
const maxSeriesPoints = 180;

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
}: {
  priceHistory: ChartHistoryPoint[];
  outcomes: Outcome[];
  range: ChartRange;
  nowMs?: number;
  width?: number;
  height?: number;
  paddingX?: number;
  paddingY?: number;
}): ChartSeries[] {
  const visibleHistory = downsampleHistory(
    filterPriceHistoryByRange(priceHistory, range, nowMs),
    maxSeriesPoints,
  );
  const targets = getSeriesTargets(outcomes);
  const timestamps = visibleHistory
    .map((point) => Date.parse(point.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp));
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const plotWidth = Math.max(1, width - paddingX * 2);
  const plotHeight = Math.max(1, height - paddingY * 2);

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
          const y = paddingY + (1 - value) * plotHeight;

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

export function downsampleHistory<T>(history: T[], maxPoints = maxSeriesPoints): T[] {
  if (history.length <= maxPoints || maxPoints < 3) {
    return history;
  }

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

export function pointsToSvgPath(points: ChartPoint[]) {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
}

function getSeriesTargets(outcomes: Outcome[]) {
  const yes = outcomes.find((outcome) => outcome.name.trim().toLowerCase() === "yes");
  const no = outcomes.find((outcome) => outcome.name.trim().toLowerCase() === "no");

  if (yes && no && outcomes.length <= 2) {
    return [
      { key: "yes", label: "Yes" },
      { key: "no", label: "No" },
    ];
  }

  return [...outcomes]
    .sort((left, right) => toPrice(right) - toPrice(left))
    .slice(0, 3)
    .map((outcome) => ({
      key: `outcome:${outcome.name.trim().toLowerCase()}`,
      label: outcome.name,
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

  const name = target.label.trim().toLowerCase();
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
