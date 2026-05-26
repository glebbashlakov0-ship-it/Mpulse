import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  FileText,
  HelpCircle,
  Info,
  Languages,
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

const headerIconButton =
  "home-soft-button inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#7b8996] transition hover:bg-[#1e2428] hover:text-[#dee3e7] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0093fd]";

const sectionIconButton =
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
  const [isDarkMode, setIsDarkMode] = React.useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.localStorage.getItem("pulse-theme") !== "light";
  });
  const [isHowItWorksOpen, setIsHowItWorksOpen] = React.useState(false);
  const menuPanelRef = React.useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  React.useLayoutEffect(() => {
    const theme = isDarkMode ? "dark" : "light";

    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("pulse-theme", theme);
  }, [isDarkMode]);

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
    <nav
      aria-label="Main"
      className="sticky inset-x-0 top-0 z-40 box-border flex w-full flex-col overflow-visible bg-[#15191d]"
    >
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-[#242b32]" />
      <div className="z-[31] mx-auto flex min-h-[60px] w-full max-w-[1350px] items-center justify-between gap-4 px-4 pb-1 pt-3 md:min-h-[68px] md:pb-2 lg:px-6">
        <a
          className="flex h-10 w-fit shrink-0 cursor-pointer items-center gap-1 text-[#dee3e7] transition hover:text-white"
          href="/"
          aria-label="Pulse Market home"
        >
          <img
            className="h-[26px] w-auto max-w-[46px] object-contain px-1"
            src="/site-logo.png"
            alt=""
            aria-hidden="true"
          />
          <strong className="hidden text-[18px] font-semibold leading-none tracking-normal sm:block">
            Pulse Market
          </strong>
        </a>

        <div className="hidden w-full items-center gap-2 lg:flex">
          <form
            className="relative w-full min-w-[400px] max-w-[600px] p-0"
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7b8996]"
                size={18}
              />
              <kbd className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 text-[#586879] lg:block">
                /
              </kbd>
              <input
                className="flex h-10 w-full rounded-2xl border border-transparent bg-[var(--pm-surface-2)] py-1 pl-11 pr-9 text-sm font-medium text-[var(--pm-text-primary)] outline-none placeholder:text-[var(--pm-text-secondary)] transition-[box-shadow,background-color] duration-200 hover:bg-[var(--pm-surface-2)] focus:bg-[var(--pm-surface-2)] focus:ring-0"
                aria-label="Search markets"
                placeholder="Search markets..."
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
              />
            </div>
          </form>
        </div>

        <div className="shrink-0 md:min-w-fit" aria-label="Account links">
          <div className="flex min-w-0 items-center gap-x-2">
          {authStatus === "authenticated" && user ? null : (
            <button
              className="home-soft-button hidden h-9 items-center gap-2 rounded-xl px-2.5 text-sm font-semibold text-[#0093fd] transition hover:bg-[#1e2428] md:inline-flex"
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
                className="hidden h-11 flex-col items-center justify-center rounded-xl px-2.5 py-1 leading-[1.2] transition hover:bg-[#1e2428] md:flex"
                onClick={onPortfolioOpen}
                type="button"
              >
                <span className="whitespace-nowrap text-xs font-medium text-[#7b8996]">Portfolio</span>
                <span className="text-[17px] font-semibold leading-5 text-[#5fbe82]">$0.00</span>
              </button>
              <div className="hidden h-11 flex-col items-center justify-center rounded-xl px-2.5 py-1 leading-[1.2] transition hover:bg-[#1e2428] md:flex">
                <span className="whitespace-nowrap text-xs font-medium text-[#7b8996]">Cash</span>
                <span className="text-[17px] font-semibold leading-5 text-[#5fbe82]">$0.00</span>
              </div>
              <button
                className="home-soft-button hidden h-9 items-center justify-center rounded-xl bg-[#0093fd] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#26a3fd] md:inline-flex"
                onClick={() => onMenuNavigate("/wallet")}
                type="button"
              >
                Deposit
              </button>
              {user.role !== "user" ? (
                <button
                  className="home-soft-button hidden h-9 items-center gap-2 rounded-xl px-2.5 text-sm font-semibold text-[#0093fd] transition hover:bg-[#1e2428] xl:inline-flex"
                  onClick={onAdminOpen}
                  type="button"
                >
                  <ShieldCheck size={17} />
                  Admin
                </button>
              ) : null}
              <span className="hidden h-5 w-px bg-[#242b32] md:block" aria-hidden="true" />
              <button
                ref={menuTriggerRef}
                className="home-soft-button group flex h-9 min-w-0 cursor-pointer items-center rounded-full p-1.5 transition hover:bg-[#1e2428] focus:outline-none"
                aria-expanded={isMenuOpen}
                aria-haspopup="menu"
                aria-label="Open user menu"
                onClick={() => setIsMenuOpen((current) => !current)}
                type="button"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#2e3841] text-xs font-black uppercase text-[#dee3e7] ring-1 ring-white/5">
                  {getUserInitials(user.displayName, user.email)}
                </span>
                <ChevronDown
                  className={`ml-1 text-[#7b8996] transition-transform duration-200 ${
                    isMenuOpen ? "rotate-180" : ""
                  }`}
                  size={14}
                />
              </button>
            </>
          ) : (
            <>
              <button
                className="home-soft-button hidden h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[#0093fd] transition hover:bg-[#1e2428] md:inline-flex"
                onClick={onLoginOpen}
                type="button"
              >
                Log In
              </button>
              <button
                className="home-soft-button hidden h-9 items-center justify-center rounded-xl bg-[#0093fd] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#26a3fd] sm:inline-flex"
                onClick={onSignupOpen}
                type="button"
              >
                Sign Up
              </button>
            </>
          )}
          {authStatus === "authenticated" && user ? null : (
            <button
              ref={menuTriggerRef}
              className={`${headerIconButton} ${isMenuOpen ? "bg-[#242b32] text-[#dee3e7]" : ""}`}
              aria-label="Menu"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((current) => !current)}
              type="button"
            >
              <Menu size={22} />
            </button>
          )}
          </div>
        </div>
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
          className="absolute right-4 top-[64px] z-50 w-[min(328px,calc(100vw-32px))] md:right-6 md:top-[76px] xl:right-[max(1.5rem,calc((100vw-1350px)/2+1.5rem))]"
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
              <button
                className="home-soft-button flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-bold text-[#dee3e7] transition hover:bg-[#1e2428]"
                onClick={() => setIsDarkMode((current) => !current)}
                aria-pressed={isDarkMode}
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

      <div
        className="mx-auto flex w-full max-w-[1350px] min-w-0 overflow-x-auto px-4 lg:px-6"
        aria-label="Primary market categories"
      >
        <div className="relative w-full">
          <div className="pointer-events-none absolute bottom-1 left-0 top-1 z-[2] w-8 bg-gradient-to-r from-[#15191d] to-transparent opacity-0 transition-opacity duration-200 md:w-16" />
          <div className="flex h-12 w-full min-w-0 snap-x snap-mandatory scroll-px-3 items-center overflow-x-auto pl-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {primaryNav.map((item, index) => {
              const isActive = isPrimaryNavActive(filters, item);

              return (
                <React.Fragment key={item.label}>
                  {index === 3 ? (
                    <span
                      className="mx-2 hidden h-3.5 w-0.5 shrink-0 rounded-full bg-[#242b32] lg:flex"
                      aria-hidden="true"
                    />
                  ) : null}
                  <button
                    className={`inline-flex h-full min-w-fit cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-1 text-sm font-semibold tracking-[0] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0093fd] ${
                      isActive ? "text-[#dee3e7]" : "text-[#7b8996] hover:text-[#586879]"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                    aria-pressed={isActive}
                    onClick={() => onPrimaryNavSelect(item)}
                    type="button"
                  >
                    {index === 0 ? <TrendingUp size={18} /> : null}
                    {item.label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
          <div className="pointer-events-none absolute bottom-1 right-0 top-1 z-[2] w-8 bg-gradient-to-l from-[#15191d] to-transparent opacity-100 transition-opacity duration-200 md:w-16" />
        </div>
      </div>
    </nav>
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
      <button className={sectionIconButton} aria-label="Search">
        <Search size={22} />
      </button>
      <button className={sectionIconButton} aria-label="Filters">
        <SlidersHorizontal size={22} />
      </button>
      <button className={sectionIconButton} aria-label="Watchlist">
        <Bookmark size={22} />
      </button>
    </div>
  );
}
