import {
  Bookmark,
  ChevronRight,
  CircleDollarSign,
  FileText,
  HelpCircle,
  Info,
  Languages,
  LogIn,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import * as React from "react";
import { HowItWorksModal } from "./HowItWorksModal";
import { primaryNav, type PrimaryNavItem } from "../lib/constants";
import type { AuthUser, MarketFilters } from "../lib/types";

const iconButton =
  "home-soft-button grid h-10 w-10 place-items-center rounded-2xl border border-[#242b32] text-[#7b8996] transition hover:border-[#0093fd]/50 hover:text-[#dee3e7]";

export function SiteHeader({
  query,
  filters,
  authStatus,
  user,
  onQueryChange,
  onPortfolioOpen,
  onLoginOpen,
  onSignupOpen,
  onProfileOpen,
  onAdminOpen,
  onMenuNavigate,
  onPrimaryNavSelect,
}: {
  query: string;
  filters: MarketFilters;
  authStatus: "loading" | "guest" | "authenticated" | "error";
  user: AuthUser | null;
  onQueryChange: (query: string) => void;
  onPortfolioOpen: () => void;
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
  const menuPanelRef = React.useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    function closeMenuOnOutsidePointer(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (
        menuPanelRef.current?.contains(event.target) ||
        menuTriggerRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeMenuOnOutsidePointer);

    return () => {
      document.removeEventListener("pointerdown", closeMenuOnOutsidePointer);
    };
  }, [isMenuOpen]);

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
    <header className="sticky top-0 z-40 border-b border-[#242b32]/80 bg-[#15191d]/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap md:px-6 xl:px-8">
        <a
          className="flex min-w-fit items-center gap-3 text-[#dee3e7] transition hover:text-white"
          href="/"
          aria-label="Pulse Market home"
        >
          <img
            className="h-5 w-10 object-contain"
            src="/site-logo.png"
            alt=""
            aria-hidden="true"
          />
          <strong className="hidden text-xl font-semibold tracking-normal sm:block">
            Pulse Market
          </strong>
        </a>

        <div className="order-3 flex h-12 min-w-0 w-full items-center gap-3 rounded-2xl border border-[#242b32] bg-[#1e2428] px-4 text-[#7b8996] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:order-none sm:flex-1 sm:basis-[320px] lg:max-w-[420px] xl:max-w-[480px]">
          <Search size={21} />
          <input
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[#dee3e7] outline-none placeholder:text-[#7b8996]"
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
              className="home-soft-button hidden items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#0093fd] transition hover:bg-[#1e2428] md:flex"
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
                <span className="block text-sm font-semibold leading-none text-[#7b8996]">Portfolio</span>
                <span className="mt-1 block text-base font-bold leading-none text-[#5fbe82]">$0.00</span>
              </button>
              <div className="hidden text-left lg:block">
                <span className="block text-sm font-semibold leading-none text-[#7b8996]">Cash</span>
                <span className="mt-1 block text-base font-bold leading-none text-[#5fbe82]">$0.00</span>
              </div>
              <button
                className="home-soft-button hidden h-10 rounded-xl bg-[#0093fd] px-4 text-sm font-bold text-white transition hover:bg-[#26a3fd] md:block"
                onClick={() => onMenuNavigate("/wallet")}
                type="button"
              >
                Deposit
              </button>
              {user.role !== "user" ? (
                <button
                  className="home-soft-button hidden items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#0093fd] transition hover:bg-[#1e2428] xl:flex"
                  onClick={onAdminOpen}
                  type="button"
                >
                  <ShieldCheck size={17} />
                  Admin
                </button>
              ) : null}
              <span className="hidden h-8 w-px bg-[#242b32] md:block" aria-hidden="true" />
              <button
                ref={menuTriggerRef}
                className="home-soft-button group flex min-w-0 items-center gap-2 rounded-full border border-[#242b32] bg-[#1e2428] py-1 pl-1 pr-2.5 text-sm font-semibold text-[#dee3e7] transition hover:border-[#0093fd]/50 hover:bg-[#2e3841]"
                aria-expanded={isMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsMenuOpen((current) => !current)}
                type="button"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#2e3841] text-xs font-black uppercase text-[#dee3e7] ring-1 ring-white/5 transition group-hover:bg-[#2e3841]">
                  {getUserInitials(user.displayName, user.email)}
                </span>
                <span className="hidden max-w-20 truncate lg:inline xl:max-w-28">{user.displayName}</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="home-soft-button hidden items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-[#0093fd] transition hover:bg-[#1e2428] lg:flex"
                onClick={onLoginOpen}
                type="button"
              >
                <LogIn size={17} />
                Log In
              </button>
              <button
                className="home-soft-button hidden rounded-2xl bg-[#0093fd] px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_0_rgba(0,0,0,0.28)] transition hover:bg-[#26a3fd] sm:block"
                onClick={onSignupOpen}
                type="button"
              >
                {authStatus === "loading" ? "Checking..." : "Sign Up"}
              </button>
            </>
          )}
          {authStatus === "authenticated" && user ? null : (
            <button
              ref={menuTriggerRef}
              className={`${iconButton} ${isMenuOpen ? "bg-[#242b32] text-[#dee3e7]" : ""}`}
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
        <div
          ref={menuPanelRef}
          className="absolute right-4 top-[72px] z-50 w-[min(328px,calc(100vw-32px))] md:right-6 xl:right-[max(2rem,calc((100vw-1500px)/2+2rem))]"
        >
          <div className="app-menu-enter max-h-[calc(100vh-88px)] overflow-y-auto rounded-[18px] border border-[#242b32] bg-[#181d21] shadow-[0_18px_48px_rgba(0,0,0,0.42)]">
            {authStatus === "authenticated" && user ? (
              <div className="border-b border-[#242b32] p-2.5">
                <button
                  className="home-soft-button flex w-full min-w-0 items-center gap-2.5 rounded-xl bg-[#15191d] px-2.5 py-2 text-left transition hover:bg-[#2e3841]"
                  onClick={() => closeMenu(onProfileOpen)}
                  type="button"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#2e3841] text-xs font-black uppercase text-[#dee3e7] ring-1 ring-white/5">
                    {getUserInitials(user.displayName, user.email)}
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="shrink-0 text-sm font-bold text-[#dee3e7]">
                      {user.displayName}
                    </span>
                    <span className="min-w-0 truncate text-xs font-semibold text-[#7b8996]">
                      {user.email}
                    </span>
                  </span>
                  <Settings className="shrink-0 text-[#7b8996]" size={19} />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_1fr] gap-2 border-b border-[#242b32] p-2.5">
                <button
                  className="home-soft-button rounded-xl px-2.5 py-2 text-center text-sm font-bold text-[#0093fd] transition hover:bg-[#1e2428]"
                  onClick={() => closeMenu(onLoginOpen)}
                  type="button"
                >
                  Log In
                </button>
                <button
                  className="home-soft-button rounded-xl bg-[#0093fd] px-2.5 py-2 text-center text-sm font-bold text-white shadow-[0_3px_0_rgba(0,0,0,0.28)] transition hover:bg-[#26a3fd]"
                  onClick={() => closeMenu(onSignupOpen)}
                  type="button"
                >
                  Sign Up
                </button>
              </div>
            )}

            <div className="space-y-0.5 p-2.5">
              <MenuRow
                icon={<CircleDollarSign className="text-emerald-400" size={18} />}
                label="Rewards"
                onClick={() => goFromMenu("/rewards")}
              />
              <button
                className="home-soft-button flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-bold text-[#dee3e7] transition hover:bg-[#1e2428]"
                onClick={() => setIsDarkMode((current) => !current)}
                type="button"
              >
                <Moon className="text-[#0093fd]" size={18} />
                <span className="flex-1">Dark mode</span>
                <span
                  className={`flex h-5 w-9 items-center rounded-full p-0.5 transition ${
                    isDarkMode ? "justify-end bg-[#0093fd]" : "justify-start bg-[#242b32]"
                  }`}
                  aria-hidden="true"
                >
                  <span className="size-4 rounded-full bg-white" />
                </span>
              </button>
            </div>

            <div className="border-t border-[#242b32] p-2.5">
              <div className="space-y-0.5">
                <MenuRow
                  icon={<HelpCircle size={18} />}
                  label="Help Center"
                  muted
                  onClick={() => goFromMenu("/#help")}
                />
                <MenuRow
                  icon={<FileText size={18} />}
                  label="Terms of Use"
                  muted
                  onClick={() => goFromMenu("/#terms")}
                />
                <MenuRow
                  icon={<FileText size={18} />}
                  label="Privacy Policy"
                  muted
                  onClick={() => goFromMenu("/#privacy")}
                />
                <MenuRow
                  icon={<Languages size={18} />}
                  label="Idioma"
                  muted
                  trailing
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="mx-auto max-w-[1500px] px-4 md:px-6 xl:px-8" aria-label="Primary market categories">
        <div className="-mx-1 flex gap-5 overflow-x-auto px-1 py-2 text-sm font-semibold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {primaryNav.map((item, index) => {
            const isActive = isPrimaryNavActive(filters, item);

            return (
              <button
                className={`relative flex min-w-fit items-center gap-1.5 bg-transparent py-1 leading-5 transition-colors duration-150 hover:text-[#dee3e7] focus-visible:outline-none focus-visible:text-[#dee3e7] ${
                  isActive
                    ? "text-[#dee3e7]"
                    : "text-[#7b8996]"
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
      className={`home-soft-button flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-bold transition hover:bg-[#1e2428] ${
        muted ? "text-[#7b8996]" : "text-[#dee3e7]"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon ? <span className="grid size-5 place-items-center">{icon}</span> : null}
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="grid min-w-4 place-items-center rounded-full bg-[#0093fd] px-1 text-[10px] text-white">
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
