import * as React from "react";
import {
  Clock3,
  Info,
  ListFilter,
  Search,
  Settings,
  Trophy,
} from "lucide-react";
import {
  buildChartSeries,
  buildCurrentPriceHistory,
  chartRanges,
  type ChartRange,
  type ChartSeries,
} from "../lib/marketChart";
import { formatMarketText } from "../lib/marketText";
import type { Market, Outcome } from "../lib/types";

const chartWidth = 922;
const chartHeight = 240;
const plotTop = 10;
const plotBottom = 200;
const plotRight = 872;
const gridRight = 884;
const chartRenderHeight = plotBottom + plotTop;
const yTickCount = 6;

const rangeLabels: Record<ChartRange, string> = {
  "1H": "1H",
  "6H": "6H",
  "1D": "1D",
  "1W": "1W",
  "1M": "1M",
  ALL: "ALL",
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const monthLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type YAxisScale = {
  min: number;
  max: number;
  ticks: number[];
};

type TimeTick = {
  x: number;
  label: string;
};

export function MarketChart({
  outcomes,
  history,
  selectedOutcomeName,
}: {
  outcomes: Outcome[];
  history?: Market["history"];
  selectedOutcomeName?: string | null;
}) {
  const [selectedRange, setSelectedRange] = React.useState<ChartRange>("ALL");
  const [focusedOutcomeName, setFocusedOutcomeName] = React.useState<string | null>(
    selectedOutcomeName ?? null,
  );
  const [outcomeQuery, setOutcomeQuery] = React.useState("");
  const [hover, setHover] = React.useState<{
    x: number;
    y: number;
    timestamp: string;
    values: Array<{ label: string; color: string; value: number }>;
  } | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const rawPriceHistory = history?.price_history;
  const hasRawPriceHistory = (rawPriceHistory?.length ?? 0) > 0;
  const priceHistory = React.useMemo(
    () =>
      hasRawPriceHistory
        ? rawPriceHistory ?? []
        : buildCurrentPriceHistory(outcomes, selectedRange),
    [hasRawPriceHistory, outcomes, rawPriceHistory, selectedRange],
  );

  React.useEffect(() => {
    if (selectedOutcomeName) {
      setFocusedOutcomeName(selectedOutcomeName);
    }
  }, [selectedOutcomeName]);

  const baseSeries = React.useMemo(
    () =>
      buildChartSeries({
        priceHistory,
        outcomes,
        range: selectedRange,
        selectedOutcomeName: focusedOutcomeName,
      }),
    [focusedOutcomeName, outcomes, priceHistory, selectedRange],
  );
  const yAxis = React.useMemo(() => buildYAxisScale(baseSeries), [baseSeries]);
  const series = React.useMemo(
    () =>
      buildChartSeries({
        priceHistory,
        outcomes,
        range: selectedRange,
        selectedOutcomeName: focusedOutcomeName,
        width: plotRight,
        height: chartRenderHeight,
        paddingX: 0,
        paddingY: plotTop,
        yMin: yAxis.min,
        yMax: yAxis.max,
      }),
    [focusedOutcomeName, outcomes, priceHistory, selectedRange, yAxis.max, yAxis.min],
  );
  const hasVisibleSeries = series.some((item) => item.points.length > 0);
  const shouldRenderChart = hasVisibleSeries;
  const firstPoint = getFirstPoint(series);
  const lastPoint = getLastPoint(series);
  const latestVolume = getLatestVolume(rawPriceHistory ?? []);
  const chartMode = outcomes.length > 2 ? "Multi-outcome" : "Binary market";
  const xTicks = React.useMemo(
    () => buildTimeTicks(series, selectedRange),
    [selectedRange, series],
  );
  const searchableOutcomes = React.useMemo(
    () =>
      outcomes
        .filter((outcome) =>
          `${outcome.name} ${formatMarketText(outcome.name)}`
            .toLowerCase()
            .includes(outcomeQuery.trim().toLowerCase()),
        )
        .slice(0, 8),
    [outcomeQuery, outcomes],
  );

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!shouldRenderChart || series.length === 0 || !svgRef.current) {
      return;
    }

    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * chartWidth;
    const nearestValues = series.flatMap((item) => {
      const point = getNearestPoint(item, svgX);
      return point
        ? [
            {
              label: item.label,
              color: item.color,
              value: point.value,
              point,
            },
          ]
        : [];
    });
    const primary = [...nearestValues].sort(
      (left, right) => Math.abs(left.point.x - svgX) - Math.abs(right.point.x - svgX),
    )[0];

    if (!primary) {
      return;
    }

    setHover({
      x: primary.point.x,
      y: primary.point.y,
      timestamp: primary.point.timestamp,
      values: nearestValues
        .filter((item) => Math.abs(item.point.timestampMs - primary.point.timestampMs) < 60_000)
        .map(({ label, color, value }) => ({ label, color, value })),
    });
  }

  return (
    <div className="relative mt-6 overflow-visible bg-[#15191d] pb-4 pt-1 text-[#dee3e7]">
      <div className="flex min-h-8 items-start gap-5 px-0">
        {hasVisibleSeries ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2">
            {series.map((item) => (
              <span
                className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-[#8794a1] sm:text-[15px]"
                key={item.key}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="min-w-0 truncate">{item.label}</span>
                <strong className="shrink-0 text-[#c8d0d8]">{formatChartPercent(item.latest)}</strong>
              </span>
            ))}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-[#8794a1]">
            <Info size={15} />
            <span>Market history will appear here when price points are available.</span>
          </div>
        )}
        <PulseMarketWatermark />
      </div>

      {outcomes.length > 5 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[220px_minmax(0,1fr)]">
          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8794a1]"
              size={15}
            />
            <input
              className="h-9 w-full rounded-md border border-[#242b32] bg-[#181d21] pl-9 pr-3 text-sm font-semibold text-[#dee3e7] outline-none placeholder:text-[#586879]"
              onChange={(event) => setOutcomeQuery(event.target.value)}
              placeholder="Search outcomes"
              value={outcomeQuery}
            />
          </label>
          <div className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {searchableOutcomes.map((outcome) => {
              const active = focusedOutcomeName === outcome.name;
              return (
                <button
                  className={`h-9 shrink-0 rounded-md px-3 text-xs font-bold transition ${
                    active
                      ? "bg-[#2797ff] text-white"
                      : "bg-[#181d21] text-[#8794a1] hover:text-[#dee3e7]"
                  }`}
                  key={outcome.name}
                  onClick={() => setFocusedOutcomeName(outcome.name)}
                  type="button"
                >
                  {formatMarketText(outcome.name)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="relative mt-7 overflow-visible">
        <svg
          className="h-[260px] w-full touch-none overflow-visible"
          ref={svgRef}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`${chartMode} price history chart`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHover(null)}
        >
          <rect fill="#15191d" height={chartHeight} width={chartWidth} x="0" y="0" />
          {yAxis.ticks.map((tick) => {
            const y = valueToY(tick, yAxis);
            return (
              <g key={tick}>
                <line
                  x1="0"
                  x2={gridRight}
                  y1={y}
                  y2={y}
                  stroke="#3b4854"
                  strokeDasharray="1 6"
                  strokeLinecap="round"
                  strokeOpacity="0.72"
                />
                <text
                  className="fill-[#8d99a6] text-[12px] font-medium"
                  x="895"
                  y={y + 4}
                >
                  {formatAxisPercent(tick)}
                </text>
              </g>
            );
          })}
          {xTicks.map((tick) => (
            <text
              className="fill-[#34414d] text-[13px] font-semibold"
              key={`${tick.label}-${tick.x}`}
              textAnchor="middle"
              x={tick.x}
              y={plotBottom + 32}
            >
              {tick.label}
            </text>
          ))}
          {shouldRenderChart
            ? series.map((item) => {
                const latest = item.points.at(-1);
                return (
                  <g key={item.key}>
                    <path
                      d={item.path}
                      fill="none"
                      stroke="#15191d"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="5"
                    />
                    <path
                      d={item.path}
                      fill="none"
                      stroke={item.color}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.35"
                    />
                    {latest ? (
                      <g className="pointer-events-none">
                        <circle cx={latest.x} cy={latest.y} fill={item.color} opacity="0.26" r="8.5" />
                        <circle cx={latest.x} cy={latest.y} fill={item.color} r="4.5" />
                      </g>
                    ) : null}
                  </g>
                );
              })
            : null}
          {hover ? (
            <g>
              <line
                x1={hover.x}
                x2={hover.x}
                y1={plotTop}
                y2={plotBottom}
                stroke="#586879"
                strokeDasharray="3 5"
                strokeOpacity="0.75"
              />
              <circle cx={hover.x} cy={hover.y} fill="#dee3e7" r="4" />
            </g>
          ) : null}
        </svg>

        {hover ? (
          <div
            className="pointer-events-none absolute top-8 z-10 min-w-[190px] rounded-md border border-[#2e3841] bg-[#181d21]/95 p-3 shadow-xl"
            style={{
              left: `${Math.min(72, Math.max(0, (hover.x / chartWidth) * 100))}%`,
              transform: hover.x > chartWidth * 0.72 ? "translateX(-100%)" : undefined,
            }}
          >
            <strong className="block text-xs font-bold text-[#dee3e7]">
              {formatEnglishDate(hover.timestamp)}
            </strong>
            <div className="mt-2 grid gap-1.5">
              {hover.values.map((item) => (
                <span
                  className="flex items-center justify-between gap-3 text-xs font-semibold text-[#8794a1]"
                  key={item.label}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <strong className="text-[#dee3e7]">{formatChartPercent(item.value)}</strong>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {!hasVisibleSeries ? (
          <ChartState
            icon={<Info size={18} />}
            title="Prices unavailable"
            detail="The chart will appear as soon as the market publishes odds."
          />
        ) : null}
      </div>

      <div className="mt-6 flex flex-col gap-4 border-t border-[#242b32] pt-4 text-[15px] font-semibold text-[#9aa6b2] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-[#dee3e7]">
            <Trophy size={18} />
            {latestVolume === null ? "--" : formatFullMoney(latestVolume)} Volume
          </span>
          <span className="h-3.5 w-px rounded-full bg-[#2e3841]" />
          <span className="flex items-center gap-2">
            <Clock3 size={18} />
            {lastPoint ? formatEnglishDate(lastPoint.timestamp) : "Date unknown"}
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-end">
          <div className="flex items-center gap-3">
            {chartRanges.map((range) => (
              <button
                className={`h-8 whitespace-nowrap text-[15px] font-bold uppercase tracking-normal transition ${
                  selectedRange === range
                    ? "text-[#dee3e7]"
                    : "text-[#7b8996] hover:text-[#c8d0d8]"
                }`}
                key={range}
                onClick={() => setSelectedRange(range)}
                type="button"
              >
                {rangeLabels[range]}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[#7b8996]">
            <button
              aria-label="Sort chart outcomes"
              className="transition hover:text-[#dee3e7]"
              type="button"
            >
              <ListFilter size={19} />
            </button>
            <button
              aria-label="Chart settings"
              className="transition hover:text-[#dee3e7]"
              type="button"
            >
              <Settings size={19} />
            </button>
          </div>
        </div>
      </div>

      <span className="sr-only">
        {firstPoint ? `Chart starts at ${firstPoint.timestamp}` : "Chart start unavailable"}
      </span>
    </div>
  );
}

function ChartState({
  icon,
  title,
  detail,
}: {
  icon?: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="absolute inset-x-4 top-1/2 mx-auto max-w-xl -translate-y-1/2 rounded-md border border-[#2e3841] bg-[#181d21]/95 p-5 text-center shadow-xl">
      <strong className="flex items-center justify-center gap-2 text-base font-semibold text-[#dee3e7]">
        {icon}
        {title}
      </strong>
      <span className="mt-2 block text-sm font-medium text-[#8794a1]">{detail}</span>
    </div>
  );
}

function PulseMarketWatermark() {
  return (
    <div
      aria-hidden="true"
      className="ml-auto hidden shrink-0 items-center gap-3 text-[#2a333d] lg:flex"
    >
      <svg className="h-7 w-7" fill="none" viewBox="0 0 36 36">
        <path
          d="M27.5 3.5v29L6.5 26.6V9.4L27.5 3.5Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2.8"
        />
        <path
          d="M9 18 26.5 11v14L9 18Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2.8"
        />
      </svg>
      <span className="text-[24px] font-bold leading-none tracking-normal">PulseMarket</span>
    </div>
  );
}

function buildYAxisScale(series: ChartSeries[]): YAxisScale {
  const values = series
    .flatMap((item) => item.points.map((point) => point.value))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const rawSpan = Math.max(0.04, maxValue - minValue);
  const padding = Math.max(0.02, rawSpan * 0.18);
  let min = Math.max(0, Math.floor((minValue - padding) * 20) / 20);
  let max = Math.min(1, Math.ceil((maxValue + padding) * 20) / 20);

  if (min === 0 && minValue >= 0.045 && max <= 0.3) {
    min = 0.05;
  }

  if (max - min < 0.08) {
    const center = (max + min) / 2;
    min = Math.max(0, center - 0.04);
    max = Math.min(1, center + 0.04);
  }

  const ticks = buildLinearTicks(min, max, yTickCount);
  return {
    min: ticks[0] ?? min,
    max: ticks.at(-1) ?? max,
    ticks,
  };
}

function buildLinearTicks(min: number, max: number, count: number) {
  const rawStep = Math.max(0.01, (max - min) / Math.max(1, count - 1));
  const step = Math.max(0.01, Math.ceil(rawStep * 100) / 100);
  let start = min;
  let end = start + step * (count - 1);

  if (end < max) {
    end = Math.min(1, max);
    start = Math.max(0, end - step * (count - 1));
  }

  return Array.from({ length: count }, (_, index) => round(start + step * index)).filter(
    (tick, index, ticks) => index === 0 || tick !== ticks[index - 1],
  );
}

function valueToY(value: number, yAxis: YAxisScale) {
  const span = Math.max(0.0001, yAxis.max - yAxis.min);
  return plotTop + (1 - (value - yAxis.min) / span) * (plotBottom - plotTop);
}

function buildTimeTicks(series: ChartSeries[], range: ChartRange): TimeTick[] {
  const points = series.flatMap((item) => item.points);

  if (points.length < 2) {
    return [];
  }

  const minTimestamp = Math.min(...points.map((point) => point.timestampMs));
  const maxTimestamp = Math.max(...points.map((point) => point.timestampMs));
  const duration = maxTimestamp - minTimestamp;

  if (!Number.isFinite(duration) || duration <= 0) {
    return [];
  }

  if (range === "ALL" || duration > 75 * 24 * 60 * 60 * 1000) {
    return buildMonthTicks(minTimestamp, maxTimestamp);
  }

  const count = range === "1H" || range === "6H" ? 4 : 5;
  return Array.from({ length: count }, (_, index) => {
    const timestamp = minTimestamp + (duration / (count - 1)) * index;
    return {
      x: timestampToX(timestamp, minTimestamp, maxTimestamp),
      label: duration <= 2 * 24 * 60 * 60 * 1000 ? formatHourTick(timestamp) : formatDayTick(timestamp),
    };
  });
}

function buildMonthTicks(minTimestamp: number, maxTimestamp: number) {
  const ticks: TimeTick[] = [];
  const cursor = new Date(minTimestamp);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);

  if (cursor.getTime() <= minTimestamp) {
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  while (cursor.getTime() < maxTimestamp) {
    const timestamp = cursor.getTime();
    ticks.push({
      x: timestampToX(timestamp, minTimestamp, maxTimestamp),
      label: monthLabels[cursor.getUTCMonth()] ?? "",
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  if (ticks.length <= 9) {
    return ticks;
  }

  const step = Math.ceil(ticks.length / 9);
  return ticks.filter((_, index) => index % step === 0);
}

function timestampToX(timestamp: number, minTimestamp: number, maxTimestamp: number) {
  return round(((timestamp - minTimestamp) / (maxTimestamp - minTimestamp)) * plotRight);
}

function getLatestVolume(priceHistory: NonNullable<Market["history"]>["price_history"]) {
  const latestPoint = [...priceHistory]
    .filter((point) => Number.isFinite(Date.parse(point.timestamp)))
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];

  return typeof latestPoint?.volume === "number" && Number.isFinite(latestPoint.volume)
    ? latestPoint.volume
    : null;
}

function getFirstPoint(series: ChartSeries[]) {
  return series
    .flatMap((item) => item.points)
    .sort((left, right) => left.timestampMs - right.timestampMs)[0];
}

function getLastPoint(series: ChartSeries[]) {
  return series
    .flatMap((item) => item.points)
    .sort((left, right) => right.timestampMs - left.timestampMs)[0];
}

function getNearestPoint(series: ChartSeries, x: number) {
  return series.points.reduce<ChartSeries["points"][number] | null>((nearest, point) => {
    if (!nearest) {
      return point;
    }

    return Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest;
  }, null);
}

function formatFullMoney(value: number) {
  return `$${moneyFormatter.format(value)}`;
}

function formatChartPercent(value: number | null) {
  if (value === null) {
    return "--";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatAxisPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatEnglishDate(value: string | number) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatHourTick(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDayTick(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
