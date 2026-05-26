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
        className="flex w-fit items-center gap-2 rounded-2xl border border-[#242b32] px-4 py-2 text-sm font-semibold text-[#7b8996] transition hover:border-[#0093fd]/50 hover:text-[#dee3e7]"
        onClick={() => navigate("/markets")}
        type="button"
      >
        <ArrowLeft size={18} />
        All markets
      </button>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#0093fd]">
            {user ? "Account watchlist" : "Guest watchlist"}
          </span>
          <h1 className="mt-2 text-4xl font-semibold tracking-normal text-[#dee3e7]">
            Watchlist
          </h1>
          <p className="mt-2 max-w-2xl text-base font-medium text-[#7b8996]">
            Markets saved from discovery and category pages.
          </p>
        </div>
        {markets.length > 0 ? (
          <button
            className="flex items-center justify-center gap-2 rounded-2xl border border-[#242b32] px-4 py-3 text-sm font-semibold text-[#dee3e7] transition hover:border-[#cb3131]/60 hover:text-[#d78282]"
            onClick={onClear}
            type="button"
          >
            <BookmarkX size={18} />
            Clear watchlist
          </button>
        ) : null}
      </div>

      {markets.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-[#242b32] bg-[#1e2428] p-12 text-center">
          <strong className="block text-base font-semibold text-[#dee3e7]">
            No watched markets yet.
          </strong>
          <button
            className="mt-4 rounded-2xl bg-[#0093fd] px-4 py-3 text-sm font-semibold text-white"
            onClick={() => navigate("/markets")}
            type="button"
          >
            Browse markets
          </button>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((market, index) => (
            <MarketCard
              key={market.id}
              market={market}
              onOpen={() => navigate(`/markets/${encodeURIComponent(market.slug ?? market.id)}`)}
              isWatched
              imageLoading={index < 6 ? "eager" : "lazy"}
              imagePriority={index < 6 ? "high" : "auto"}
              onWatchlistToggle={() => onWatchlistToggle(market)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
