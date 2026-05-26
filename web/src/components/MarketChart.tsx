import * as React from "react";
import { AlertCircle, Info } from "lucide-react";
import { formatDate, formatPercent } from "../lib/format";
import {
  buildChartSeries,
  chartRanges,
  type ChartRange,
  type ChartSeries,
} from "../lib/marketChart";
import type { Market, Outcome } from "../lib/types";

const chartWidth = 900;
const chartHeight = 220;

export function MarketChart({
  outcomes,
  history,
}: {
  outcomes: Outcome[];
  history?: Market["history"];
}) {
  const [selectedRange, setSelectedRange] = React.useState<ChartRange>("ALL");
  const priceHistory = history?.price_history ?? [];
  const series = React.useMemo(
    () =>
      buildChartSeries({
        priceHistory,
        outcomes,
        range: selectedRange,
      }),
    [outcomes, priceHistory, selectedRange],
  );
  const hasHistory = Boolean(history);
  const hasPriceHistory = priceHistory.length > 0;
  const hasVisibleSeries = series.some((item) => item.points.length > 0);
  const isSynthetic = history?.is_synthetic === true;
  const shouldRenderChart = hasVisibleSeries && !isSynthetic;
  const firstPoint = getFirstPoint(series);
  const lastPoint = getLastPoint(series);
  const chartMode = outcomes.length > 2 ? "Multi-outcome" : "Binary market";

  return (
    <div className="relative mt-6 overflow-hidden bg-white">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#f4f5f6] px-3 py-1 text-xs font-semibold text-[#77808d]">
              {chartMode}
            </span>
            {history?.is_synthetic ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#f7d022]/35 bg-[#f7d022]/10 px-3 py-1 text-xs font-semibold text-[#8a6f00]">
                <Info size={13} />
                Generated from current price until market history is available
              </span>
            ) : null}
          </div>
          {hasVisibleSeries ? (
            <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-[#77808d]">
              {series.map((item) => (
                <span className="flex items-center gap-2" key={item.key}>
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span>{item.label}</span>
                  <strong className="text-[#0e0f11]">{formatPercent(item.latest)}</strong>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chartRanges.map((range) => (
            <button
              className={`rounded-xl px-2.5 py-1.5 text-xs font-bold transition ${
                selectedRange === range
                  ? "bg-[#0e0f11] text-white"
                  : "bg-transparent text-[#77808d] hover:bg-[#f4f5f6] hover:text-[#0e0f11]"
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

      <div className="relative overflow-hidden">
        <svg
          className="h-[260px] w-full"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`${chartMode} price history chart`}
        >
          {[24, 67, 110, 153, 196].map((y) => (
            <line
              className="stroke-[#dfe3e7] [stroke-dasharray:2_5]"
              key={y}
              x1="0"
              x2={chartWidth}
              y1={y}
              y2={y}
            />
          ))}
          {["100%", "75%", "50%", "25%", "0%"].map((label, index) => (
            <text className="fill-[#77808d] text-xs" key={label} x="850" y={28 + index * 43}>
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
        </svg>

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

      <div className="mt-2 flex justify-between px-2 text-xs font-semibold text-[#77808d]">
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
    <div className="absolute inset-x-4 top-1/2 mx-auto max-w-xl -translate-y-1/2 rounded-xl border border-[#e6e8ea] bg-white/95 p-5 text-center">
      <strong className="flex items-center justify-center gap-2 text-base font-semibold text-[#0e0f11]">
        {icon}
        {title}
      </strong>
      <span className="mt-2 block text-sm font-medium text-[#77808d]">{detail}</span>
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
