import { ArrowLeft, BookmarkX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MarketCard } from "../components/MarketCard";
import type { AuthUser, Market } from "../lib/types";

export function WatchlistPage({
  user,
  markets,
  onWatchlistToggle,
  onClear,
}: {
  user: AuthUser | null;
  markets: Market[];
  onWatchlistToggle: (market: Market) => void;
  onClear: () => void;
}) {
  const navigate = useNavigate();

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <button
        className="flex w-fit items-center gap-2 rounded-lg border border-[#293440] px-4 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]"
        onClick={() => navigate("/markets")}
        type="button"
      >
        <ArrowLeft size={18} />
        All markets
      </button>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#3b91f6]">
            {user ? "Account watchlist" : "Guest watchlist"}
          </span>
          <h1 className="mt-2 text-4xl font-semibold tracking-normal text-[#edf1f5]">
            Watchlist
          </h1>
          <p className="mt-2 max-w-2xl text-base font-medium text-[#8f9aa8]">
            Markets saved from discovery and category pages.
          </p>
        </div>
        {markets.length > 0 ? (
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[#293440] px-4 py-3 text-sm font-semibold text-[#edf1f5] transition hover:border-[#d34c45]/60 hover:text-red-300"
            onClick={onClear}
            type="button"
          >
            <BookmarkX size={18} />
            Clear watchlist
          </button>
        ) : null}
      </div>

      {markets.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-[#293440] bg-[#171d24] p-12 text-center">
          <strong className="block text-base font-semibold text-[#edf1f5]">
            No watched markets yet.
          </strong>
          <button
            className="mt-4 rounded-lg bg-[#3b91f6] px-4 py-3 text-sm font-semibold text-white"
            onClick={() => navigate("/markets")}
            type="button"
          >
            Browse markets
          </button>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              onOpen={() => navigate(`/markets/${market.id}`)}
              isWatched
              onWatchlistToggle={() => onWatchlistToggle(market)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
