import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Bookmark,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CloudRain,
  Grid2X2,
  Radio,
  Search,
  SlidersHorizontal,
  Trophy,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { MarketCard } from "../components/MarketCard";
import { MarketImage } from "../components/MarketMedia";
import { MarketSkeleton } from "../components/MarketSkeleton";
import { useMarkets } from "../hooks/useMarkets";
import { useCategories } from "../hooks/useCategories";
import { useMarketTags } from "../hooks/useMarketTags";
import { formatCents, formatMoney, formatPercent, formatShortDate } from "../lib/format";
import {
  buildTopicTabsFromTags,
  defaultMarketFilters,
  getDiscoveryUrl,
  getFiltersFromUrl,
  mergeDiscoveryFilters,
  sortOptions,
  topicTabs,
  type TopicTab,
} from "../lib/discovery";
import type { AuthUser, Market, MarketFilters } from "../lib/types";

type HiddenMarketFilter = "sports" | "crypto" | "earnings";
type DiscoverySurface =
  | "trending"
  | "breaking"
  | "new"
  | "politics"
  | "sports"
  | "crypto"
  | "esports"
  | "iran"
  | "finance"
  | "geopolitics"
  | "tech"
  | "culture"
  | "economy"
  | "weather"
  | "mentions"
  | "elections";

type SurfaceSidebarItem = {
  label: string;
  search?: string;
  count?: number;
  icon?: React.ReactNode;
};

type MiniOutcomeRow = {
  label: string;
  yesPrice: number | null;
  noPrice: number | null;
};

export function HomePage({
  user,
  watchlistIds,
  onWatchlistToggle,
  onSignupPrompt,
}: {
  user: AuthUser | null;
  watchlistIds: Set<string>;
  onWatchlistToggle: (market: Market) => void;
  onSignupPrompt: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ category?: string; topic?: string }>();
  const [searchParams] = useSearchParams();
  const filters = React.useMemo(
    () =>
      getFiltersFromUrl({
        searchParams,
        category: params.category,
        topic: params.topic,
      }),
    [params.category, params.topic, searchParams],
  );
  const surface = React.useMemo(() => getDiscoverySurface(filters), [filters]);
  const [showFilters, setShowFilters] = React.useState(false);
  const [topicRailCanScrollRight, setTopicRailCanScrollRight] = React.useState(false);
  const topicTabsRef = React.useRef<HTMLDivElement | null>(null);
  const [hiddenMarketFilters, setHiddenMarketFilters] = React.useState<
    Record<HiddenMarketFilter, boolean>
  >({
    sports: false,
    crypto: false,
    earnings: false,
  });
  const [marketsState, , loadMore] = useMarkets(filters);
  const categoriesState = useCategories();
  const tagsState = useMarketTags();

  const markets = marketsState.data;
  const loading = marketsState.status === "loading";
  const error = marketsState.message;
  const categories = categoriesState.data;
  const selectedSortLabel = getSortOptionLabel(filters.sort);
  const selectedCategoryLabel =
    categories.find((category) => category.slug === filters.category)?.label ?? t("markets.all");
  const selectedStatusLabel = getStatusOptionLabel(filters.status, {
    all: t("markets.all"),
    closed: t("markets.closed"),
  });
  const discoveryTopicTabs = React.useMemo(
    () => (tagsState.data.length > 0 ? buildTopicTabsFromTags(tagsState.data) : topicTabs),
    [tagsState.data],
  );

  const updateFilter = <K extends keyof MarketFilters>(
    key: K,
    value: MarketFilters[K],
  ) => {
    const nextFilters = mergeDiscoveryFilters(filters, { [key]: value });
    navigate(getDiscoveryUrl(nextFilters));
  };

  const visibleMarkets = React.useMemo(
    () => markets.filter((market) => !isHiddenByCompactFilter(market, hiddenMarketFilters)),
    [hiddenMarketFilters, markets],
  );

  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) =>
      value !== "" &&
      value !== "all" &&
      value !== defaultMarketFilters[key as keyof MarketFilters],
  ).length + Object.values(hiddenMarketFilters).filter(Boolean).length;
  const hasMore = marketsState.nextOffset !== null;
  const showTopicRail = surface === "trending" || surface === "new";
  const showPageHeader = !["breaking", "sports", "esports", "mentions", "weather"].includes(surface);
  const updateTopicRailScrollState = React.useCallback(() => {
    const rail = topicTabsRef.current;

    if (!rail) {
      setTopicRailCanScrollRight(false);
      return;
    }

    const remainingScroll = rail.scrollWidth - rail.clientWidth - rail.scrollLeft;
    setTopicRailCanScrollRight(remainingScroll > 2);
  }, []);
  const handleLoadMore = React.useCallback(() => {
    if (!user) {
      onSignupPrompt();
      return;
    }

    void loadMore();
  }, [loadMore, onSignupPrompt, user]);
  React.useEffect(() => {
    if (!showTopicRail) {
      setTopicRailCanScrollRight(false);
      return undefined;
    }

    const rail = topicTabsRef.current;
    if (!rail) {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(updateTopicRailScrollState);
    rail.addEventListener("scroll", updateTopicRailScrollState, { passive: true });
    window.addEventListener("resize", updateTopicRailScrollState);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      rail.removeEventListener("scroll", updateTopicRailScrollState);
      window.removeEventListener("resize", updateTopicRailScrollState);
    };
  }, [discoveryTopicTabs.length, showTopicRail, updateTopicRailScrollState]);
  const scrollTopicTabs = () => {
    topicTabsRef.current?.scrollBy({
      left: Math.round(topicTabsRef.current.clientWidth * 0.82),
      behavior: "smooth",
    });
  };

  return (
    <div className="home-page-shell min-h-screen bg-[#0f1318] text-[#edf1f5]">
      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
        {showPageHeader ? (
          <section className="home-reveal space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-normal text-[#edf1f5]">
                  {getSurfaceTitle(surface)}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <IconButton
                  label="Search markets"
                  onClick={() =>
                    document
                      .querySelector<HTMLInputElement>('input[aria-label="Search markets"]')
                      ?.focus()
                  }
                >
                  <Search size={21} />
                </IconButton>
                <IconButton
                  label={t("markets.filters")}
                  pressed={showFilters}
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <SlidersHorizontal size={21} />
                  {activeFilterCount > 0 ? (
                    <span className="pointer-events-none absolute -right-0.5 -top-0.5 z-20 grid h-3.5 min-w-3.5 place-items-center rounded-full border border-[#0f1318] bg-[#3b91f6] px-0.5 text-[9px] font-black leading-none text-white shadow-[0_0_8px_rgba(59,145,246,0.6)]">
                      {activeFilterCount > 9 ? "9+" : activeFilterCount}
                    </span>
                  ) : null}
                </IconButton>
                {user ? (
                  <IconButton label="Watchlist" onClick={() => navigate("/watchlist")}>
                    <Bookmark size={21} />
                  </IconButton>
                ) : null}
              </div>
            </div>

            {showTopicRail ? (
              <div className="home-reveal relative isolate">
                <div
                  className="relative z-20 flex gap-5 overflow-x-auto pb-2 pr-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  ref={topicTabsRef}
                >
                  {discoveryTopicTabs.map((tab) => {
                    const isActive = isTopicTabActive(filters, tab);

                    return (
                      <button
                        key={tab.value}
                        onClick={() =>
                          navigate(getDiscoveryUrl(mergeDiscoveryFilters(filters, tab.filter)))
                        }
                        aria-current={isActive ? "page" : undefined}
                        aria-pressed={isActive}
                        className={`relative min-w-fit whitespace-nowrap bg-transparent p-0 pb-1 text-sm font-semibold transition-colors duration-150 after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-[#3b91f6] after:transition-opacity after:duration-150 hover:text-[#edf1f5] focus-visible:outline-none focus-visible:text-[#56a3ff] ${
                          isActive
                            ? "home-topic-active after:opacity-100"
                            : "text-[#8f9aa8] after:opacity-0"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                {topicRailCanScrollRight ? (
                  <>
                    <div className="pointer-events-none absolute right-0 top-0 z-10 h-6 w-16 bg-gradient-to-l from-[#0f1318] via-[#0f1318]/90 to-transparent" />
                    <button
                      aria-label="Scroll market topics"
                      className="home-soft-button absolute right-0 top-0 z-30 grid h-6 w-6 place-items-center rounded-full bg-transparent text-[#8f9aa8] transition hover:text-[#56a3ff]"
                      onClick={scrollTopicTabs}
                      type="button"
                    >
                      <ChevronRight size={21} />
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {showFilters && (
              <div
                className="home-filter-panel flex flex-wrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <CompactSelect
                  ariaLabel={t("markets.sort")}
                  icon={<TrendingUp size={18} />}
                  displayValue={selectedSortLabel}
                  value={filters.sort}
                  onChange={(value) => updateFilter("sort", value as MarketFilters["sort"])}
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {getSortOptionLabel(option.value)}
                    </option>
                  ))}
                </CompactSelect>

                <CompactSelect
                  ariaLabel={t("markets.category")}
                  displayValue={selectedCategoryLabel}
                  value={filters.category}
                  onChange={(value) => updateFilter("category", value)}
                >
                  <option value="">{t("markets.all")}</option>
                  {categories.map((category) => (
                    <option key={category.slug} value={category.slug}>
                      {category.label}
                    </option>
                  ))}
                </CompactSelect>

                <CompactSelect
                  ariaLabel={t("markets.status")}
                  displayValue={selectedStatusLabel}
                  value={filters.status}
                  onChange={(value) => updateFilter("status", value as MarketFilters["status"])}
                >
                  <option value="live">Active</option>
                  <option value="all">{t("markets.all")}</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="closed">{t("markets.closed")}</option>
                  <option value="expired">Expired</option>
                </CompactSelect>

                <HideToggle
                  label="Hide sports"
                  checked={hiddenMarketFilters.sports}
                  onChange={(checked) =>
                    setHiddenMarketFilters((current) => ({ ...current, sports: checked }))
                  }
                />
                <HideToggle
                  label="Hide crypto"
                  checked={hiddenMarketFilters.crypto}
                  onChange={(checked) =>
                    setHiddenMarketFilters((current) => ({ ...current, crypto: checked }))
                  }
                />
                <HideToggle
                  label="Hide earnings"
                  checked={hiddenMarketFilters.earnings}
                  onChange={(checked) =>
                    setHiddenMarketFilters((current) => ({ ...current, earnings: checked }))
                  }
                />
              </div>
            )}
          </section>
        ) : null}

        {error && (
          <div className="home-reveal mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            {error}
          </div>
        )}

        {loading && markets.length === 0 ? (
          <div className="home-reveal mt-5">
            <MarketSkeleton />
          </div>
        ) : visibleMarkets.length === 0 ? (
          <div className="home-reveal mt-5 rounded-2xl border border-[#293440] bg-[#11161c] p-12 text-center">
            <p className="text-[#8f9aa8]">
              {t("markets.noResults")}
            </p>
          </div>
        ) : (
          <div className="home-surface-enter" key={getHomeSurfaceMotionKey(surface, filters)}>
            <MarketSurface
              filters={filters}
              hasMore={hasMore}
              isLoadingMore={marketsState.isLoadingMore}
              markets={visibleMarkets}
              onLoadMore={handleLoadMore}
              onOpenMarket={(market) => navigate(`/markets/${market.id}`)}
              onWatchlistToggle={user ? onWatchlistToggle : undefined}
              surface={surface}
              total={marketsState.total}
              watchlistIds={watchlistIds}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function MarketSurface({
  filters,
  hasMore,
  isLoadingMore,
  markets,
  onLoadMore,
  onOpenMarket,
  onWatchlistToggle,
  surface,
  total,
  watchlistIds,
}: {
  filters: MarketFilters;
  hasMore: boolean;
  isLoadingMore: boolean;
  markets: Market[];
  onLoadMore: () => void;
  onOpenMarket: (market: Market) => void;
  onWatchlistToggle?: (market: Market) => void;
  surface: DiscoverySurface;
  total: number | null;
  watchlistIds: Set<string>;
}) {
  const gridProps = {
    markets,
    onOpenMarket,
    onWatchlistToggle,
    watchlistIds,
  };

  if (surface === "breaking") {
    return <BreakingSurface markets={markets} onOpenMarket={onOpenMarket} />;
  }

  if (surface === "sports" || surface === "esports") {
    return <SportsbookSurface esport={surface === "esports"} markets={markets} />;
  }

  if (surface === "mentions") {
    return <MentionsSurface markets={markets} onOpenMarket={onOpenMarket} />;
  }

  if (surface === "weather") {
    return (
      <WeatherSurface
        markets={markets}
        onOpenMarket={onOpenMarket}
        onWatchlistToggle={onWatchlistToggle}
        watchlistIds={watchlistIds}
      />
    );
  }

  if (surface === "crypto") {
    return (
      <>
        <CategorySurface
          columns="grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3"
          filters={filters}
          markets={markets}
          onOpenMarket={onOpenMarket}
          onWatchlistToggle={onWatchlistToggle}
          sidebarItems={getSidebarItems(surface, markets)}
          surface={surface}
          topTabs={["All", "Up / Down", "Above / Below", "Price Range", "Hit Price"]}
          watchlistIds={watchlistIds}
        />
        <LoadMoreControl
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          shown={markets.length}
          total={total}
        />
      </>
    );
  }

  if (surface === "new") {
    return (
      <>
        <div className="home-reveal mt-2 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {["All", "Trump", "Iran", "MicroStrategy", "Iceman", "Starmer", "Hantavirus", "Cuba", "Gemini", "GTA VI"].map(
            (label, index) => (
              <button
                className={`home-soft-button min-w-fit rounded-xl px-4 py-2 text-sm font-bold transition ${
                  index === 0
                    ? "bg-[#153458] text-[#58a6ff]"
                    : "text-[#8f9aa8] hover:bg-[#171d24] hover:text-[#edf1f5]"
                }`}
                key={label}
                type="button"
              >
                {label}
              </button>
            ),
          )}
        </div>
        <MarketGrid {...gridProps} columns="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" />
        <LoadMoreControl
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          shown={markets.length}
          total={total}
        />
      </>
    );
  }

  if (surface !== "trending") {
    return (
      <>
        <CategorySurface
          columns="grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3"
          filters={filters}
          markets={markets}
          onOpenMarket={onOpenMarket}
          onWatchlistToggle={onWatchlistToggle}
          sidebarItems={getSidebarItems(surface, markets)}
          surface={surface}
          topTabs={getSurfaceTopTabs(surface)}
          watchlistIds={watchlistIds}
        />
        <LoadMoreControl
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          shown={markets.length}
          total={total}
        />
      </>
    );
  }

  return (
    <>
      <MarketGrid {...gridProps} columns="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" />
      <LoadMoreControl
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={onLoadMore}
        shown={markets.length}
        total={total}
      />
    </>
  );
}

function getHomeSurfaceMotionKey(surface: DiscoverySurface, filters: MarketFilters) {
  return [
    surface,
    filters.search,
    filters.category,
    filters.topic,
    filters.sort,
    filters.status,
    filters.minVolume,
    filters.maxVolume,
    filters.closingAfter,
    filters.closingBefore,
  ].join(":");
}

function CategorySurface({
  columns,
  markets,
  onOpenMarket,
  onWatchlistToggle,
  sidebarItems,
  surface,
  topTabs,
  watchlistIds,
}: {
  columns: string;
  filters: MarketFilters;
  markets: Market[];
  onOpenMarket: (market: Market) => void;
  onWatchlistToggle?: (market: Market) => void;
  sidebarItems: SurfaceSidebarItem[];
  surface: DiscoverySurface;
  topTabs: string[];
  watchlistIds: Set<string>;
}) {
  const [activeSidebar, setActiveSidebar] = React.useState(sidebarItems[0]?.label ?? "All");
  const [activeTab, setActiveTab] = React.useState(topTabs[0] ?? "All");

  React.useEffect(() => {
    setActiveSidebar(sidebarItems[0]?.label ?? "All");
    setActiveTab(topTabs[0] ?? "All");
  }, [surface, sidebarItems, topTabs]);

  const activeSidebarItem = sidebarItems.find((item) => item.label === activeSidebar) ?? sidebarItems[0];
  const visibleMarkets = React.useMemo(
    () => filterMarketsForLocalTab(markets, activeSidebarItem?.search || activeTab),
    [activeSidebarItem?.search, activeTab, markets],
  );

  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <SectionSidebar
        activeLabel={activeSidebar}
        items={sidebarItems}
        onSelect={setActiveSidebar}
      />
      <section className="home-reveal min-w-0 space-y-4">
        {topTabs.length > 0 ? (
          <SegmentRail active={activeTab} labels={topTabs} onSelect={setActiveTab} />
        ) : null}
        <MarketGrid
          columns={columns}
          markets={visibleMarkets.length > 0 ? visibleMarkets : markets}
          onOpenMarket={onOpenMarket}
          onWatchlistToggle={onWatchlistToggle}
          watchlistIds={watchlistIds}
        />
      </section>
    </div>
  );
}

function BreakingSurface({
  markets,
  onOpenMarket,
}: {
  markets: Market[];
  onOpenMarket: (market: Market) => void;
}) {
  const rows = markets.slice(0, 9);
  const dateLabel = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="mt-5 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0">
        <div className="home-reveal relative mb-6 overflow-hidden rounded-2xl border border-[#293440] bg-[#1b2027] px-7 py-8">
          <div className="absolute right-6 top-1/2 hidden h-48 w-72 -translate-y-1/2 rounded-full border border-[#1b5fb6]/35 md:block" />
          <div className="absolute right-28 top-12 hidden h-20 w-20 rotate-12 rounded-[28px] bg-[#3b91f6] md:grid md:place-items-center">
            <TrendingUp size={44} className="text-white" />
          </div>
          <p className="text-sm font-semibold text-[#8f9aa8]">{dateLabel}</p>
          <h2 className="mt-4 text-3xl font-bold text-[#edf1f5]">Breaking News</h2>
          <p className="mt-3 max-w-xl text-base font-medium text-[#8f9aa8]">
            The markets that moved the most in the last 24 hours.
          </p>
        </div>

        <SegmentRail
          active="All"
          labels={["All", "Politics", "World", "Sports", "Crypto", "Finance", "Tech", "Culture"]}
          onSelect={() => undefined}
        />

        <div className="mt-6 divide-y divide-[#293440]">
          {rows.map((market, index) => (
            <button
              className="home-stagger-item grid w-full grid-cols-[28px_54px_minmax(0,1fr)_92px_96px_20px] items-center gap-4 py-5 text-left transition hover:bg-[#171d24]/65 max-md:grid-cols-[24px_48px_minmax(0,1fr)_72px_20px] max-md:[&_.spark]:hidden"
              key={market.id}
              onClick={() => onOpenMarket(market)}
              style={getMotionDelayStyle(index)}
              type="button"
            >
              <span className="text-center text-sm font-semibold text-[#8f9aa8]">{index + 1}</span>
              <MarketImage market={market} className="size-12 rounded-lg" />
              <span className="min-w-0">
                <span className="line-clamp-2 text-[17px] font-semibold text-[#edf1f5]">{market.title}</span>
                <span className="mt-1 flex items-center gap-1 text-sm font-bold text-[#48b36a]">
                  {getPrimaryMarketPercent(market)} <span>{getMovementLabel(market)}</span>
                </span>
              </span>
              <Sparkline market={market} />
              <span className="text-right text-2xl font-semibold text-[#edf1f5] max-md:text-lg">
                {getPrimaryMarketPercent(market)}
              </span>
              <ChevronRight className="text-[#8f9aa8]" size={20} />
            </button>
          ))}
        </div>
      </section>

      <aside className="home-reveal space-y-6">
        <div className="home-soft-card rounded-2xl border border-[#293440] bg-[#11161c] p-5">
          <div className="mb-4 flex items-start gap-3">
            <Bell className="mt-1 text-[#8f9aa8]" size={24} />
            <div>
              <h3 className="text-base font-bold text-[#edf1f5]">Get daily updates</h3>
              <p className="text-sm font-medium text-[#8f9aa8]">
                We'll send you an email every day with what's moving.
              </p>
            </div>
          </div>
          <input
            className="mb-3 h-11 w-full rounded-xl border border-[#293440] bg-[#1b2027] px-4 text-sm font-semibold text-[#edf1f5] outline-none"
            readOnly
            value="john.amerema@gmail.com"
          />
          <button className="home-soft-button h-11 w-full rounded-xl bg-[#3b91f6] text-sm font-bold text-white" type="button">
            Get updates
          </button>
        </div>

        <div className="home-soft-card rounded-2xl border border-[#293440] bg-[#11161c] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-[#8f9aa8]">Live from @Polymarket</h3>
            <button className="home-soft-button rounded-full bg-white px-4 py-2 text-sm font-bold text-[#11161c]" type="button">
              Follow on X
            </button>
          </div>
          {getNewsItems(markets).map((item) => (
            <div className="border-t border-[#293440] py-4" key={`${item.time}-${item.title}`}>
              <div className="mb-2 flex items-center justify-between gap-4 text-sm font-semibold text-[#8f9aa8]">
                <span>{item.kind}</span>
                <span>{item.time}</span>
              </div>
              <p className="text-sm font-medium leading-6 text-[#b8c1cc]">{item.title}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function SportsbookSurface({
  esport,
  markets,
}: {
  esport: boolean;
  markets: Market[];
}) {
  const [selected, setSelected] = React.useState(markets[0]);

  React.useEffect(() => {
    setSelected(markets[0]);
  }, [markets]);

  const sidebarItems = esport
    ? [
        { label: "Live", count: 6, icon: <Radio size={18} className="text-red-500" /> },
        { label: "Upcoming", count: 37, icon: <CalendarDays size={18} /> },
        { label: "Dota 2", count: 12 },
        { label: "LoL", count: 8 },
        { label: "CS2", count: 6 },
        { label: "Valorant", count: 5 },
        { label: "Rocket League", count: 4 },
      ]
    : [
        { label: "Live", icon: <Radio size={18} className="text-red-500" /> },
        { label: "Futures", icon: <CalendarDays size={18} /> },
        { label: "NBA", count: 7 },
        { label: "MLB", count: 98 },
        { label: "NHL", count: 4 },
        { label: "UFC", count: 9 },
        { label: "Football", count: 12 },
        { label: "Soccer", count: 21 },
        { label: "Tennis", count: 18 },
      ];

  return (
    <div className="mt-5 grid gap-8 xl:grid-cols-[220px_minmax(0,1fr)_340px]">
      <SectionSidebar activeLabel="Live" items={sidebarItems} onSelect={() => undefined} />
      <section className="home-reveal min-w-0 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-4xl font-bold text-[#edf1f5]">{esport ? "Esports Live" : "Sports Live"}</h2>
          <div className="flex items-center gap-2 text-[#d8dde3]">
            <Search size={22} />
            <SlidersHorizontal size={22} />
          </div>
        </div>
        <SportsLeagueTable
          esport={esport}
          markets={markets.slice(0, 10)}
          selectedId={selected?.id}
          onSelect={setSelected}
        />
      </section>
      <TradeTicket market={selected ?? markets[0]} esport={esport} />
    </div>
  );
}

function SportsLeagueTable({
  esport,
  markets,
  onSelect,
  selectedId,
}: {
  esport: boolean;
  markets: Market[];
  onSelect: (market: Market) => void;
  selectedId?: string;
}) {
  const sections = esport ? ["CS 2", "Dota 2"] : ["WTA", "ATP"];

  return (
    <>
      {sections.map((section, sectionIndex) => {
        const sectionMarkets = markets.slice(sectionIndex * 5, sectionIndex * 5 + 5);

        if (sectionMarkets.length === 0) {
          return null;
        }

        return (
          <div className="home-reveal space-y-3" key={section}>
            <div className="grid grid-cols-[minmax(0,1fr)_140px_140px_140px] px-2 text-xs font-bold uppercase tracking-wide text-[#6f7d8d] max-lg:hidden">
              <h3 className="text-xl font-bold normal-case text-[#edf1f5]">{section}</h3>
              <span>Moneyline</span>
              <span>Spread</span>
              <span>Total</span>
            </div>
            {sectionMarkets.map((market, index) => (
              <SportsMarketRow
                active={market.id === selectedId}
                esport={esport}
                index={index}
                key={market.id}
                market={market}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

function SportsMarketRow({
  active,
  esport,
  index,
  market,
  onSelect,
}: {
  active: boolean;
  esport: boolean;
  index: number;
  market: Market;
  onSelect: (market: Market) => void;
}) {
  const rows = getMiniOutcomeRows(market);
  const first = rows[0]?.label ?? getFirstTeamName(market.title, 0);
  const second = rows[1]?.label ?? getFirstTeamName(market.title, 1);

  return (
    <article
      className={`home-soft-card rounded-2xl border bg-[#11161c] p-4 transition ${
        active ? "border-[#3b91f6]/70" : "border-[#293440] hover:border-[#3b91f6]/35"
      }`}
    >
      <button
        className="mb-4 flex w-full items-center justify-between gap-3 text-left"
        onClick={() => onSelect(market)}
        type="button"
      >
        <div className="min-w-0 text-sm font-bold text-[#8f9aa8]">
          <span className="mr-2 text-red-500">● LIVE</span>
          <span>{index % 2 === 0 ? "Today" : "Final"}</span>
          <span className="mx-1">·</span>
          <span>{formatMoney(market.volume)} Vol.</span>
        </div>
        <span className="rounded-xl bg-[#20272f] px-3 py-1.5 text-sm font-bold text-[#d8dde3]">
          Game View <ChevronRight className="inline" size={14} />
        </span>
      </button>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_140px_140px_140px]">
        <div className="space-y-3">
          {[first, second].map((team, teamIndex) => (
            <div className="flex items-center gap-3" key={`${market.id}-${team}-${teamIndex}`}>
              <span className="grid size-8 place-items-center rounded-lg bg-[#20272f] text-sm font-bold text-[#8f9aa8]">
                {teamIndex === 0 ? (index % 3 === 0 ? "6" : "1") : index % 3 === 0 ? "3" : "0"}
              </span>
              <MarketImage market={market} className="size-8 rounded-md" />
              <span className="min-w-0 truncate text-base font-bold text-[#d8dde3]">{team}</span>
            </div>
          ))}
        </div>
        <SportsbookButtons tone={esport ? "blue" : "red"} labels={[first, second]} prices={rows} />
        <SportsbookButtons tone="dark" labels={[`${shortLabel(first)} -1.5`, `${shortLabel(second)} +1.5`]} prices={rows} />
        <SportsbookButtons tone="dark" labels={["O 2.5", "U 2.5"]} prices={rows} />
      </div>
    </article>
  );
}

function SportsbookButtons({
  labels,
  prices,
  tone,
}: {
  labels: string[];
  prices: MiniOutcomeRow[];
  tone: "blue" | "dark" | "red";
}) {
  const toneClass =
    tone === "blue"
      ? "bg-[#3b91f6] text-white shadow-[0_4px_0_rgba(36,98,174,0.85)]"
      : tone === "red"
        ? "bg-[#ab342e] text-white shadow-[0_4px_0_rgba(103,33,30,0.85)]"
        : "bg-[#20272f] text-[#b8c1cc]";

  return (
    <div className="grid grid-rows-2 gap-2">
      {labels.slice(0, 2).map((label, index) => (
        <button
          className={`home-soft-button h-11 rounded-xl px-3 text-sm font-bold transition hover:brightness-110 ${toneClass}`}
          key={`${label}-${index}`}
          type="button"
        >
          <span className="block truncate">
            {label} {formatCents(index === 0 ? prices[0]?.yesPrice ?? null : prices[1]?.yesPrice ?? null)}
          </span>
        </button>
      ))}
    </div>
  );
}

function TradeTicket({ esport, market }: { esport: boolean; market?: Market }) {
  if (!market) {
    return null;
  }

  const rows = getMiniOutcomeRows(market);
  const first = rows[0]?.label ?? "Market";
  const second = rows[1]?.label ?? "Opponent";

  return (
    <aside className="home-reveal sticky top-36 h-fit rounded-2xl border border-[#293440] bg-[#11161c]">
      <div className="flex items-center gap-3 border-b border-[#293440] p-5">
        <MarketImage market={market} className="size-10 rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#8f9aa8]">{market.title}</p>
          <h3 className="truncate text-lg font-bold text-[#edf1f5]">{first}</h3>
        </div>
      </div>
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-4 text-lg font-bold">
            <span className="border-b-2 border-[#d8dde3] pb-2 text-[#edf1f5]">Buy</span>
            <span className="pb-2 text-[#8f9aa8]">Sell</span>
          </div>
          <button className="flex items-center gap-1 text-sm font-bold text-[#d8dde3]" type="button">
            Market <ChevronDown size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            className={`home-soft-button h-14 rounded-xl text-base font-bold ${
              esport ? "bg-[#3b91f6] text-white" : "bg-[#ab342e] text-white"
            }`}
            type="button"
          >
            {shortLabel(first)} {formatCents(rows[0]?.yesPrice ?? null)}
          </button>
          <button className="home-soft-button h-14 rounded-xl bg-[#20272f] text-base font-bold text-[#8f9aa8]" type="button">
            {shortLabel(second)} {formatCents(rows[1]?.yesPrice ?? null)}
          </button>
        </div>
        <div className="mt-8 flex items-end justify-between">
          <div>
            <p className="text-lg font-bold text-[#d8dde3]">Amount</p>
            <p className="text-sm font-semibold text-[#8f9aa8]">$0.00 cash</p>
          </div>
          <p className="text-5xl font-bold text-[#6f7d8d]">$0</p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          {["+$1", "+$5", "+$10", "+$100"].map((amount) => (
            <button className="home-soft-button rounded-lg bg-[#20272f] px-3 py-2 text-sm font-bold text-[#8f9aa8]" key={amount} type="button">
              {amount}
            </button>
          ))}
        </div>
        <button className="home-soft-button mt-6 h-12 w-full rounded-xl bg-[#1b2027] text-sm font-bold text-[#566272]" type="button">
          Restricted region
        </button>
      </div>
    </aside>
  );
}

function MentionsSurface({
  markets,
  onOpenMarket,
}: {
  markets: Market[];
  onOpenMarket: (market: Market) => void;
}) {
  return (
    <section className="home-reveal mx-auto mt-8 max-w-[1100px]">
      <h2 className="text-3xl font-bold text-[#edf1f5]">Mention polymarkets</h2>
      <p className="mt-3 text-base font-medium text-[#8f9aa8]">
        Live events where you can predict the words and phrases that will be said.
      </p>
      <div className="mt-8 space-y-4">
        {markets.slice(0, 8).map((market, index) => (
          <button
            className="home-stagger-item grid w-full grid-cols-[64px_76px_minmax(0,1fr)_minmax(180px,360px)_86px] items-center gap-5 rounded-xl border border-[#293440] bg-[#11161c] p-5 text-left transition hover:border-[#3b91f6]/45 hover:bg-[#171d24] max-lg:grid-cols-[54px_64px_minmax(0,1fr)_80px] max-lg:[&_.mention-tags]:hidden"
            key={market.id}
            onClick={() => onOpenMarket(market)}
            style={getMotionDelayStyle(index)}
            type="button"
          >
            <DateBadge market={market} index={index} />
            <MarketImage market={market} className="size-[70px] rounded-lg max-lg:size-14" />
            <span className="min-w-0">
              <span className="line-clamp-2 text-lg font-bold text-[#edf1f5]">{market.title}</span>
              <span className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-[#8f9aa8]">
                <span className="rounded-md bg-[#2a313a] px-2 py-1">{getMentionTime(index)}</span>
                {market.status === "live" ? <span className="text-red-500">LIVE</span> : null}
                <span>{formatMoney(market.volume)} Vol.</span>
              </span>
            </span>
            <span className="mention-tags flex min-w-0 justify-end gap-2">
              {getMentionTags(market).map((tag) => (
                <span className="truncate rounded-lg border border-[#293440] px-3 py-2 text-sm font-bold text-[#d8dde3]" key={tag}>
                  {tag}
                </span>
              ))}
            </span>
            <span className="grid h-11 place-items-center rounded-lg bg-[#3b91f6] text-sm font-bold text-white">
              Trade
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function WeatherSurface({
  markets,
  onOpenMarket,
  onWatchlistToggle,
  watchlistIds,
}: {
  markets: Market[];
  onOpenMarket: (market: Market) => void;
  onWatchlistToggle?: (market: Market) => void;
  watchlistIds: Set<string>;
}) {
  const [activeDate, setActiveDate] = React.useState("May 19");

  return (
    <div className="mt-5 grid gap-8 xl:grid-cols-[220px_minmax(0,1fr)_330px]">
      <SectionSidebar
        activeLabel="All"
        items={getSidebarItems("weather", markets)}
        onSelect={() => undefined}
      />
      <section className="home-reveal min-w-0">
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <h2 className="text-3xl font-bold text-[#edf1f5]">Weather</h2>
          <SegmentRail
            active={activeDate}
            labels={["Globe", "May 17", "May 18", "May 19", "May 20", "May 21", "May 22"]}
            onSelect={setActiveDate}
          />
        </div>
        <GroupedWeatherCards
          markets={markets.slice(0, 10)}
          onOpenMarket={onOpenMarket}
          onWatchlistToggle={onWatchlistToggle}
          watchlistIds={watchlistIds}
        />
      </section>
      <WeatherTicket market={markets[0]} />
    </div>
  );
}

function GroupedWeatherCards({
  markets,
  onOpenMarket,
  onWatchlistToggle,
  watchlistIds,
}: {
  markets: Market[];
  onOpenMarket: (market: Market) => void;
  onWatchlistToggle?: (market: Market) => void;
  watchlistIds: Set<string>;
}) {
  const midpoint = Math.max(4, Math.ceil(markets.length / 2));
  const groups = [
    { title: "Precipitation", markets: markets.slice(0, midpoint) },
    { title: "Global", markets: markets.slice(midpoint) },
  ];

  return (
    <div className="space-y-8">
      {groups.map((group) =>
        group.markets.length > 0 ? (
          <section className="home-reveal space-y-4" key={group.title}>
            <h3 className="text-xl font-bold text-[#edf1f5]">{group.title}</h3>
            <MarketGrid
              columns="grid-cols-1 lg:grid-cols-2"
              markets={group.markets}
              onOpenMarket={onOpenMarket}
              onWatchlistToggle={onWatchlistToggle}
              watchlistIds={watchlistIds}
            />
          </section>
        ) : null,
      )}
    </div>
  );
}

function WeatherTicket({ market }: { market?: Market }) {
  if (!market) {
    return null;
  }

  const rows = getMiniOutcomeRows(market);
  const first = rows[0]?.label ?? "Yes";

  return (
    <aside className="home-reveal sticky top-36 h-fit rounded-2xl border border-[#293440] bg-[#11161c] p-5">
      <div className="mb-6 flex items-center gap-3">
        <MarketImage market={market} className="size-12 rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#8f9aa8]">{market.title}</p>
          <p className="truncate text-lg font-bold text-[#edf1f5]">{first} · Yes</p>
        </div>
      </div>
      <div className="mb-5 flex gap-5 text-lg font-bold">
        <span className="border-b-2 border-[#d8dde3] pb-2 text-[#edf1f5]">Buy</span>
        <span className="pb-2 text-[#8f9aa8]">Sell</span>
        <span className="ml-auto flex items-center gap-1 text-sm text-[#d8dde3]">Market <ChevronDown size={16} /></span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button className="home-soft-button h-14 rounded-xl bg-green-500/70 text-base font-bold text-white" type="button">
          Yes {formatCents(rows[0]?.yesPrice ?? null)}
        </button>
        <button className="home-soft-button h-14 rounded-xl bg-[#20272f] text-base font-bold text-[#8f9aa8]" type="button">
          No {formatCents(rows[0]?.noPrice ?? null)}
        </button>
      </div>
      <div className="mt-8 flex items-end justify-between">
        <div>
          <p className="text-lg font-bold text-[#d8dde3]">Amount</p>
          <p className="text-sm font-semibold text-[#8f9aa8]">$0.00 cash</p>
        </div>
        <p className="text-5xl font-bold text-[#6f7d8d]">$0</p>
      </div>
      <button className="home-soft-button mt-8 h-12 w-full rounded-xl bg-[#1b2027] text-sm font-bold text-[#566272]" type="button">
        Restricted region
      </button>
    </aside>
  );
}

function MarketGrid({
  columns,
  markets,
  onOpenMarket,
  onWatchlistToggle,
  watchlistIds,
}: {
  columns: string;
  markets: Market[];
  onOpenMarket: (market: Market) => void;
  onWatchlistToggle?: (market: Market) => void;
  watchlistIds: Set<string>;
}) {
  return (
    <div className={`mt-5 grid gap-3 ${columns}`}>
      {markets.map((market, index) => (
        <div className="home-stagger-item" key={market.id} style={getMotionDelayStyle(index)}>
          <MarketCard
            market={market}
            onOpen={() => onOpenMarket(market)}
            isWatched={watchlistIds.has(market.id)}
            onWatchlistToggle={onWatchlistToggle ? () => onWatchlistToggle(market) : undefined}
          />
        </div>
      ))}
    </div>
  );
}

function getMotionDelayStyle(index: number): React.CSSProperties {
  return {
    "--motion-delay": `${Math.min(index, 16) * 32}ms`,
  } as React.CSSProperties;
}

function LoadMoreControl({
  hasMore,
  isLoadingMore,
  onLoadMore,
  shown,
  total,
}: {
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  shown: number;
  total: number | null;
}) {
  return (
    <div className="mt-8 flex justify-center">
      {hasMore ? (
        <button
          className="home-soft-button rounded-2xl border border-[#293440] bg-[#171d24] px-5 py-3 text-sm font-semibold text-[#edf1f5] transition hover:border-[#3b91f6]/50 hover:bg-[#1d252e] disabled:opacity-60"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          type="button"
        >
          {isLoadingMore ? "Loading..." : "Load more"}
        </button>
      ) : total !== null ? (
        <span className="text-sm font-medium text-[#8f9aa8]">
          Showing {shown} of {total} markets
        </span>
      ) : null}
    </div>
  );
}

function SectionSidebar({
  activeLabel,
  items,
  onSelect,
}: {
  activeLabel: string;
  items: SurfaceSidebarItem[];
  onSelect: (label: string) => void;
}) {
  return (
    <aside className="hidden min-w-0 space-y-1 lg:block">
      {items.map((item) => (
        <button
          className={`home-soft-button flex h-11 w-full items-center gap-3 rounded-xl px-4 text-left text-sm font-bold transition ${
            item.label === activeLabel
              ? "bg-[#20272f] text-[#edf1f5]"
              : "text-[#b8c1cc] hover:bg-[#171d24] hover:text-[#edf1f5]"
          }`}
          key={item.label}
          onClick={() => onSelect(item.label)}
          type="button"
        >
          {item.icon ? <span className="grid size-5 place-items-center text-[#8f9aa8]">{item.icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.count !== undefined ? (
            <span className="text-xs font-bold text-[#566272]">{item.count}</span>
          ) : null}
        </button>
      ))}
    </aside>
  );
}

function SegmentRail({
  active,
  labels,
  onSelect,
}: {
  active: string;
  labels: string[];
  onSelect: (label: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {labels.map((label) => (
        <button
          className={`home-soft-button min-w-fit rounded-xl px-4 py-2 text-sm font-bold transition ${
            label === active
              ? "bg-[#153458] text-[#58a6ff]"
              : "text-[#8f9aa8] hover:bg-[#171d24] hover:text-[#edf1f5]"
          }`}
          key={label}
          onClick={() => onSelect(label)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function getDiscoverySurface(filters: MarketFilters): DiscoverySurface {
  const search = filters.search.trim().toLowerCase();

  if (filters.sort === "closing_soon" && !filters.category && filters.topic === "all" && !search) {
    return "breaking";
  }

  if (filters.sort === "newest" && !filters.category && filters.topic === "all" && !search) {
    return "new";
  }

  if (filters.category === "sports") {
    return "sports";
  }

  if (filters.category === "crypto") {
    return "crypto";
  }

  if (filters.topic === "esports") {
    return "esports";
  }

  if (filters.category === "weather") {
    return "weather";
  }

  if (filters.topic === "social" || search === "during" || search.includes("mention")) {
    return "mentions";
  }

  if (filters.topic === "elections") {
    return "elections";
  }

  if (filters.category === "finance") {
    return "finance";
  }

  if (filters.category === "geopolitics") {
    return "geopolitics";
  }

  if (filters.category === "tech") {
    return "tech";
  }

  if (filters.category === "culture") {
    return "culture";
  }

  if (filters.category === "economy") {
    return "economy";
  }

  if (filters.category === "politics" && search.includes("iran")) {
    return "iran";
  }

  if (filters.category === "politics") {
    return "politics";
  }

  return "trending";
}

function getSurfaceTitle(surface: DiscoverySurface) {
  const titles: Record<DiscoverySurface, string> = {
    breaking: "Breaking News",
    crypto: "Crypto",
    culture: "Culture",
    economy: "Economy",
    elections: "Elections",
    esports: "Esports Live",
    finance: "Finance",
    geopolitics: "Geopolitics",
    iran: "Iran",
    mentions: "Mention polymarkets",
    new: "New",
    politics: "Politics",
    sports: "Sports Live",
    tech: "Technology",
    trending: "All markets",
    weather: "Weather",
  };

  return titles[surface];
}

function getSurfaceTopTabs(surface: DiscoverySurface) {
  const tabs: Partial<Record<DiscoverySurface, string[]>> = {
    culture: ["All", "Movies", "Music", "TV", "Awards", "Gaming"],
    economy: ["All", "Inflation", "GDP", "Jobs", "Rates", "Housing"],
    elections: ["All", "Trump", "Midterms", "Global Elections", "Congress", "Primaries"],
    finance: ["All", "Up / Down", "Daily Close", "S&P 500", "Stocks", "Indices", "Gold", "Silver", "Tesla", "NVIDIA"],
    geopolitics: ["All", "Iran", "Oil", "Ukraine", "Cuba", "Middle East", "China"],
    iran: ["All", "Military Strikes", "Oil", "Iran Regime", "Ceasefire", "Strait of Hormuz"],
    politics: ["All", "Trump", "Elections", "Congress", "Courts", "Epstein", "Fed"],
    tech: ["All", "AI", "Elon Musk", "App Store", "SpaceX", "OpenAI", "Big Tech"],
  };

  return tabs[surface] ?? [];
}

function getSidebarItems(surface: DiscoverySurface, markets: Market[]): SurfaceSidebarItem[] {
  const dynamicCount = (label: string, fallback: number) =>
    Math.max(
      markets.filter((market) => marketMatchesToken(market, label)).length || fallback,
      fallback,
    );

  const bySurface: Partial<Record<DiscoverySurface, SurfaceSidebarItem[]>> = {
    crypto: [
      { label: "All", count: markets.length, icon: <Grid2X2 size={18} /> },
      { label: "5 Min", count: dynamicCount("5m", 7), search: "5m" },
      { label: "15 Min", count: dynamicCount("15m", 7), search: "15m" },
      { label: "1 Hour", count: dynamicCount("1 hour", 9), search: "1 hour" },
      { label: "Daily", count: dynamicCount("daily", 11), search: "daily" },
      { label: "Weekly", count: dynamicCount("weekly", 64), search: "weekly" },
      { label: "Monthly", count: dynamicCount("monthly", 22), search: "monthly" },
      { label: "Bitcoin", count: dynamicCount("bitcoin", 33), search: "bitcoin" },
      { label: "Ethereum", count: dynamicCount("ethereum", 21), search: "ethereum" },
      { label: "Solana", count: dynamicCount("solana", 13), search: "solana" },
    ],
    elections: [
      { label: "All", count: markets.length },
      { label: "Trump", count: dynamicCount("Trump", 294), search: "Trump" },
      { label: "Trump Daily", count: dynamicCount("Daily", 6), search: "Daily" },
      { label: "Midterms", count: dynamicCount("Midterms", 545), search: "Midterms" },
      { label: "Global Elections", count: dynamicCount("Election", 145), search: "Election" },
      { label: "Congress", count: dynamicCount("Congress", 41), search: "Congress" },
      { label: "French Elections", count: dynamicCount("French", 3), search: "French" },
      { label: "US Election", count: dynamicCount("US", 155), search: "US" },
    ],
    finance: [
      { label: "All", count: markets.length, icon: <Grid2X2 size={18} /> },
      { label: "Daily", count: dynamicCount("daily", 76), search: "daily" },
      { label: "Weekly", count: dynamicCount("weekly", 46), search: "weekly" },
      { label: "Monthly", count: dynamicCount("monthly", 37), search: "monthly" },
      { label: "Stocks", count: dynamicCount("stock", 100), search: "stock" },
      { label: "Earnings", count: dynamicCount("earnings", 19), search: "earnings" },
      { label: "Indices", count: dynamicCount("indices", 22), search: "indices" },
      { label: "Commodities", count: dynamicCount("oil", 31), search: "oil" },
      { label: "Fed Rates", count: dynamicCount("fed", 22), search: "fed" },
    ],
    geopolitics: [
      { label: "All", count: markets.length },
      { label: "Iran", count: dynamicCount("Iran", 91), search: "Iran" },
      { label: "Oil", count: dynamicCount("Oil", 31), search: "Oil" },
      { label: "Ukraine", count: dynamicCount("Ukraine", 107), search: "Ukraine" },
      { label: "Middle East", count: dynamicCount("Middle East", 73), search: "Middle East" },
      { label: "Gaza", count: dynamicCount("Gaza", 16), search: "Gaza" },
      { label: "Israel", count: dynamicCount("Israel", 70), search: "Israel" },
      { label: "China", count: dynamicCount("China", 41), search: "China" },
    ],
    iran: [
      { label: "All", count: markets.length },
      { label: "Military Strikes", count: dynamicCount("strike", 3), search: "strike" },
      { label: "Oil", count: dynamicCount("oil", 31), search: "oil" },
      { label: "Iran Regime", count: dynamicCount("regime", 17), search: "regime" },
      { label: "Iran Ceasefire", count: dynamicCount("ceasefire", 27), search: "ceasefire" },
      { label: "Strait of Hormuz", count: dynamicCount("Hormuz", 16), search: "Hormuz" },
      { label: "U.S. x Iran", count: dynamicCount("US", 38), search: "US" },
      { label: "Reza Pahlavi", count: dynamicCount("Pahlavi", 7), search: "Pahlavi" },
    ],
    politics: [
      { label: "All", count: markets.length },
      { label: "Trump", count: dynamicCount("Trump", 294), search: "Trump" },
      { label: "Elections", count: dynamicCount("Election", 155), search: "Election" },
      { label: "Congress", count: dynamicCount("Congress", 41), search: "Congress" },
      { label: "Courts", count: dynamicCount("Court", 30), search: "Court" },
      { label: "Cabinet", count: dynamicCount("Cabinet", 14), search: "Cabinet" },
      { label: "UK Elections", count: dynamicCount("UK", 2), search: "UK" },
    ],
    tech: [
      { label: "All", count: markets.length },
      { label: "AI", count: dynamicCount("AI", 121), search: "AI" },
      { label: "Elon Musk", count: dynamicCount("Musk", 51), search: "Musk" },
      { label: "App Store", count: dynamicCount("App", 4), search: "App" },
      { label: "SpaceX", count: dynamicCount("SpaceX", 30), search: "SpaceX" },
      { label: "OpenAI", count: dynamicCount("OpenAI", 34), search: "OpenAI" },
      { label: "Big Tech", count: dynamicCount("Tech", 155), search: "Tech" },
      { label: "TikTok", count: dynamicCount("TikTok", 2), search: "TikTok" },
    ],
    weather: [
      { label: "All", count: markets.length, icon: <Grid2X2 size={18} /> },
      { label: "Temperature", icon: <CloudRain size={18} />, search: "temperature" },
      { label: "Precipitation", count: dynamicCount("precipitation", 5), search: "precipitation" },
      { label: "Global", count: dynamicCount("global", 10), search: "global" },
      { label: "Tornadoes", count: dynamicCount("tornado", 2), search: "tornado" },
      { label: "Hurricanes", count: dynamicCount("hurricane", 6), search: "hurricane" },
      { label: "Earthquakes", count: dynamicCount("earthquake", 16), search: "earthquake" },
      { label: "Pandemics", count: dynamicCount("pandemic", 11), search: "pandemic" },
    ],
  };

  return (
    bySurface[surface] ?? [
      { label: "All", count: markets.length },
      { label: "Trending", count: dynamicCount("trending", 12), icon: <TrendingUp size={18} /> },
      { label: "Live", count: dynamicCount("live", 24), icon: <CircleDot size={18} /> },
      { label: "Rewards", count: dynamicCount("rewards", 8), icon: <Trophy size={18} /> },
      { label: "New", count: dynamicCount("new", 6), icon: <Zap size={18} /> },
      { label: "Markets", count: dynamicCount("market", 36), icon: <Wallet size={18} /> },
    ]
  );
}

function filterMarketsForLocalTab(markets: Market[], token: string) {
  if (!token || token === "All") {
    return markets;
  }

  return markets.filter((market) => marketMatchesToken(market, token));
}

function marketMatchesToken(market: Market, token: string) {
  const normalized = token.toLowerCase().replace(/\s*\/\s*/g, " ").trim();
  const text = `${market.title} ${market.category ?? ""} ${market.category_label ?? ""} ${market.topics.join(" ")} ${
    market.groupItemTitle ?? ""
  } ${market.group_markets?.map((groupMarket) => groupMarket.label).join(" ") ?? ""}`.toLowerCase();

  if (normalized === "up down") {
    return /\bup\b|\bdown\b/.test(text);
  }

  if (normalized === "above below") {
    return /\babove\b|\bbelow\b|over|under/.test(text);
  }

  return normalized.length > 0 && text.includes(normalized);
}

function getMiniOutcomeRows(market: Market): MiniOutcomeRow[] {
  if ((market.group_markets?.length ?? 0) > 0) {
    return (market.group_markets ?? []).slice(0, 3).map((groupMarket) => ({
      label: groupMarket.label || groupMarket.groupItemTitle || groupMarket.title,
      yesPrice: groupMarket.yes_price,
      noPrice: groupMarket.no_price,
    }));
  }

  if (market.outcomes.length > 2) {
    return market.outcomes.slice(0, 3).map((outcome) => ({
      label: outcome.name,
      yesPrice: getOutcomePrice(outcome),
      noPrice: null,
    }));
  }

  const yes = market.outcomes.find((outcome) => outcome.name.toLowerCase() === "yes") ?? market.outcomes[0];
  const no = market.outcomes.find((outcome) => outcome.name.toLowerCase() === "no") ?? market.outcomes[1];

  return [
    {
      label: yes?.name ?? "Yes",
      yesPrice: getOutcomePrice(yes),
      noPrice: getOutcomePrice(no),
    },
    {
      label: no?.name ?? "No",
      yesPrice: getOutcomePrice(no),
      noPrice: getOutcomePrice(yes),
    },
  ];
}

function getOutcomePrice(outcome: Market["outcomes"][number] | undefined) {
  return outcome?.price ?? outcome?.probability ?? null;
}

function getPrimaryMarketPercent(market: Market) {
  return formatPercent(getPrimaryMarketPrice(market));
}

function getPrimaryMarketPrice(market: Market) {
  return getMiniOutcomeRows(market)[0]?.yesPrice ?? market.prices?.yes ?? null;
}

function getMovementLabel(market: Market) {
  const seed = stableHash(market.id || market.title);
  const direction = seed % 3 === 0 ? "↘" : "↗";
  const amount = 12 + (seed % 47);

  return `${direction} ${amount}%`;
}

function Sparkline({ market }: { market: Market }) {
  const seed = stableHash(market.id || market.title);
  const up = seed % 3 !== 0;
  const points = Array.from({ length: 12 }, (_, index) => {
    const x = index * 8;
    const wobble = ((seed >> (index % 8)) & 7) - 3;
    const trend = up ? 44 - index * 2.4 : 18 + index * 2.5;
    const y = Math.max(8, Math.min(46, trend + wobble * 1.8));

    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="spark h-12 w-24" viewBox="0 0 88 54" aria-hidden="true">
      <polyline
        fill="none"
        points={points}
        stroke={up ? "#48b36a" : "#d94b45"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
    </svg>
  );
}

function getNewsItems(markets: Market[]) {
  const fallback = [
    "Pope Leo XIV will meet with Anthropic co-founder Christopher Olah next week to discuss AI.",
    "Trump reportedly drops his $10 billion lawsuit against the IRS.",
    "Spain's ruling Socialist party suffers its worst-ever loss in Andalusia.",
    "#1 song on Spotify this week?",
    "White House announces China has agreed to address U.S. concerns over rare earth shortages.",
  ];

  return fallback.map((title, index) => ({
    kind: index === 3 ? "New polymarket" : "Breaking news",
    time: `May 18, ${9 - index}:${index === 0 ? "50" : "1" + index} AM`,
    title: markets[index]?.title ?? title,
  }));
}

function getFirstTeamName(title: string, index: number) {
  const pieces = title
    .replace(/\?/g, "")
    .split(/\s+(?:vs\.?|v\.?|at|versus|x)\s+/i)
    .map((piece) => piece.trim())
    .filter(Boolean);

  return pieces[index] ?? (index === 0 ? "Home" : "Away");
}

function shortLabel(label: string) {
  const compact = label.replace(/[^a-z0-9 ]/gi, "").trim();

  if (!compact) {
    return label.slice(0, 6).toUpperCase();
  }

  return compact
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 5))
    .join(" ")
    .toUpperCase();
}

function DateBadge({ index, market }: { index: number; market: Market }) {
  const date = market.starts_at ?? market.ends_at;
  const fallbackDays = [15, 17, 17, 20, 24, 24, 25, 31];
  const day = date ? new Date(date).getDate() : fallbackDays[index % fallbackDays.length];
  const month = date ? formatShortDate(date).split(" ")[0] : "May";

  return (
    <span className="text-center">
      <span className="block text-2xl font-bold leading-none text-[#edf1f5]">{day}</span>
      <span className="mt-1 block text-base font-bold text-[#d8dde3]">{month}</span>
    </span>
  );
}

function getMentionTime(index: number) {
  const times = ["Fri, 6:00 PM", "Sun, 5:00 PM", "Sun, 11:00 PM", "Wed, 11:00 AM"];

  return times[index % times.length];
}

function getMentionTags(market: Market) {
  const rows = getMiniOutcomeRows(market)
    .map((row) => row.label)
    .filter((label) => label.length > 0);

  return [...rows.slice(0, 2), `+${Math.max(12, (market.comment_count ?? rows.length * 7) % 32)}`];
}

function stableHash(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

function CompactSelect({
  ariaLabel,
  children,
  displayValue,
  icon,
  value,
  onChange,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  displayValue: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
}) {
  const rootRef = React.useRef<HTMLLabelElement | null>(null);
  const { ripples, addRipple, removeRipple } = useTapRipples(rootRef);

  return (
    <label
      ref={rootRef}
      className="home-soft-button relative inline-flex h-11 min-w-fit cursor-pointer items-center gap-2 overflow-hidden rounded-full bg-[#20272f] pl-4 pr-9 text-sm font-bold text-[#d8dde3] transition hover:bg-[#29313a] focus-within:bg-[#29313a]"
    >
      <RippleLayer ripples={ripples} onRippleEnd={removeRipple} />
      {icon ? <span className="pointer-events-none relative z-10 text-[#d8dde3]">{icon}</span> : null}
      <span className="pointer-events-none relative z-10 max-w-[180px] truncate pr-1">{displayValue}</span>
      <select
        aria-label={ariaLabel}
        className="absolute inset-0 z-20 h-full w-full cursor-pointer appearance-none rounded-full border-0 bg-transparent opacity-0 outline-none"
        onPointerDown={addRipple}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 z-10 size-4 text-[#8f9aa8]" />
    </label>
  );
}

function getSortOptionLabel(value: MarketFilters["sort"]) {
  if (value === "trending") {
    return "24hr Volume";
  }

  if (value === "volume") {
    return "Total Volume";
  }

  if (value === "closing_soon") {
    return "Closing soon";
  }

  return sortOptions.find((option) => option.value === value)?.label ?? value;
}

function getStatusOptionLabel(
  value: MarketFilters["status"],
  labels: { all: string; closed: string },
) {
  if (value === "live") {
    return "Active";
  }

  if (value === "all") {
    return labels.all;
  }

  if (value === "closed") {
    return labels.closed;
  }

  return value[0].toUpperCase() + value.slice(1);
}

function HideToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="home-soft-button inline-flex h-11 min-w-fit items-center gap-2 rounded-full px-1 pr-3 text-sm font-semibold text-[#d8dde3]">
      <span
        className={`grid size-6 place-items-center rounded-xl border transition ${
          checked ? "border-[#3b91f6] bg-[#3b91f6]" : "border-[#384452] bg-[#11161c]"
        }`}
      >
        <input
          className="sr-only"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {checked ? <span className="size-2 rounded-sm bg-white" /> : null}
      </span>
      {label}
    </label>
  );
}

function isHiddenByCompactFilter(
  market: Market,
  hiddenFilters: Record<HiddenMarketFilter, boolean>,
) {
  const text = `${market.title} ${market.category ?? ""} ${market.topics.join(" ")}`.toLowerCase();

  if (hiddenFilters.sports && /\b(sports|esports|nba|nfl|nhl|fifa|uefa|game\s+\d|dota|lol|cs2)\b/.test(text)) {
    return true;
  }

  if (hiddenFilters.crypto && /\b(crypto|bitcoin|btc|ethereum|eth|solana|sol)\b/.test(text)) {
    return true;
  }

  if (hiddenFilters.earnings && /\b(earnings|revenue|eps|stock|nasdaq|nyse)\b/.test(text)) {
    return true;
  }

  return false;
}

function IconButton({
  label,
  children,
  onClick,
  pressed,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      className={`home-soft-button relative grid h-10 w-10 place-items-center overflow-visible rounded-full border border-transparent bg-transparent transition ${
        pressed
          ? "text-[#56a3ff] drop-shadow-[0_0_10px_rgba(59,145,246,0.45)]"
          : "text-[#8f9aa8] hover:text-[#56a3ff]"
      }`}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      type="button"
    >
      <span className="z-10 grid place-items-center">{children}</span>
    </button>
  );
}

type TapRipple = {
  id: number;
  size: number;
  x: number;
  y: number;
};

function useTapRipples<T extends HTMLElement>(rootRef: React.RefObject<T | null>) {
  const [ripples, setRipples] = React.useState<TapRipple[]>([]);

  const addRipple = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }

      const bounds = root.getBoundingClientRect();
      const size = Math.max(bounds.width, bounds.height) * 2.25;
      const id = window.performance.now();

      setRipples((current) => [
        ...current.slice(-3),
        {
          id,
          size,
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
      ]);
    },
    [rootRef],
  );

  const removeRipple = React.useCallback((id: number) => {
    setRipples((current) => current.filter((ripple) => ripple.id !== id));
  }, []);

  return { ripples, addRipple, removeRipple };
}

function RippleLayer({
  ripples,
  onRippleEnd,
}: {
  ripples: TapRipple[];
  onRippleEnd: (id: number) => void;
}) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]">
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="tap-ripple absolute rounded-full bg-[#3b91f6]/45"
          onAnimationEnd={() => onRippleEnd(ripple.id)}
          style={{
            height: ripple.size,
            left: ripple.x,
            top: ripple.y,
            width: ripple.size,
          }}
        />
      ))}
    </span>
  );
}

function isTopicTabActive(filters: MarketFilters, tab: TopicTab) {
  return Object.entries(tab.filter).every(([key, value]) => {
    return filters[key as keyof MarketFilters] === value;
  });
}
