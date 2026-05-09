import { formatDate } from "../lib/format";
import type { MarketSnapshot, Outcome } from "../lib/types";

export function MarketChart({
  outcomes,
  snapshots = [],
}: {
  outcomes: Outcome[];
  snapshots?: MarketSnapshot[];
}) {
  const chartMode = outcomes.length > 2 ? "Multi-outcome" : "Binary market";
  const hasSnapshots = snapshots.length > 0;
  const chartLines = [
    "M10 138 C26 164 28 82 72 76 C108 70 110 56 132 58 C164 62 152 42 194 48 C270 50 318 42 390 34 C460 26 508 28 570 42 C632 56 720 50 792 62 C824 66 808 95 840 88 C858 84 838 28 884 38 C910 44 902 54 926 46",
    "M10 198 C28 126 26 208 74 196 C116 188 98 216 150 200 C182 188 160 226 214 206 C300 210 380 212 464 208 C548 206 612 196 690 184 C760 174 800 162 816 154 C834 150 830 120 846 120 C858 120 832 204 864 196 C882 192 876 174 926 188",
    "M10 166 C18 222 42 206 76 210 C130 214 180 204 242 208 C338 214 456 218 572 216 C694 214 788 212 928 210",
  ];
  const lineColors = ["stroke-blue-300", "stroke-blue-500", "stroke-[#f4bd3f]"];

  return (
    <div className="relative mt-6 overflow-hidden rounded-[14px] border border-[#293440] bg-[#0f1318] p-3">
      <svg className="h-[260px] w-full" viewBox="0 0 960 260" role="img">
        {[36, 98, 160, 222].map((y) => (
          <line
            className="stroke-[#293440]/80 [stroke-dasharray:2_5]"
            key={y}
            x1="0"
            x2="960"
            y1={y}
            y2={y}
          />
        ))}
        {["100%", "75%", "50%", "25%", "0%"].map((label, index) => (
          <text className="fill-[#8f9aa8] text-xs" key={label} x="930" y={36 + index * 47}>
            {label}
          </text>
        ))}
        {hasSnapshots
          ? chartLines.slice(0, Math.min(3, outcomes.length || 2)).map((path, index) => (
              <path
                className={`${lineColors[index]} stroke-[3]`}
                d={path}
                fill="none"
                key={path}
                strokeLinecap="round"
              />
            ))
          : null}
        {hasSnapshots ? (
          <>
            <circle className="fill-blue-300" cx="926" cy="46" r="6" />
            <circle className="fill-blue-500" cx="926" cy="188" r="6" />
            {outcomes.length > 2 ? <circle className="fill-[#f4bd3f]" cx="926" cy="210" r="6" /> : null}
          </>
        ) : null}
      </svg>
      <span className="absolute left-4 top-4 rounded-full bg-[#171d24] px-3 py-1 text-xs font-semibold text-[#8f9aa8]">
        {hasSnapshots ? chartMode : "No historical snapshots yet"}
      </span>
      {!hasSnapshots ? (
        <div className="absolute inset-x-4 top-1/2 mx-auto max-w-xl -translate-y-1/2 rounded-lg border border-[#293440] bg-[#171d24]/95 p-5 text-center">
          <strong className="block text-base font-semibold text-[#edf1f5]">
            Historical chart will appear after snapshots are collected.
          </strong>
          <span className="mt-2 block text-sm font-medium text-[#8f9aa8]">
            Price history is not available for this market yet.
          </span>
        </div>
      ) : null}
      <div className="mt-1 flex justify-between px-2 text-xs font-semibold text-slate-600">
        <span>{hasSnapshots ? formatDate(snapshots[0]?.captured_at ?? null) : "Start"}</span>
        <span>{hasSnapshots ? `${snapshots.length} snapshots` : "Waiting for data"}</span>
        <span>
          {hasSnapshots ? formatDate(snapshots[snapshots.length - 1]?.captured_at ?? null) : "Latest"}
        </span>
      </div>
    </div>
  );
}
