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

const seriesColors = ["#87BFFF", "#2797FF", "#FDC503", "#FF7F0E", "#B984FF"];
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
    maxSeriesPoints,
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

  if (points.length === 1) {
    return `M${points[0].x} ${points[0].y}`;
  }

  const commands = [`M${points[0].x} ${points[0].y}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const following = points[index + 2] ?? next;
    const cp1x = clampControlX(
      current.x + (next.x - previous.x) / 6,
      current.x,
      next.x,
    );
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = clampControlX(
      next.x - (following.x - current.x) / 6,
      current.x,
      next.x,
    );
    const cp2y = next.y - (following.y - current.y) / 6;

    commands.push(
      `C${round(cp1x)} ${round(cp1y)},${round(cp2x)} ${round(cp2y)},${next.x} ${next.y}`,
    );
  }

  return commands.join(" ");
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

  const selectedKey = selectedOutcomeName?.trim().toLowerCase() ?? null;
  const sorted = [...outcomes]
    .sort((left, right) => toPrice(right) - toPrice(left))
  const visible = sorted.slice(0, 5);
  const selected =
    selectedKey && !visible.some((outcome) => outcome.name.trim().toLowerCase() === selectedKey)
      ? outcomes.find((outcome) => outcome.name.trim().toLowerCase() === selectedKey)
      : null;
  const targets = selected ? [...visible.slice(0, 4), selected] : visible;

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

function clampControlX(value: number, left: number, right: number) {
  return Math.max(Math.min(left, right), Math.min(Math.max(left, right), value));
}
