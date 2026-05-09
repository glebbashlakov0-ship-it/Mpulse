import { Bookmark, Clock3, Gift } from "lucide-react";
import { formatMoney, formatPercent } from "../lib/format";
import { getMarketKind, getOutcomeActionLabel } from "../lib/market";
import type { Market } from "../lib/types";
import { MarketImage } from "./MarketMedia";

const pillButton =
  "rounded-md px-2.5 py-1.5 text-xs font-semibold transition hover:brightness-110";

export function MarketCard({
  market,
  onOpen,
  isWatched = false,
  onWatchlistToggle,
}: {
  market: Market;
  onOpen: () => void;
  isWatched?: boolean;
  onWatchlistToggle?: () => void;
}) {
  const displayedOutcomes = market.outcomes.slice(0, 3);
  const status = market.dates?.status ?? (market.closed ? "closed" : "live");

  return (
    <article className="group relative flex min-h-[220px] flex-col rounded-lg border border-[#293440] bg-[#171d24] p-4 shadow-[0_14px_32px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:border-[#3b91f6]/60 hover:bg-[#1d252e]">
      <button
        className="absolute inset-0 z-30 rounded-lg"
        onClick={onOpen}
        aria-label={`Open ${market.title}`}
      />
      <div className="relative z-20 flex items-start gap-3">
        <MarketImage market={market} className="h-12 w-12" />
        <h2 className="line-clamp-3 min-h-[60px] flex-1 text-base font-semibold leading-snug text-[#edf1f5]">
          {market.title}
        </h2>
      </div>

      <div className="relative z-20 mt-4 grid gap-2">
        {displayedOutcomes.length > 0 ? (
          displayedOutcomes.map((outcome, index) => (
            <OutcomeLine
              key={`${outcome.name}-${index}`}
              label={outcome.name}
              price={outcome.price ?? outcome.probability ?? null}
              isBinary={market.outcomes.length === 2}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[#293440] px-3 py-3 text-center text-sm font-semibold text-[#8f9aa8]">
            Outcomes are not available yet.
          </div>
        )}
      </div>

      <div className="relative z-20 mt-auto flex items-center gap-2 pt-4 text-xs font-semibold text-[#8f9aa8]">
        <span>{formatMoney(market.volume)} Vol.</span>
        <span className="h-1 w-1 rounded-full bg-[#8f9aa8]/60" />
        <span>{formatMoney(market.liquidity)} Liq.</span>
        <span className="h-1 w-1 rounded-full bg-[#8f9aa8]/60" />
        <span>{getMarketKind(market)}</span>
        <div className="ml-auto flex items-center gap-1.5 text-[#8f9aa8]">
          <Clock3 size={15} />
          <span className="hidden capitalize sm:inline">{status.replace("_", " ")}</span>
          <Gift size={15} />
          {onWatchlistToggle ? (
            <button
              className={`relative z-40 grid h-7 w-7 place-items-center rounded-md transition ${
                isWatched
                  ? "bg-[#3b91f6]/20 text-[#3b91f6]"
                  : "text-[#8f9aa8] hover:bg-[#293440] hover:text-[#edf1f5]"
              }`}
              aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}
              aria-pressed={isWatched}
              onClick={(event) => {
                event.stopPropagation();
                onWatchlistToggle();
              }}
              type="button"
            >
              <Bookmark size={15} fill={isWatched ? "currentColor" : "none"} />
            </button>
          ) : (
            <Bookmark size={15} />
          )}
        </div>
      </div>
    </article>
  );
}

function OutcomeLine({
  label,
  price,
  isBinary,
}: {
  label: string;
  price: number | null;
  isBinary: boolean;
}) {
  const normalizedLabel = label.trim().toLowerCase();
  const actionLabel = getOutcomeActionLabel(label, isBinary);
  const actionTone =
    normalizedLabel === "no"
      ? "bg-red-500/20 text-red-300"
      : normalizedLabel === "yes"
        ? "bg-green-500/20 text-green-300"
        : "bg-blue-500/20 text-[#3b91f6]";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg bg-[#0f1318] px-3 py-2">
      <span className="truncate text-sm font-medium text-[#edf1f5]">{label}</span>
      <strong className="text-sm font-semibold text-[#edf1f5]">{formatPercent(price)}</strong>
      <button className={`${pillButton} ${actionTone}`}>
        <span className="block max-w-[76px] truncate">{actionLabel}</span>
      </button>
    </div>
  );
}
