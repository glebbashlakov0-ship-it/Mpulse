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
import { HowItWorksModal } from "./HowItWorksModal";
import { primaryNav, type PrimaryNavItem } from "../lib/constants";
import type { AuthUser, MarketFilters } from "../lib/types";

const iconButton =
  "home-soft-button grid h-10 w-10 place-items-center rounded-2xl border border-[#293440] text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]";
const headerIconButton =
  "home-soft-button relative grid h-10 w-10 place-items-center rounded-full text-[#8f9aa8] transition hover:bg-[#171d24] hover:text-[#edf1f5]";

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
  onMenuNavigate,
  onPrimaryNavSelect,
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
  onMenuNavigate: (to: string) => void;
  onPrimaryNavSelect: (item: PrimaryNavItem) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [isDarkMode, setIsDarkMode] = React.useState(true);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = React.useState(false);

  function closeMenu(action: () => void) {
    setIsMenuOpen(false);
    action();
  }

  function getStartedFromHowItWorks() {
    setIsHowItWorksOpen(false);
    if (!user) {
      onSignupOpen();
    }
  }

  function goFromMenu(to: string) {
    closeMenu(() => onMenuNavigate(to));
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

        <div className="order-3 flex h-12 min-w-0 w-full items-center gap-3 rounded-2xl border border-[#293440] bg-[#171d24] px-4 text-[#8f9aa8] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:order-none sm:flex-1 sm:basis-[320px] lg:max-w-[420px] xl:max-w-[480px]">
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

        <nav className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5" aria-label="Account links">
          {authStatus === "authenticated" && user ? null : (
            <button
              className="home-soft-button hidden items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24] md:flex"
              onClick={() => setIsHowItWorksOpen(true)}
              type="button"
            >
              <Info size={17} />
              How it works
            </button>
          )}
          {authStatus === "authenticated" && user ? (
            <>
              <button
                className="hidden text-left transition hover:opacity-90 lg:block"
                onClick={onPortfolioOpen}
                type="button"
              >
                <span className="block text-sm font-semibold leading-none text-[#8f9aa8]">Portfolio</span>
                <span className="mt-1 block text-base font-bold leading-none text-[#48d67a]">$0.00</span>
              </button>
              <div className="hidden text-left lg:block">
                <span className="block text-sm font-semibold leading-none text-[#8f9aa8]">Cash</span>
                <span className="mt-1 block text-base font-bold leading-none text-[#48d67a]">$0.00</span>
              </div>
              <button
                className="home-soft-button hidden h-10 rounded-xl bg-[#12639c] px-4 text-sm font-bold text-white transition hover:bg-[#1878bb] active:translate-y-0.5 md:block"
                onClick={() => onMenuNavigate("/wallet")}
                type="button"
              >
                Deposit
              </button>
              <button
                aria-label="Open watchlist"
                className={headerIconButton}
                onClick={onWatchlistOpen}
                type="button"
              >
                <Bookmark size={21} />
                {watchlistCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-[#3b91f6] px-1 text-[10px] font-bold text-white">
                    {watchlistCount > 99 ? "99+" : watchlistCount}
                  </span>
                ) : null}
              </button>
              {user.role !== "user" ? (
                <button
                  className="home-soft-button hidden items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24] xl:flex"
                  onClick={onAdminOpen}
                  type="button"
                >
                  <ShieldCheck size={17} />
                  Admin
                </button>
              ) : null}
              <span className="hidden h-8 w-px bg-[#293440] md:block" aria-hidden="true" />
              <button
                className="home-soft-button group flex min-w-0 items-center gap-2 rounded-full border border-[#293440] bg-[#171d24] py-1 pl-1 pr-2.5 text-sm font-semibold text-[#edf1f5] transition hover:border-[#3b91f6]/50 hover:bg-[#1d252e]"
                onClick={onProfileOpen}
                type="button"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#29313a] text-xs font-black uppercase text-[#edf1f5] ring-1 ring-white/5 transition group-hover:bg-[#334050]">
                  {getUserInitials(user.displayName, user.email)}
                </span>
                <span className="hidden max-w-20 truncate lg:inline xl:max-w-28">{user.displayName}</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="home-soft-button hidden items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#3b91f6] transition hover:bg-[#171d24] lg:flex"
                onClick={onLoginOpen}
                type="button"
              >
                <LogIn size={17} />
                Log In
              </button>
              <button
                className="home-soft-button hidden rounded-2xl bg-[#3b91f6] px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none sm:block"
                onClick={onSignupOpen}
                type="button"
              >
                {authStatus === "loading" ? "Checking..." : "Sign Up"}
              </button>
            </>
          )}
          {authStatus === "authenticated" && user ? null : (
            <button
              className={`${iconButton} ${isMenuOpen ? "bg-[#20272f] text-[#edf1f5]" : ""}`}
              aria-label="Menu"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((current) => !current)}
              type="button"
            >
              <Menu size={25} />
            </button>
          )}
        </nav>
      </div>

      {isHowItWorksOpen ? (
        <HowItWorksModal
          onClose={() => setIsHowItWorksOpen(false)}
          onGetStarted={getStartedFromHowItWorks}
        />
      ) : null}

      {isMenuOpen ? (
        <div className="absolute right-4 top-[72px] z-50 w-[min(300px,calc(100vw-32px))] md:right-6 xl:right-[max(2rem,calc((100vw-1500px)/2+2rem))]">
          <div className="app-menu-enter max-h-[calc(100vh-88px)] overflow-y-auto rounded-[18px] border border-[#293440] bg-[#11161c] shadow-[0_18px_48px_rgba(0,0,0,0.42)]">
            {authStatus === "authenticated" && user ? (
              <div className="border-b border-[#293440] p-2.5">
                <button
                  className="home-soft-button flex w-full items-center justify-between gap-2.5 rounded-xl bg-[#0f1318] px-2.5 py-2 text-left text-sm font-bold text-[#edf1f5] transition hover:bg-[#1d252e]"
                  onClick={() => closeMenu(onProfileOpen)}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <UserCircle size={15} />
                    <span className="truncate">{user.displayName}</span>
                  </span>
                  <ChevronRight size={14} />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_1fr] gap-2 border-b border-[#293440] p-2.5">
                <button
                  className="home-soft-button rounded-xl px-2.5 py-2 text-center text-sm font-bold text-[#3b91f6] transition hover:bg-[#171d24]"
                  onClick={() => closeMenu(onLoginOpen)}
                  type="button"
                >
                  Log In
                </button>
                <button
                  className="home-soft-button rounded-xl bg-[#3b91f6] px-2.5 py-2 text-center text-sm font-bold text-white shadow-[0_3px_0_rgba(36,98,174,0.75)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none"
                  onClick={() => closeMenu(onSignupOpen)}
                  type="button"
                >
                  Sign Up
                </button>
              </div>
            )}

            <div className="space-y-0.5 p-2.5">
              {authStatus === "authenticated" && user ? (
                <>
                  <MenuRow icon={<Wallet size={18} />} label="Portfolio" onClick={() => closeMenu(onPortfolioOpen)} />
                  <MenuRow
                    badge={watchlistCount > 0 ? watchlistCount : undefined}
                    icon={<Bookmark size={18} />}
                    label="Watchlist"
                    onClick={() => closeMenu(onWatchlistOpen)}
                  />
                  {user.role !== "user" ? (
                    <MenuRow icon={<ShieldCheck size={18} />} label="Admin" onClick={() => closeMenu(onAdminOpen)} />
                  ) : null}
                </>
              ) : null}
              <MenuRow
                icon={<Trophy className="text-yellow-400" size={18} />}
                label="Leaderboard"
                onClick={() => goFromMenu("/markets?sort=volume")}
              />
              <MenuRow
                icon={<CircleDollarSign className="text-emerald-400" size={18} />}
                label="Rewards"
                onClick={() => goFromMenu("/markets?search=rewards")}
              />
              <MenuRow
                icon={<Plug className="text-pink-500" size={18} />}
                label="APIs"
                onClick={() => goFromMenu("/#docs")}
              />
              <button
                className="home-soft-button flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-bold text-[#edf1f5] transition hover:bg-[#171d24]"
                onClick={() => setIsDarkMode((current) => !current)}
                type="button"
              >
                <Moon className="text-[#3b91f6]" size={18} />
                <span className="flex-1">Dark mode</span>
                <span
                  className={`flex h-5 w-9 items-center rounded-full p-0.5 transition ${
                    isDarkMode ? "justify-end bg-[#1da1ff]" : "justify-start bg-[#293440]"
                  }`}
                  aria-hidden="true"
                >
                  <span className="size-4 rounded-full bg-white" />
                </span>
              </button>
            </div>

            <div className="border-t border-[#293440] p-2.5">
              <div className="space-y-0.5">
                <MenuRow muted label="Accuracy" onClick={() => goFromMenu("/markets?sort=trending")} />
                <MenuRow muted label="Documentation" onClick={() => goFromMenu("/#docs")} />
                <MenuRow muted label="Help Center" onClick={() => goFromMenu("/#help")} />
                <MenuRow muted label="Terms of Use" onClick={() => goFromMenu("/#terms")} />
                <MenuRow muted label="🇪🇸 Idioma" trailing />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="mx-auto max-w-[1500px] overflow-hidden px-4 md:px-6 xl:px-8" aria-label="Primary market categories">
        <div className="flex gap-5 overflow-x-auto py-3 text-sm font-semibold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {primaryNav.map((item, index) => {
            const isActive = isPrimaryNavActive(filters, item);

            return (
              <button
                className={`relative flex min-w-fit items-center gap-1.5 bg-transparent p-0 pb-1 transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-[#3b91f6] after:transition-opacity after:duration-150 hover:text-[#edf1f5] focus-visible:outline-none focus-visible:text-[#56a3ff] ${
                  isActive
                    ? "text-[#56a3ff] drop-shadow-[0_0_10px_rgba(59,145,246,0.45)] after:opacity-100"
                    : "text-[#8f9aa8] after:opacity-0"
                }`}
                aria-current={isActive ? "page" : undefined}
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
      className={`home-soft-button flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-bold transition hover:bg-[#171d24] ${
        muted ? "text-[#8f9aa8]" : "text-[#edf1f5]"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon ? <span className="grid size-5 place-items-center">{icon}</span> : null}
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="grid min-w-4 place-items-center rounded-full bg-[#3b91f6] px-1 text-[10px] text-white">
          {badge}
        </span>
      ) : null}
      {trailing ? <ChevronRight size={16} /> : null}
    </button>
  );
}

function getUserInitials(displayName: string, email: string) {
  const source = displayName.trim() || email.split("@")[0] || "PM";
  const parts = source
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const initials =
    parts.length > 1
      ? `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`
      : `${source[0] ?? "P"}${source[1] ?? "M"}`;

  return initials.toUpperCase();
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
