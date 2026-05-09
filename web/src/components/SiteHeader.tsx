import {
  Bookmark,
  ChevronRight,
  Info,
  LogIn,
  Menu,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserCircle,
  Wallet,
  X,
} from "lucide-react";
import * as React from "react";
import { primaryNav, type PrimaryNavItem } from "../lib/constants";
import type { AuthUser, MarketFilters } from "../lib/types";

const iconButton =
  "grid h-10 w-10 place-items-center rounded-lg border border-[#293440] text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]";

export function SiteHeader({
  query,
  filters,
  authStatus,
  user,
  onQueryChange,
  onPortfolioOpen,
  onWatchlistOpen,
  onLoginOpen,
  onSignupOpen,
  onProfileOpen,
  onAdminOpen,
  onPrimaryNavSelect,
  onMoreMarketsOpen,
  watchlistCount,
}: {
  query: string;
  filters: MarketFilters;
  authStatus: "loading" | "guest" | "authenticated" | "error";
  user: AuthUser | null;
  watchlistCount: number;
  onQueryChange: (query: string) => void;
  onPortfolioOpen: () => void;
  onWatchlistOpen: () => void;
  onLoginOpen: () => void;
  onSignupOpen: () => void;
  onProfileOpen: () => void;
  onAdminOpen: () => void;
  onPrimaryNavSelect: (item: PrimaryNavItem) => void;
  onMoreMarketsOpen: () => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  function closeMenu(action: () => void) {
    setIsMenuOpen(false);
    action();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[#293440]/80 bg-[#0f1318]/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap md:px-6 xl:px-8">
        <a
          className="flex min-w-fit items-center gap-3 text-[#edf1f5] transition hover:text-white"
          href="/"
          aria-label="Market Pulse home"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg border-2 border-[#edf1f5] text-[11px] font-bold">
            MP
          </span>
          <strong className="hidden text-xl font-semibold tracking-normal sm:block">
            Market Pulse
          </strong>
        </a>

        <div className="order-3 flex h-12 min-w-0 w-full items-center gap-3 rounded-lg border border-[#293440] bg-[#171d24] px-4 text-[#8f9aa8] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:order-none sm:flex-1">
          <Search size={21} />
          <input
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[#edf1f5] outline-none placeholder:text-[#8f9aa8]"
            aria-label="Search markets"
            placeholder="Search markets..."
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <span className="hidden text-lg md:block">/</span>
        </div>

        <nav className="ml-auto flex min-w-fit items-center gap-2" aria-label="Account links">
          <a
            className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24] md:flex"
            href="#how-it-works"
          >
            <Info size={17} />
            How it works
          </a>
          <button
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24]"
            onClick={onPortfolioOpen}
            type="button"
          >
            <Wallet size={18} />
            <span className="hidden sm:inline">Portfolio</span>
          </button>
          <button
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24]"
            onClick={onWatchlistOpen}
            type="button"
          >
            <Bookmark size={18} />
            <span className="hidden sm:inline">Watchlist</span>
            {watchlistCount > 0 ? (
              <span className="grid min-w-5 place-items-center rounded-full bg-[#3b91f6] px-1.5 text-xs text-white">
                {watchlistCount}
              </span>
            ) : null}
          </button>
          {authStatus === "authenticated" && user ? (
            <>
              {user.role !== "user" ? (
                <button
                  className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24] md:flex"
                  onClick={onAdminOpen}
                  type="button"
                >
                  <ShieldCheck size={17} />
                  Admin
                </button>
              ) : null}
              <button
                className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#edf1f5] transition hover:bg-[#171d24]"
                onClick={onProfileOpen}
                type="button"
              >
                <UserCircle size={18} />
                <span className="hidden max-w-28 truncate lg:inline">{user.displayName}</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24] lg:flex"
                onClick={onLoginOpen}
                type="button"
              >
                <LogIn size={17} />
                Log In
              </button>
              <button
                className="hidden rounded-lg bg-[#3b91f6] px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none sm:block"
                onClick={onSignupOpen}
                type="button"
              >
                {authStatus === "loading" ? "Checking..." : "Sign Up"}
              </button>
            </>
          )}
          <button
            className={`${iconButton} lg:hidden`}
            aria-label={isMenuOpen ? "Close menu" : "Menu"}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((current) => !current)}
            type="button"
          >
            {isMenuOpen ? <X size={23} /> : <Menu size={25} />}
          </button>
        </nav>
      </div>

      {isMenuOpen ? (
        <div className="mx-auto max-w-[1500px] px-4 pb-3 md:px-6 xl:px-8 lg:hidden">
          <div className="grid gap-2 rounded-lg border border-[#293440] bg-[#171d24] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
            {authStatus === "authenticated" && user ? (
              <>
                <button
                  className="flex items-center justify-between gap-3 rounded-lg bg-[#0f1318] px-4 py-3 text-left text-sm font-semibold text-[#edf1f5] transition hover:bg-[#1d252e]"
                  onClick={() => closeMenu(onProfileOpen)}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <UserCircle size={18} />
                    <span className="truncate">{user.displayName}</span>
                  </span>
                  <ChevronRight size={16} />
                </button>
                {user.role !== "user" ? (
                  <button
                    className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold text-[#edf1f5] transition hover:bg-[#0f1318]"
                    onClick={() => closeMenu(onAdminOpen)}
                    type="button"
                  >
                    <span className="flex items-center gap-3">
                      <ShieldCheck size={18} />
                      Admin
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button
                  className="flex items-center justify-between gap-3 rounded-lg bg-[#0f1318] px-4 py-3 text-left text-sm font-semibold text-[#edf1f5] transition hover:bg-[#1d252e]"
                  onClick={() => closeMenu(onLoginOpen)}
                  type="button"
                >
                  <span className="flex items-center gap-3">
                    <LogIn size={18} />
                    Log In
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button
                  className="flex items-center justify-between gap-3 rounded-lg bg-[#3b91f6] px-4 py-3 text-left text-sm font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none"
                  onClick={() => closeMenu(onSignupOpen)}
                  type="button"
                >
                  <span>Sign Up</span>
                  <ChevronRight size={16} />
                </button>
              </>
            )}

            <button
              className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold text-[#edf1f5] transition hover:bg-[#0f1318]"
              onClick={() => closeMenu(onPortfolioOpen)}
              type="button"
            >
              <span className="flex items-center gap-3">
                <Wallet size={18} />
                Portfolio
              </span>
              <ChevronRight size={16} />
            </button>
            <button
              className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold text-[#edf1f5] transition hover:bg-[#0f1318]"
              onClick={() => closeMenu(onWatchlistOpen)}
              type="button"
            >
              <span className="flex items-center gap-3">
                <Bookmark size={18} />
                Watchlist
              </span>
              <span className="ml-auto flex items-center gap-2">
                {watchlistCount > 0 ? (
                  <span className="grid min-w-5 place-items-center rounded-full bg-[#3b91f6] px-1.5 text-xs text-white">
                    {watchlistCount}
                  </span>
                ) : null}
                <ChevronRight size={16} />
              </span>
            </button>
          </div>
        </div>
      ) : null}

      <nav className="mx-auto max-w-[1500px] overflow-hidden px-4 md:px-6 xl:px-8" aria-label="Primary market categories">
        <div className="flex gap-5 overflow-x-auto py-3 text-sm font-semibold text-[#8f9aa8] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {primaryNav.map((item, index) => {
            const isActive = isPrimaryNavActive(filters, item);

            return (
              <button
                className={`flex min-w-fit items-center gap-1.5 transition hover:text-[#edf1f5] ${
                  isActive ? "text-[#edf1f5]" : ""
                }`}
                aria-pressed={isActive}
                key={item.label}
                onClick={() => onPrimaryNavSelect(item)}
                type="button"
              >
                {index === 0 ? <TrendingUp size={18} /> : null}
                {item.label}
              </button>
            );
          })}
          <button
            className="flex min-w-fit items-center gap-1.5 transition hover:text-[#edf1f5]"
            onClick={onMoreMarketsOpen}
            type="button"
          >
            More
            <ChevronRight size={15} />
          </button>
        </div>
      </nav>
    </header>
  );
}

function isPrimaryNavActive(filters: MarketFilters, item: PrimaryNavItem) {
  if (item.filter.category) {
    return filters.category === item.filter.category;
  }

  if (item.filter.topic !== "all") {
    return filters.category === "" && filters.topic === item.filter.topic;
  }

  return filters.category === "" && filters.topic === "all" && filters.sort === item.filter.sort;
}

export function SectionTools() {
  return (
    <div className="flex items-center gap-2">
      <button className={iconButton} aria-label="Search">
        <Search size={22} />
      </button>
      <button className={iconButton} aria-label="Filters">
        <SlidersHorizontal size={22} />
      </button>
      <button className={iconButton} aria-label="Watchlist">
        <Bookmark size={22} />
      </button>
    </div>
  );
}
