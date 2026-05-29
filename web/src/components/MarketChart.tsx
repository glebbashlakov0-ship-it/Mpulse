import * as React from "react";
import { Clock3, ListFilter, Settings, Trophy } from "lucide-react";
import {
  buildChartYAxisScale,
  buildChartSeries,
  buildCurrentPriceHistory,
  chartRanges,
  type ChartRange,
  type ChartSeries,
  type ChartYAxisScale,
} from "../lib/marketChart";
import type { Market, Outcome } from "../lib/types";

const chartWidth = 922;
const chartHeight = 240;
const plotTop = 10;
const plotBottom = 200;
const plotRight = 872;
const gridRight = 884;
const chartRenderHeight = plotBottom + plotTop;
const yTickCount = 5;
const hoverLabelHeight = 21;
const hoverLabelGap = 1;

const rangeLabels: Record<ChartRange, string> = {
  "1H": "1ч",
  "6H": "6ч",
  "1D": "1д",
  "1W": "1н",
  "1M": "1м",
  ALL: "Все",
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const monthLabels = [
  "янв.",
  "фев.",
  "мар.",
  "апр.",
  "мая",
  "июн.",
  "июл.",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];

type TimeTick = {
  x: number;
  label: string;
};

type HoverValue = {
  key: string;
  label: string;
  color: string;
  value: number;
  point: ChartSeries["points"][number];
};

type ChartHover = {
  anchorX: number;
  cursorX: number;
  timestamp: string;
  values: HoverValue[];
};

type HoverLabel = HoverValue & {
  labelX: number;
  labelY: number;
  rectWidth: number;
};

export function MarketChart({
  endsAt,
  outcomes,
  history,
  selectedOutcomeName,
}: {
  endsAt?: string | null;
  outcomes: Outcome[];
  history?: Market["history"];
  selectedOutcomeName?: string | null;
}) {
  const [selectedRange, setSelectedRange] = React.useState<ChartRange>("ALL");
  const [hover, setHover] = React.useState<ChartHover | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const focusedOutcomeName = selectedOutcomeName ?? null;
  const chartClipId = React.useId().replace(/:/g, "");
  const rawPriceHistory = history?.price_history;
  const hasRawPriceHistory = (rawPriceHistory?.length ?? 0) > 0;
  const fallbackPriceHistory = React.useMemo(
    () => buildCurrentPriceHistory(outcomes, selectedRange),
    [outcomes, selectedRange],
  );
  const initialPriceHistory = hasRawPriceHistory ? rawPriceHistory ?? [] : fallbackPriceHistory;

  const initialSeries = React.useMemo(
    () =>
      buildChartSeries({
        priceHistory: initialPriceHistory,
        outcomes,
        range: selectedRange,
        selectedOutcomeName: focusedOutcomeName,
      }),
    [focusedOutcomeName, initialPriceHistory, outcomes, selectedRange],
  );
  const shouldUseFallbackHistory = initialSeries.length === 0 && fallbackPriceHistory.length > 0;
  const priceHistory = shouldUseFallbackHistory ? fallbackPriceHistory : initialPriceHistory;
  const baseSeries = React.useMemo(
    () =>
      shouldUseFallbackHistory
        ? buildChartSeries({
            priceHistory,
            outcomes,
            range: selectedRange,
            selectedOutcomeName: focusedOutcomeName,
          })
        : initialSeries,
    [focusedOutcomeName, initialSeries, outcomes, priceHistory, selectedRange, shouldUseFallbackHistory],
  );
  const yAxis = React.useMemo(() => buildChartYAxisScale(baseSeries, yTickCount), [baseSeries]);
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
  const lastPoint = getLastPoint(series);
  const footerDate = endsAt ?? lastPoint?.timestamp ?? null;
  const latestVolume = getLatestVolume(rawPriceHistory ?? []);
  const chartMode = outcomes.length > 2 ? "мульти-исходов" : "бинарного рынка";
  const xTicks = React.useMemo(
    () => buildTimeTicks(series, selectedRange),
    [selectedRange, series],
  );
  const legendSeries = React.useMemo(() => applyHoverValuesToLegend(series, hover), [hover, series]);
  const hoverLabels = React.useMemo(() => buildHoverLabels(hover?.values ?? []), [hover]);

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!hasVisibleSeries || series.length === 0 || !svgRef.current) {
      setHover(null);
      return;
    }

    const rect = svgRef.current.getBoundingClientRect();
    const cursorX = clamp(((event.clientX - rect.left) / rect.width) * chartWidth, 0, plotRight);
    const nearestValues = series.flatMap((item) => {
      const point = getNearestPoint(item, cursorX);
      return point
        ? [
            {
              key: item.key,
              label: item.label,
              color: item.color,
              value: point.value,
              point,
            },
          ]
        : [];
    });
    const primary = [...nearestValues].sort(
      (left, right) => Math.abs(left.point.x - cursorX) - Math.abs(right.point.x - cursorX),
    )[0];

    if (!primary) {
      setHover(null);
      return;
    }

    const values = series.flatMap((item) => {
      const point = getNearestTimestampPoint(item, primary.point.timestampMs) ?? getNearestPoint(item, cursorX);
      return point
        ? [
            {
              key: item.key,
              label: item.label,
              color: item.color,
              value: point.value,
              point,
            },
          ]
        : [];
    });

    setHover({
      anchorX: primary.point.x,
      cursorX,
      timestamp: primary.point.timestamp,
      values,
    });
  }

  return (
    <div className="relative mt-6 overflow-visible bg-transparent pb-4 pt-1 text-[#0e0f11]">
      <div className="flex min-h-8 items-start gap-5 px-0">
        {hasVisibleSeries ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
            {legendSeries.map((item) => (
              <span
                className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[#77808d]"
                key={item.key}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="min-w-0 truncate">{item.label}</span>
                <strong className="shrink-0 text-[#0e0f11]">{formatChartPercent(item.latest)}</strong>
              </span>
            ))}
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        <div
          aria-hidden="true"
          className="ml-auto hidden shrink-0 text-[24px] font-bold leading-none tracking-normal text-[#d9dee4] lg:block"
        >
          PulseMarket
        </div>
      </div>

      <div className="relative mt-7 overflow-visible">
        <svg
          className="h-[260px] w-full touch-none overflow-visible"
          ref={svgRef}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`График вероятностей ${chartMode}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHover(null)}
        >
          <rect fill="transparent" height={chartHeight} width={chartWidth} x="0" y="0" />
          <defs>
            <clipPath id={chartClipId}>
              <rect height={plotBottom} width={plotRight} x="0" y="0" />
            </clipPath>
          </defs>
          {yAxis.ticks.map((tick) => {
            const y = valueToY(tick, yAxis);
            return (
              <g key={tick}>
                <line
                  x1="0"
                  x2={gridRight}
                  y1={y}
                  y2={y}
                  stroke="#e6e8ea"
                  strokeDasharray="1 3"
                  strokeLinecap="round"
                  strokeOpacity="0.9"
                />
                <text
                  className="fill-[#77808d] text-[12px] font-normal"
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
              className="fill-[#aeb4bc] text-[12px] font-normal"
              key={`${tick.label}-${tick.x}`}
              textAnchor="middle"
              x={tick.x}
              y={plotBottom + 32}
            >
              {tick.label}
            </text>
          ))}
          {hasVisibleSeries
            ? series.map((item) => {
                const latest = item.points.at(-1);
                return (
                  <g key={item.key}>
                    <g clipPath={`url(#${chartClipId})`}>
                      <path
                        d={item.path}
                        fill="none"
                        stroke={item.color}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.35"
                      />
                    </g>
                    {latest ? (
                      <g className="pointer-events-none">
                        <circle cx={latest.x} cy={latest.y} fill={item.color} opacity="0.12" r="12" />
                        <circle cx={latest.x} cy={latest.y} fill={item.color} r="4" />
                      </g>
                    ) : null}
                  </g>
                );
              })
            : null}
          {hover ? (
            <g className="pointer-events-none">
              <line
                x1={hover.anchorX}
                x2={hover.anchorX}
                y1={plotTop}
                y2={plotBottom}
                stroke="#26323d"
                strokeOpacity="0.95"
                strokeWidth="1.5"
              />
              {hover.values.map((item) => (
                <g key={item.key}>
                  <circle cx={item.point.x} cy={item.point.y} fill={item.color} opacity="0.18" r="6" />
                  <circle cx={item.point.x} cy={item.point.y} fill={item.color} r="4" />
                </g>
              ))}
            </g>
          ) : null}
        </svg>

        {hoverLabels.map((item) => (
          <div
            className="pointer-events-none absolute z-20 flex h-[21px] items-center gap-1 rounded-[5px] border border-[#26323d] bg-[#151b20]/95 px-1.5 text-[11px] font-semibold text-[#f4f5f6] shadow-[0_4px_10px_rgba(0,0,0,0.2)] backdrop-blur"
            key={item.key}
            style={getHoverLabelStyle(item)}
          >
            <span className="h-[14px] w-1 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="min-w-0 truncate">{item.label}</span>
            <strong className="ml-auto shrink-0 font-bold text-[#f4f5f6]">
              {formatChartPercent(item.value)}
            </strong>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4 border-t border-[#e6e8ea] pt-4 text-[13px] font-medium tracking-[-0.09px] text-[#77808d] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-[#0e0f11]">
            <Trophy size={14} />
            {latestVolume === null ? "--" : formatFullMoney(latestVolume)} Объем
          </span>
          <span className="h-2.5 w-px rounded-full bg-[#e6e8ea]" />
          <span className="flex items-center gap-1.5">
            <Clock3 size={12} />
            {footerDate ? formatChartDate(footerDate) : "Дата неизвестна"}
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-end">
          <div className="flex items-center gap-3">
            {chartRanges.map((range) => (
              <button
                className={`h-8 whitespace-nowrap text-[13px] font-bold tracking-normal transition ${
                  selectedRange === range
                    ? "text-[#0e0f11]"
                    : "text-[#77808d] hover:text-[#0e0f11]"
                }`}
                key={range}
                onClick={() => setSelectedRange(range)}
                type="button"
              >
                {rangeLabels[range]}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[#77808d]">
            <button
              aria-label="Сортировать исходы графика"
              className="transition hover:text-[#0e0f11]"
              type="button"
            >
              <ListFilter size={19} />
            </button>
            <button
              aria-label="Настройки графика"
              className="transition hover:text-[#0e0f11]"
              type="button"
            >
              <Settings size={19} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function valueToY(value: number, yAxis: ChartYAxisScale) {
  const span = Math.max(0.0001, yAxis.max - yAxis.min);
  return plotTop + (1 - (value - yAxis.min) / span) * (plotBottom - plotTop);
}

function getHoverLabelStyle(item: HoverLabel): React.CSSProperties {
  return {
    left: `${(item.labelX / chartWidth) * 100}%`,
    top: `${(item.labelY / chartHeight) * 100}%`,
    transform: "translateY(-50%)",
    width: `${item.rectWidth}px`,
  };
}

function buildHoverLabels(values: HoverValue[]): HoverLabel[] {
  if (values.length === 0) {
    return [];
  }

  const topLimit = plotTop + hoverLabelHeight / 2;
  const bottomLimit = plotBottom - hoverLabelHeight / 2;
  const ordered = [...values]
    .sort((left, right) => left.point.y - right.point.y)
    .map((item) => {
      const rectWidth = getHoverLabelWidth(item);
      const shouldPlaceLeft = item.point.x > plotRight - rectWidth - 16;
      const labelX = shouldPlaceLeft
        ? Math.max(0, item.point.x - rectWidth - 14)
        : Math.min(plotRight - rectWidth, item.point.x + 16);

      return {
        ...item,
        labelX: round(labelX),
        labelY: clamp(item.point.y, topLimit, bottomLimit),
        rectWidth,
      };
    });

  let nextY = topLimit;
  const spaced = ordered.map((item) => {
    const labelY = Math.max(item.labelY, nextY);
    nextY = labelY + hoverLabelHeight + hoverLabelGap;
    return { ...item, labelY };
  });
  const overflow = (spaced.at(-1)?.labelY ?? bottomLimit) - bottomLimit;
  const shift = Math.max(0, overflow);

  return spaced.map((item) => ({
    ...item,
    labelY: round(clamp(item.labelY - shift, topLimit, bottomLimit)),
  }));
}

function getHoverLabelWidth(item: HoverValue) {
  const text = `${item.label} ${formatChartPercent(item.value)}`;
  return Math.max(92, Math.min(260, Math.ceil(text.length * 6.2 + 24)));
}

function applyHoverValuesToLegend(series: ChartSeries[], hover: ChartHover | null) {
  if (!hover) {
    return series;
  }

  const hoverValues = new Map(hover.values.map((item) => [item.key, item.value]));
  return series.map((item) => ({
    ...item,
    latest: hoverValues.get(item.key) ?? item.latest,
  }));
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

function getNearestTimestampPoint(series: ChartSeries, timestampMs: number) {
  return series.points.reduce<ChartSeries["points"][number] | null>((nearest, point) => {
    if (!nearest) {
      return point;
    }

    return Math.abs(point.timestampMs - timestampMs) < Math.abs(nearest.timestampMs - timestampMs)
      ? point
      : nearest;
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

function formatChartDate(value: string | number) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Дата неизвестна";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatHourTick(value: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDayTick(value: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
