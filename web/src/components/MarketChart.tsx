import * as React from "react";
import { AlertCircle, Info, Search } from "lucide-react";
import { formatDate, formatPercent } from "../lib/format";
import {
  buildChartSeries,
  chartRanges,
  type ChartRange,
  type ChartSeries,
} from "../lib/marketChart";
import type { Market, Outcome } from "../lib/types";

const chartWidth = 900;
const chartHeight = 240;

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
  const priceHistory = history?.price_history ?? [];

  React.useEffect(() => {
    if (selectedOutcomeName) {
      setFocusedOutcomeName(selectedOutcomeName);
    }
  }, [selectedOutcomeName]);

  const series = React.useMemo(
    () =>
      buildChartSeries({
        priceHistory,
        outcomes,
        range: selectedRange,
        selectedOutcomeName: focusedOutcomeName,
      }),
    [focusedOutcomeName, outcomes, priceHistory, selectedRange],
  );
  const hasHistory = Boolean(history);
  const hasPriceHistory = priceHistory.length > 0;
  const hasVisibleSeries = series.some((item) => item.points.length > 0);
  const isSynthetic = history?.is_synthetic === true;
  const shouldRenderChart = hasVisibleSeries && !isSynthetic;
  const firstPoint = getFirstPoint(series);
  const lastPoint = getLastPoint(series);
  const chartMode = outcomes.length > 2 ? "Multi-outcome" : "Binary market";
  const searchableOutcomes = React.useMemo(
    () =>
      outcomes
        .filter((outcome) =>
          outcome.name.toLowerCase().includes(outcomeQuery.trim().toLowerCase()),
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
    const primary = nearestValues
      .sort((left, right) => Math.abs(left.point.x - svgX) - Math.abs(right.point.x - svgX))[0];

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
    <div className="relative mt-6 overflow-hidden rounded-lg border border-[#242b32] bg-[#10151a] p-4 text-[#dee3e7]">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[#1e2428] px-3 py-1 text-xs font-semibold text-[#8d99a6]">
              {chartMode}
            </span>
            {history?.is_synthetic ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-[#f7d022]/35 bg-[#f7d022]/10 px-3 py-1 text-xs font-semibold text-[#f7d022]">
                <Info size={13} />
                Generated from current price until market history is available
              </span>
            ) : null}
          </div>
          {hasVisibleSeries ? (
            <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-[#8d99a6]">
              {series.map((item) => (
                <span className="flex items-center gap-2" key={item.key}>
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span>{item.label}</span>
                  <strong className="text-[#dee3e7]">{formatPercent(item.latest)}</strong>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chartRanges.map((range) => (
            <button
              className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition ${
                selectedRange === range
                  ? "bg-[#dee3e7] text-[#10151a]"
                  : "bg-transparent text-[#8d99a6] hover:bg-[#1e2428] hover:text-[#dee3e7]"
              }`}
              key={range}
              onClick={() => setSelectedRange(range)}
              type="button"
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {outcomes.length > 5 ? (
        <div className="mb-3 grid gap-2 sm:grid-cols-[220px_minmax(0,1fr)]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8d99a6]" size={15} />
            <input
              className="h-9 w-full rounded-md border border-[#242b32] bg-[#15191d] pl-9 pr-3 text-sm font-semibold text-[#dee3e7] outline-none placeholder:text-[#586879]"
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
                      ? "bg-[#1f55f5] text-white"
                      : "bg-[#15191d] text-[#8d99a6] hover:text-[#dee3e7]"
                  }`}
                  key={outcome.name}
                  onClick={() => setFocusedOutcomeName(outcome.name)}
                  type="button"
                >
                  {outcome.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="relative overflow-hidden">
        <svg
          className="h-[260px] w-full touch-none"
          ref={svgRef}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`${chartMode} price history chart`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHover(null)}
        >
          <rect fill="#10151a" height={chartHeight} width={chartWidth} x="0" y="0" />
          {[28, 74, 120, 166, 212].map((y) => (
            <line
              className="stroke-[#27313a] [stroke-dasharray:2_5]"
              key={y}
              x1="0"
              x2={chartWidth - 54}
              y1={y}
              y2={y}
            />
          ))}
          {["100%", "75%", "50%", "25%", "0%"].map((label, index) => (
            <text className="fill-[#8d99a6] text-xs" key={label} x="850" y={32 + index * 46}>
              {label}
            </text>
          ))}
          {shouldRenderChart
            ? series.map((item) => (
                <g key={item.key}>
                  <path
                    d={item.path}
                    fill="none"
                    stroke={item.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                  />
                  {item.points.map((point, index) =>
                    index === item.points.length - 1 ? (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        fill={item.color}
                        key={`${item.key}-${point.timestamp}-${index}`}
                        r="4.8"
                      />
                    ) : null,
                  )}
                </g>
              ))
            : null}
          {hover ? (
            <g>
              <line
                x1={hover.x}
                x2={hover.x}
                y1="18"
                y2="212"
                stroke="#586879"
                strokeDasharray="3 5"
              />
              <circle cx={hover.x} cy={hover.y} fill="#dee3e7" r="4" />
            </g>
          ) : null}
        </svg>

        {hover ? (
          <div
            className="pointer-events-none absolute top-8 z-10 min-w-[180px] rounded-md border border-[#242b32] bg-[#15191d] p-3 shadow-xl"
            style={{
              left: `${Math.min(72, Math.max(0, (hover.x / chartWidth) * 100))}%`,
              transform: hover.x > chartWidth * 0.72 ? "translateX(-100%)" : undefined,
            }}
          >
            <strong className="block text-xs font-bold text-[#dee3e7]">
              {formatDate(hover.timestamp)}
            </strong>
            <div className="mt-2 grid gap-1.5">
              {hover.values.map((item) => (
                <span className="flex items-center justify-between gap-3 text-xs font-semibold text-[#8d99a6]" key={item.label}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <strong className="text-[#dee3e7]">{formatPercent(item.value)}</strong>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {!hasHistory ? (
          <ChartState
            icon={<AlertCircle size={18} />}
            title="History unavailable"
            detail="The detail response did not include price history for this market."
          />
        ) : isSynthetic ? (
          <ChartState
            icon={<Info size={18} />}
            title="Market history unavailable"
            detail="Generated from the latest price because CLOB history and Pulse snapshots are unavailable."
          />
        ) : !hasPriceHistory ? (
          <ChartState
            title="No price history yet"
            detail="Historical chart will appear when CLOB history or Pulse snapshots are available."
          />
        ) : !hasVisibleSeries ? (
          <ChartState
            title={`No points in ${selectedRange}`}
            detail="Choose a wider range to see available price history."
          />
        ) : null}
      </div>

      <div className="mt-2 flex justify-between px-2 text-xs font-semibold text-[#8d99a6]">
        <span>{firstPoint ? formatDate(firstPoint.timestamp) : "Start"}</span>
        <span>
          {hasPriceHistory
            ? `${priceHistory.length} ${isSynthetic ? "fallback" : "real"} price points`
            : "Waiting for data"}
        </span>
        <span>{lastPoint ? formatDate(lastPoint.timestamp) : "Latest"}</span>
      </div>
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
    <div className="absolute inset-x-4 top-1/2 mx-auto max-w-xl -translate-y-1/2 rounded-lg border border-[#242b32] bg-[#15191d]/95 p-5 text-center">
      <strong className="flex items-center justify-center gap-2 text-base font-semibold text-[#dee3e7]">
        {icon}
        {title}
      </strong>
      <span className="mt-2 block text-sm font-medium text-[#8d99a6]">{detail}</span>
    </div>
  );
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
