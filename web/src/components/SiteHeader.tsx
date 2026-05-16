import {
  Bookmark,
  ChevronRight,
  CircleDollarSign,
  Info,
  LogIn,
  Menu,
  Moon,
  Plug,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
  TrendingUp,
  UserCircle,
  Wallet,
} from "lucide-react";
import * as React from "react";
import { primaryNav, type PrimaryNavItem } from "../lib/constants";
import type { AuthUser, MarketFilters } from "../lib/types";

const iconButton =
  "grid h-10 w-10 place-items-center rounded-2xl border border-[#293440] text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]";

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
  const [isDarkMode, setIsDarkMode] = React.useState(true);

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
          aria-label="Pulse Market home"
        >
          <img
            className="h-10 w-10 object-contain"
            src="/site-logo.png"
            alt=""
            aria-hidden="true"
          />
          <strong className="hidden text-xl font-semibold tracking-normal sm:block">
            Pulse Market
          </strong>
        </a>

        <div className="order-3 flex h-12 min-w-0 w-full items-center gap-3 rounded-2xl border border-[#293440] bg-[#171d24] px-4 text-[#8f9aa8] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:order-none sm:flex-1">
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
            className="hidden items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24] md:flex"
            href="#how-it-works"
          >
            <Info size={17} />
            How it works
          </a>
          {authStatus === "authenticated" && user ? (
            <>
              <button
                className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24]"
                onClick={onPortfolioOpen}
                type="button"
              >
                <Wallet size={18} />
                <span className="hidden sm:inline">Portfolio</span>
              </button>
              <button
                className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24]"
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
              {user.role !== "user" ? (
                <button
                  className="hidden items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24] md:flex"
                  onClick={onAdminOpen}
                  type="button"
                >
                  <ShieldCheck size={17} />
                  Admin
                </button>
              ) : null}
              <button
                className="flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#edf1f5] transition hover:bg-[#171d24]"
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
                className="hidden items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24] lg:flex"
                onClick={onLoginOpen}
                type="button"
              >
                <LogIn size={17} />
                Log In
              </button>
              <button
                className="hidden rounded-2xl bg-[#3b91f6] px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none sm:block"
                onClick={onSignupOpen}
                type="button"
              >
                {authStatus === "loading" ? "Checking..." : "Sign Up"}
              </button>
            </>
          )}
          <button
            className={`${iconButton} ${isMenuOpen ? "bg-[#20272f] text-[#edf1f5]" : ""}`}
            aria-label="Menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((current) => !current)}
            type="button"
          >
            <Menu size={25} />
          </button>
        </nav>
      </div>

      {isMenuOpen ? (
        <div className="absolute right-4 top-[72px] z-50 w-[min(480px,calc(100vw-32px))] md:right-6 xl:right-[max(2rem,calc((100vw-1500px)/2+2rem))]">
          <div className="overflow-hidden rounded-[28px] border border-[#293440] bg-[#11161c] shadow-[0_24px_70px_rgba(0,0,0,0.42)]">
            {authStatus === "authenticated" && user ? (
              <div className="border-b border-[#293440] p-4">
                <button
                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-[#0f1318] px-5 py-4 text-left text-lg font-bold text-[#edf1f5] transition hover:bg-[#1d252e]"
                  onClick={() => closeMenu(onProfileOpen)}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <UserCircle size={18} />
                    <span className="truncate">{user.displayName}</span>
                  </span>
                  <ChevronRight size={16} />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_1fr] gap-3 border-b border-[#293440] p-4">
                <button
                  className="rounded-2xl px-5 py-4 text-center text-xl font-bold text-[#3b91f6] transition hover:bg-[#171d24]"
                  onClick={() => closeMenu(onLoginOpen)}
                  type="button"
                >
                  Log In
                </button>
                <button
                  className="rounded-2xl bg-[#3b91f6] px-5 py-4 text-center text-xl font-bold text-white shadow-[0_4px_0_rgba(36,98,174,0.75)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none"
                  onClick={() => closeMenu(onSignupOpen)}
                  type="button"
                >
                  Sign Up
                </button>
              </div>
            )}

            <div className="space-y-1 p-6">
              {authStatus === "authenticated" && user ? (
                <>
                  <MenuRow icon={<Wallet size={25} />} label="Portfolio" onClick={() => closeMenu(onPortfolioOpen)} />
                  <MenuRow
                    badge={watchlistCount > 0 ? watchlistCount : undefined}
                    icon={<Bookmark size={25} />}
                    label="Watchlist"
                    onClick={() => closeMenu(onWatchlistOpen)}
                  />
                  {user.role !== "user" ? (
                    <MenuRow icon={<ShieldCheck size={25} />} label="Admin" onClick={() => closeMenu(onAdminOpen)} />
                  ) : null}
                </>
              ) : null}
              <MenuRow icon={<Trophy className="text-yellow-400" size={26} />} label="Leaderboard" />
              <MenuRow icon={<CircleDollarSign className="text-emerald-400" size={26} />} label="Rewards" />
              <MenuRow icon={<Plug className="text-pink-500" size={26} />} label="APIs" />
              <button
                className="flex w-full items-center gap-5 rounded-2xl px-5 py-4 text-left text-xl font-bold text-[#edf1f5] transition hover:bg-[#171d24]"
                onClick={() => setIsDarkMode((current) => !current)}
                type="button"
              >
                <Moon className="text-[#3b91f6]" size={27} />
                <span className="flex-1">Dark mode</span>
                <span
                  className={`flex h-9 w-16 items-center rounded-full p-1 transition ${
                    isDarkMode ? "justify-end bg-[#1da1ff]" : "justify-start bg-[#293440]"
                  }`}
                  aria-hidden="true"
                >
                  <span className="size-7 rounded-full bg-white" />
                </span>
              </button>
            </div>

            <div className="border-t border-[#293440] p-6">
              <div className="space-y-1">
                <MenuRow muted label="Accuracy" />
                <MenuRow muted label="Documentation" />
                <MenuRow muted label="Help Center" />
                <MenuRow muted label="Terms of Use" />
                <MenuRow muted label="🇪🇸 Idioma" trailing />
              </div>
            </div>
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

function MenuRow({
  badge,
  icon,
  label,
  muted = false,
  onClick,
  trailing = false,
}: {
  badge?: number;
  icon?: React.ReactNode;
  label: string;
  muted?: boolean;
  onClick?: () => void;
  trailing?: boolean;
}) {
  return (
    <button
      className={`flex w-full items-center gap-5 rounded-2xl px-5 py-4 text-left text-xl font-bold transition hover:bg-[#171d24] ${
        muted ? "text-[#8f9aa8]" : "text-[#edf1f5]"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon ? <span className="grid size-8 place-items-center">{icon}</span> : null}
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="grid min-w-6 place-items-center rounded-full bg-[#3b91f6] px-1.5 text-xs text-white">
          {badge}
        </span>
      ) : null}
      {trailing ? <ChevronRight size={24} /> : null}
    </button>
  );
}

function isPrimaryNavActive(filters: MarketFilters, item: PrimaryNavItem) {
  if ((item.filter.search ?? "") !== filters.search) {
    return false;
  }

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
