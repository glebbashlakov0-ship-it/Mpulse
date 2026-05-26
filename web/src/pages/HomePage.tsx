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
import { formatMoney, formatPercent, formatShortDate } from "../lib/format";
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
  watchlistMarkets,
  onWatchlistToggle,
  onSignupPrompt,
}: {
  user: AuthUser | null;
  watchlistIds: Set<string>;
  watchlistMarkets: Market[];
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
  const [isInlineSearchOpen, setIsInlineSearchOpen] = React.useState(false);
  const [showWatchlist, setShowWatchlist] = React.useState(false);
  const [showFilters, setShowFilters] = React.useState(false);
  const [topicRailScroll, setTopicRailScroll] = React.useState({
    canScrollLeft: false,
    canScrollRight: false,
  });
  const topicTabsRef = React.useRef<HTMLDivElement | null>(null);
  const inlineSearchRef = React.useRef<HTMLDivElement | null>(null);
  const inlineSearchInputRef = React.useRef<HTMLInputElement | null>(null);
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

  const clearFilters = React.useCallback(() => {
    setHiddenMarketFilters({
      sports: false,
      crypto: false,
      earnings: false,
    });
    navigate(getDiscoveryUrl(defaultMarketFilters));
  }, [navigate]);

  const visibleMarkets = React.useMemo(
    () => markets.filter((market) => !isHiddenByCompactFilter(market, hiddenMarketFilters)),
    [hiddenMarketFilters, markets],
  );
  const visibleWatchlistMarkets = React.useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return watchlistMarkets.filter(
      (market) =>
        !isHiddenByCompactFilter(market, hiddenMarketFilters) &&
        marketMatchesSearch(market, search),
    );
  }, [filters.search, hiddenMarketFilters, watchlistMarkets]);
  const displayedMarkets = showWatchlist
    ? visibleWatchlistMarkets
    : visibleMarkets;

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
      setTopicRailScroll({ canScrollLeft: false, canScrollRight: false });
      return;
    }

    const remainingScroll = rail.scrollWidth - rail.clientWidth - rail.scrollLeft;
    setTopicRailScroll({
      canScrollLeft: rail.scrollLeft > 2,
      canScrollRight: remainingScroll > 2,
    });
  }, []);
  const handleLoadMore = React.useCallback(() => {
    if (!user) {
      onSignupPrompt();
      return;
    }

    void loadMore();
  }, [loadMore, onSignupPrompt, user]);
  const openInlineSearch = React.useCallback(() => {
    setIsInlineSearchOpen(true);
    window.requestAnimationFrame(() => inlineSearchInputRef.current?.focus());
  }, []);
  React.useEffect(() => {
    if (user) {
      return;
    }

    setShowWatchlist(false);
  }, [user]);
  React.useEffect(() => {
    if (!isInlineSearchOpen) {
      return undefined;
    }

    function closeSearchOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        inlineSearchRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsInlineSearchOpen(false);
    }

    document.addEventListener("pointerdown", closeSearchOnOutsidePointer);

    return () => {
      document.removeEventListener("pointerdown", closeSearchOnOutsidePointer);
    };
  }, [isInlineSearchOpen]);
  React.useEffect(() => {
    if (!showTopicRail) {
      setTopicRailScroll({ canScrollLeft: false, canScrollRight: false });
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
    const rail = topicTabsRef.current;

    if (!rail) {
      return;
    }

    if (topicRailScroll.canScrollRight) {
      rail.scrollBy({
        left: Math.round(rail.clientWidth * 0.5),
        behavior: "smooth",
      });
      return;
    }

    rail.scrollTo({
      left: 0,
      behavior: "smooth",
    });
  };

  return (
    <div className="home-page-shell min-h-screen bg-[#15191d] text-[#dee3e7]">
      <div className="mx-auto max-w-[1350px] px-4 py-5 lg:px-6">
        {showPageHeader ? (
          <section className="home-reveal relative z-30 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-normal text-[#dee3e7]">
                  {getSurfaceTitle(surface)}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <div
                  ref={inlineSearchRef}
                  className={`relative h-10 shrink-0 overflow-hidden rounded-2xl transition-[width] duration-300 ease-out ${
                    isInlineSearchOpen ? "w-[min(240px,calc(100vw-150px))]" : "w-10"
                  }`}
                >
                  <button
                    className={`absolute inset-0 z-10 grid place-items-center rounded-full bg-transparent text-[#7b8996] transition-opacity duration-150 hover:text-[#26a3fd] ${
                      isInlineSearchOpen ? "pointer-events-none opacity-0" : "opacity-100"
                    }`}
                    aria-label="Search markets"
                    onClick={openInlineSearch}
                    type="button"
                  >
                    <Search size={21} />
                  </button>
                  <div
                    className={`relative h-10 rounded-2xl text-[#7b8996] transition-[opacity,transform] duration-200 ease-out ${
                      isInlineSearchOpen
                        ? "pointer-events-auto translate-x-0 opacity-100"
                        : "pointer-events-none translate-x-2 opacity-0"
                    }`}
                  >
                    <Search
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#7b8996]"
                      size={18}
                    />
                    <kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#586879]">
                      /
                    </kbd>
                    <input
                      ref={inlineSearchInputRef}
                      aria-label="Search current markets"
                      className="flex h-10 w-full rounded-2xl border border-transparent bg-[var(--pm-surface-2)] py-1 pl-11 pr-9 text-sm font-medium text-[var(--pm-text-primary)] outline-none placeholder:text-[var(--pm-text-secondary)] transition-[box-shadow,background-color] duration-200 hover:bg-[var(--pm-surface-2)] focus:bg-[var(--pm-surface-2)] focus:ring-0"
                      disabled={!isInlineSearchOpen}
                      placeholder="Search markets..."
                      type="search"
                      value={filters.search}
                      onChange={(event) => updateFilter("search", event.target.value)}
                    />
                  </div>
                </div>
                <IconButton
                  label={t("markets.filters")}
                  pressed={showFilters}
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <SlidersHorizontal size={21} />
                </IconButton>
                <IconButton
                  label="Watchlist"
                  pressed={Boolean(user && showWatchlist)}
                  onClick={() => {
                    if (!user) {
                      onSignupPrompt();
                      return;
                    }

                    setShowWatchlist((current) => !current);
                  }}
                >
                  <Bookmark size={21} />
                </IconButton>
              </div>
            </div>

            {showTopicRail ? (
              <div className="home-reveal flex items-center gap-3">
                <div
                  className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  ref={topicTabsRef}
                >
                  <div className="flex w-max gap-2 py-1.5 pl-1 text-sm font-semibold">
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
                          className={`relative flex min-w-fit items-center whitespace-nowrap rounded-lg px-3 py-1.5 leading-5 transition-colors duration-150 focus-visible:outline-none ${
                            isActive
                              ? "bg-[#112f45] text-[#0093fd]"
                              : "bg-transparent text-[#7b8996] hover:text-[#dee3e7]"
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {topicRailScroll.canScrollRight || topicRailScroll.canScrollLeft ? (
                  <button
                    aria-label={
                      topicRailScroll.canScrollRight
                        ? "Scroll market topics"
                        : "Back to first market topic"
                    }
                    className="grid h-8 w-6 shrink-0 place-items-center bg-transparent text-[#7b8996] transition-colors duration-150 hover:text-[#26a3fd] focus-visible:outline-none focus-visible:text-[#26a3fd]"
                    onClick={scrollTopicTabs}
                    type="button"
                  >
                    <ChevronRight
                      className={`transition-transform duration-200 ease-out ${
                        topicRailScroll.canScrollRight ? "rotate-0" : "rotate-180"
                      }`}
                      size={21}
                    />
                  </button>
                ) : null}
              </div>
            ) : null}

            <div
              aria-hidden={!showFilters}
              className="home-filter-region"
              data-open={showFilters}
              inert={!showFilters}
            >
              <div
                className="home-filter-panel flex w-full flex-wrap items-center gap-x-2 gap-y-2 pt-2 lg:pt-2"
              >
                <CompactSelect
                  ariaLabel={t("markets.sort")}
                  icon={<TrendingUp size={18} />}
                  displayValue={selectedSortLabel}
                  options={sortOptions.map((option) => ({
                    label: getSortOptionLabel(option.value),
                    value: option.value,
                  }))}
                  value={filters.sort}
                  onChange={(value) => updateFilter("sort", value as MarketFilters["sort"])}
                />

                <CompactSelect
                  ariaLabel={t("markets.category")}
                  displayValue={selectedCategoryLabel}
                  options={[
                    { label: t("markets.all"), value: "" },
                    ...categories.map((category) => ({
                      label: category.label,
                      value: category.slug,
                    })),
                  ]}
                  value={filters.category}
                  onChange={(value) => updateFilter("category", value)}
                />

                <CompactSelect
                  ariaLabel={t("markets.status")}
                  displayValue={selectedStatusLabel}
                  options={[
                    { label: "Active", value: "live" },
                    { label: t("markets.all"), value: "all" },
                    { label: "Upcoming", value: "upcoming" },
                    { label: t("markets.closed"), value: "closed" },
                    { label: "Expired", value: "expired" },
                  ]}
                  value={filters.status}
                  onChange={(value) => updateFilter("status", value as MarketFilters["status"])}
                />

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
                {activeFilterCount > 0 ? (
                  <button
                    className="home-soft-button ml-auto h-8 rounded-full px-3 text-xs font-semibold text-[#0093fd] transition hover:bg-[#1e2428] hover:text-[#26a3fd]"
                    onClick={clearFilters}
                    type="button"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {error && (
          <div className="home-reveal mt-5 rounded-2xl border border-[#cb3131]/30 bg-[#cb3131]/10 p-4 text-[#daa]">
            {error}
          </div>
        )}

        {loading && markets.length === 0 && !showWatchlist ? (
          <div className="home-reveal mt-5">
            <MarketSkeleton />
          </div>
        ) : displayedMarkets.length === 0 ? (
          showWatchlist ? (
            <div className="home-reveal flex min-h-[280px] items-start justify-center pt-20 text-center">
              <p className="text-base font-semibold text-[#7b8996]">
                {watchlistMarkets.length === 0
                  ? "No saved markets yet"
                  : "No saved markets match this search"}
              </p>
            </div>
          ) : (
            <div className="home-reveal mt-5 rounded-2xl border border-[#242b32] bg-[#181d21] p-12 text-center">
              <p className="text-[#7b8996]">
                {t("markets.noResults")}
              </p>
            </div>
          )
        ) : (
          <div
            className="home-surface-enter"
            key={showWatchlist ? `watchlist-${filters.search}` : getHomeSurfaceMotionKey(surface, filters)}
          >
            {showWatchlist ? (
              <MarketGrid
                columns="grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
                markets={displayedMarkets}
                onOpenMarket={(market) => navigate(`/markets/${encodeURIComponent(market.slug ?? market.id)}`)}
                onWatchlistToggle={onWatchlistToggle}
                watchlistIds={watchlistIds}
              />
            ) : (
              <MarketSurface
                filters={filters}
                hasMore={hasMore}
                isLoadingMore={marketsState.isLoadingMore}
                markets={displayedMarkets}
                onLoadMore={handleLoadMore}
                onOpenMarket={(market) => navigate(`/markets/${encodeURIComponent(market.slug ?? market.id)}`)}
                onWatchlistToggle={user ? onWatchlistToggle : onSignupPrompt}
                surface={surface}
                total={marketsState.total}
                watchlistIds={watchlistIds}
              />
            )}
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
    return (
      <>
        <BreakingSurface markets={markets} onOpenMarket={onOpenMarket} />
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

  if (surface === "sports" || surface === "esports") {
    return (
      <>
        <CategorySurface
          columns="grid-cols-1 md:grid-cols-2 2xl:grid-cols-3"
          filters={filters}
          markets={markets}
          onOpenMarket={onOpenMarket}
          onWatchlistToggle={onWatchlistToggle}
          sidebarItems={getSidebarItems(surface, markets)}
          surface={surface}
          topTabs={
            surface === "esports"
              ? ["All", "Dota 2", "LoL", "CS2", "Valorant"]
              : ["All", "EPL", "NBA", "MLB", "UFC", "Soccer", "Tennis"]
          }
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

  if (surface === "mentions") {
    return (
      <>
        <MentionsSurface markets={markets} onOpenMarket={onOpenMarket} />
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

  if (surface === "weather") {
    return (
      <>
        <WeatherSurface
          markets={markets}
          onOpenMarket={onOpenMarket}
          onWatchlistToggle={onWatchlistToggle}
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
                    ? "bg-[#112f45] text-[#26a3fd]"
                    : "text-[#7b8996] hover:bg-[#1e2428] hover:text-[#dee3e7]"
                }`}
                key={label}
                type="button"
              >
                {label}
              </button>
            ),
          )}
        </div>
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
  const rows = markets;
  const dateLabel = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="mt-5 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0">
        <div className="home-reveal relative mb-6 overflow-hidden rounded-2xl border border-[#242b32] bg-[#1e2428] px-7 py-8">
          <div className="absolute right-6 top-1/2 hidden h-48 w-72 -translate-y-1/2 rounded-full border border-[#0b568d]/35 md:block" />
          <div className="absolute right-28 top-12 hidden h-20 w-20 rotate-12 rounded-[28px] bg-[#0093fd] md:grid md:place-items-center">
            <TrendingUp size={44} className="text-white" />
          </div>
          <p className="text-sm font-semibold text-[#7b8996]">{dateLabel}</p>
          <h2 className="mt-4 text-3xl font-bold text-[#dee3e7]">Breaking News</h2>
          <p className="mt-3 max-w-xl text-base font-medium text-[#7b8996]">
            The markets that moved the most in the last 24 hours.
          </p>
        </div>

        <SegmentRail
          active="All"
          labels={["All", "Politics", "World", "Sports", "Crypto", "Finance", "Tech", "Culture"]}
          onSelect={() => undefined}
        />

        <div className="mt-6 divide-y divide-[#242b32]">
          {rows.map((market, index) => (
            <button
              className="home-stagger-item grid w-full grid-cols-[28px_54px_minmax(0,1fr)_92px_96px_20px] items-center gap-4 py-5 text-left transition hover:bg-[#1e2428]/65 max-md:grid-cols-[24px_48px_minmax(0,1fr)_72px_20px] max-md:[&_.spark]:hidden"
              key={market.id}
              onClick={() => onOpenMarket(market)}
              style={getMotionDelayStyle(index)}
              type="button"
            >
              <span className="text-center text-sm font-semibold text-[#7b8996]">{index + 1}</span>
              <MarketImage
                market={market}
                className="size-12 rounded-lg"
                fetchPriority={index < 5 ? "high" : "auto"}
                loading={index < 5 ? "eager" : "lazy"}
              />
              <span className="min-w-0">
                <span className="line-clamp-2 text-[17px] font-semibold text-[#dee3e7]">{market.title}</span>
                <span className="mt-1 flex items-center gap-1 text-sm font-bold text-[#3db468]">
                  {getPrimaryMarketPercent(market)} <span>{getMovementLabel(market)}</span>
                </span>
              </span>
              <Sparkline market={market} />
              <span className="text-right text-2xl font-semibold text-[#dee3e7] max-md:text-lg">
                {getPrimaryMarketPercent(market)}
              </span>
              <ChevronRight className="text-[#7b8996]" size={20} />
            </button>
          ))}
        </div>
      </section>

      <aside className="home-reveal space-y-6">
        <div className="home-soft-card rounded-2xl border border-[#242b32] bg-[#181d21] p-5">
          <div className="mb-4 flex items-start gap-3">
            <Bell className="mt-1 text-[#7b8996]" size={24} />
            <div>
              <h3 className="text-base font-bold text-[#dee3e7]">Get daily updates</h3>
              <p className="text-sm font-medium text-[#7b8996]">
                We'll send you an email every day with what's moving.
              </p>
            </div>
          </div>
          <input
            className="mb-3 h-11 w-full rounded-xl border border-[#242b32] bg-[#1e2428] px-4 text-sm font-semibold text-[#dee3e7] outline-none"
            readOnly
            value="john.amerema@gmail.com"
          />
          <button className="home-soft-button h-11 w-full rounded-xl bg-[#0093fd] text-sm font-bold text-white" type="button">
            Get updates
          </button>
        </div>

        <div className="home-soft-card rounded-2xl border border-[#242b32] bg-[#181d21] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-[#7b8996]">Live from @Polymarket</h3>
            <button className="home-soft-button rounded-full bg-white px-4 py-2 text-sm font-bold text-[#181d21]" type="button">
              Follow on X
            </button>
          </div>
          {getNewsItems(markets).map((item) => (
            <div className="border-t border-[#242b32] py-4" key={`${item.time}-${item.title}`}>
              <div className="mb-2 flex items-center justify-between gap-4 text-sm font-semibold text-[#7b8996]">
                <span>{item.kind}</span>
                <span>{item.time}</span>
              </div>
              <p className="text-sm font-medium leading-6 text-[#97a5b4]">{item.title}</p>
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
        { label: "Live", count: 6, icon: <Radio size={18} className="text-[#cb3131]" /> },
        { label: "Upcoming", count: 37, icon: <CalendarDays size={18} /> },
        { label: "Dota 2", count: 12 },
        { label: "LoL", count: 8 },
        { label: "CS2", count: 6 },
        { label: "Valorant", count: 5 },
        { label: "Rocket League", count: 4 },
      ]
    : [
        { label: "Live", icon: <Radio size={18} className="text-[#cb3131]" /> },
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
          <h2 className="text-4xl font-bold text-[#dee3e7]">{esport ? "Esports Live" : "Sports Live"}</h2>
          <div className="flex items-center gap-2 text-[#d2d8df]">
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
            <div className="grid grid-cols-[minmax(0,1fr)_140px_140px_140px] px-2 text-xs font-bold uppercase tracking-wide text-[#697d91] max-lg:hidden">
              <h3 className="text-xl font-bold normal-case text-[#dee3e7]">{section}</h3>
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
      className={`home-soft-card rounded-2xl border bg-[#181d21] p-4 transition ${
        active ? "border-[#0093fd]/70" : "border-[#242b32] hover:border-[#0093fd]/35"
      }`}
    >
      <button
        className="mb-4 flex w-full items-center justify-between gap-3 text-left"
        onClick={() => onSelect(market)}
        type="button"
      >
        <div className="min-w-0 text-sm font-bold text-[#7b8996]">
          <span className="mr-2 text-[#cb3131]">● LIVE</span>
          <span>{index % 2 === 0 ? "Today" : "Final"}</span>
          <span className="mx-1">·</span>
          <span>{formatMoney(market.volume)} Vol.</span>
        </div>
        <span className="rounded-xl bg-[#242b32] px-3 py-1.5 text-sm font-bold text-[#d2d8df]">
          Game View <ChevronRight className="inline" size={14} />
        </span>
      </button>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_140px_140px_140px]">
        <div className="space-y-3">
          {[first, second].map((team, teamIndex) => (
            <div className="flex items-center gap-3" key={`${market.id}-${team}-${teamIndex}`}>
              <MarketImage
                market={market}
                className="size-8 rounded-md"
                fetchPriority={index < 4 ? "high" : "auto"}
                loading={index < 4 ? "eager" : "lazy"}
              />
              <span className="min-w-0 truncate text-base font-bold text-[#d2d8df]">{team}</span>
            </div>
          ))}
        </div>
        <SportsbookButtons tone={esport ? "blue" : "red"} labels={[first, second]} />
        <SportsbookButtons tone="dark" labels={[shortLabel(first), shortLabel(second)]} />
        <SportsbookButtons tone="dark" labels={["Over", "Under"]} />
      </div>
    </article>
  );
}

function SportsbookButtons({
  labels,
  tone,
}: {
  labels: string[];
  tone: "blue" | "dark" | "red";
}) {
  const toneClass =
    tone === "blue"
      ? "bg-[#0093fd] text-white shadow-[0_4px_0_rgba(0,0,0,0.28)]"
      : tone === "red"
        ? "bg-[#cb3131] text-white shadow-[0_4px_0_rgba(0,0,0,0.28)]"
        : "bg-[#242b32] text-[#97a5b4]";

  return (
    <div className="grid grid-rows-2 gap-2">
      {labels.slice(0, 2).map((label, index) => (
        <button
          className={`home-soft-button h-11 rounded-xl px-3 text-sm font-bold transition hover:brightness-110 ${toneClass}`}
          key={`${label}-${index}`}
          type="button"
        >
          <span className="block truncate">{label}</span>
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
    <aside className="home-reveal sticky top-36 h-fit rounded-2xl border border-[#242b32] bg-[#181d21]">
      <div className="flex items-center gap-3 border-b border-[#242b32] p-5">
        <MarketImage
          market={market}
          className="size-10 rounded-lg"
          fetchPriority="high"
          loading="eager"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#7b8996]">{market.title}</p>
          <h3 className="truncate text-lg font-bold text-[#dee3e7]">{first}</h3>
        </div>
      </div>
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-4 text-lg font-bold">
            <span className="border-b-2 border-[#d2d8df] pb-2 text-[#dee3e7]">Buy</span>
            <span className="pb-2 text-[#7b8996]">Sell</span>
          </div>
          <button className="flex items-center gap-1 text-sm font-bold text-[#d2d8df]" type="button">
            Market <ChevronDown size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            className={`home-soft-button h-14 rounded-xl text-base font-bold ${
              esport ? "bg-[#0093fd] text-white" : "bg-[#cb3131] text-white"
            }`}
            type="button"
          >
            {shortLabel(first)}
          </button>
          <button className="home-soft-button h-14 rounded-xl bg-[#242b32] text-base font-bold text-[#7b8996]" type="button">
            {shortLabel(second)}
          </button>
        </div>
        <div className="mt-8 flex items-end justify-between">
          <div>
            <p className="text-lg font-bold text-[#d2d8df]">Amount</p>
            <p className="text-sm font-semibold text-[#7b8996]">$0.00 cash</p>
          </div>
          <p className="text-5xl font-bold text-[#697d91]">$0</p>
        </div>
        <button className="home-soft-button mt-6 h-12 w-full rounded-xl bg-[#1e2428] text-sm font-bold text-[#586879]" type="button">
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
      <h2 className="text-3xl font-bold text-[#dee3e7]">Mention polymarkets</h2>
      <p className="mt-3 text-base font-medium text-[#7b8996]">
        Live events where you can predict the words and phrases that will be said.
      </p>
      <div className="mt-8 space-y-4">
        {markets.map((market, index) => (
          <button
            className="home-stagger-item grid w-full grid-cols-[64px_76px_minmax(0,1fr)_minmax(180px,360px)_86px] items-center gap-5 rounded-xl border border-[#242b32] bg-[#181d21] p-5 text-left transition hover:border-[#0093fd]/45 hover:bg-[#1e2428] max-lg:grid-cols-[54px_64px_minmax(0,1fr)_80px] max-lg:[&_.mention-tags]:hidden"
            key={market.id}
            onClick={() => onOpenMarket(market)}
            style={getMotionDelayStyle(index)}
            type="button"
          >
            <DateBadge market={market} index={index} />
            <MarketImage
              market={market}
              className="size-[70px] rounded-lg max-lg:size-14"
              fetchPriority={index < 4 ? "high" : "auto"}
              loading={index < 4 ? "eager" : "lazy"}
            />
            <span className="min-w-0">
              <span className="line-clamp-2 text-lg font-bold text-[#dee3e7]">{market.title}</span>
              <span className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-[#7b8996]">
                <span className="rounded-md bg-[#2e3841] px-2 py-1">{getMentionTime(index)}</span>
                {market.status === "live" ? <span className="text-[#cb3131]">LIVE</span> : null}
                <span>{formatMoney(market.volume)} Vol.</span>
              </span>
            </span>
            <span className="mention-tags flex min-w-0 justify-end gap-2">
              {getMentionTags(market).map((tag) => (
                <span className="truncate rounded-lg border border-[#242b32] px-3 py-2 text-sm font-bold text-[#d2d8df]" key={tag}>
                  {tag}
                </span>
              ))}
            </span>
            <span className="grid h-11 place-items-center rounded-lg bg-[#0093fd] text-sm font-bold text-white">
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
          <h2 className="text-3xl font-bold text-[#dee3e7]">Weather</h2>
          <SegmentRail
            active={activeDate}
            labels={["Globe", "May 17", "May 18", "May 19", "May 20", "May 21", "May 22"]}
            onSelect={setActiveDate}
          />
        </div>
        <GroupedWeatherCards
          markets={markets}
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
            <h3 className="text-xl font-bold text-[#dee3e7]">{group.title}</h3>
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
    <aside className="home-reveal sticky top-36 h-fit rounded-2xl border border-[#242b32] bg-[#181d21] p-5">
      <div className="mb-6 flex items-center gap-3">
        <MarketImage
          market={market}
          className="size-12 rounded-lg"
          fetchPriority="high"
          loading="eager"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#7b8996]">{market.title}</p>
          <p className="truncate text-lg font-bold text-[#dee3e7]">{first} · Yes</p>
        </div>
      </div>
      <div className="mb-5 flex gap-5 text-lg font-bold">
        <span className="border-b-2 border-[#d2d8df] pb-2 text-[#dee3e7]">Buy</span>
        <span className="pb-2 text-[#7b8996]">Sell</span>
        <span className="ml-auto flex items-center gap-1 text-sm text-[#d2d8df]">Market <ChevronDown size={16} /></span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button className="home-soft-button h-14 rounded-xl bg-[#3db468]/70 text-base font-bold text-white" type="button">
          Yes
        </button>
        <button className="home-soft-button h-14 rounded-xl bg-[#242b32] text-base font-bold text-[#7b8996]" type="button">
          No
        </button>
      </div>
      <div className="mt-8 flex items-end justify-between">
        <div>
          <p className="text-lg font-bold text-[#d2d8df]">Amount</p>
          <p className="text-sm font-semibold text-[#7b8996]">$0.00 cash</p>
        </div>
        <p className="text-5xl font-bold text-[#697d91]">$0</p>
      </div>
      <button className="home-soft-button mt-8 h-12 w-full rounded-xl bg-[#1e2428] text-sm font-bold text-[#586879]" type="button">
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
            onOpen={() => {
              onOpenMarket(market);
            }}
            isWatched={watchlistIds.has(market.id)}
            imageLoading={index < 8 ? "eager" : "lazy"}
            imagePriority={index < 8 ? "high" : "auto"}
            onWatchlistToggle={
              onWatchlistToggle ? () => onWatchlistToggle(market) : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}

function getMotionDelayStyle(index: number): React.CSSProperties {
  return {
    "--motion-delay": `${Math.min(index, 8) * 10}ms`,
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
          className="home-soft-button rounded-2xl border border-[#242b32] bg-[#1e2428] px-5 py-3 text-sm font-semibold text-[#dee3e7] transition hover:border-[#0093fd]/50 hover:bg-[#2e3841] disabled:opacity-60"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          aria-label={isLoadingMore ? "Loading more markets" : "Load more markets"}
          type="button"
        >
          {isLoadingMore ? (
            <span className="block h-5 w-24 py-0.5" aria-hidden="true">
              <span className="pm-shimmer block h-4 w-full rounded-full bg-[#242b32]" />
            </span>
          ) : (
            "Load more"
          )}
        </button>
      ) : total !== null ? (
        <span className="text-sm font-medium text-[#7b8996]">
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
              ? "bg-[#242b32] text-[#dee3e7]"
              : "text-[#97a5b4] hover:bg-[#1e2428] hover:text-[#dee3e7]"
          }`}
          key={item.label}
          onClick={() => onSelect(item.label)}
          type="button"
        >
          {item.icon ? <span className="grid size-5 place-items-center text-[#7b8996]">{item.icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.count !== undefined ? (
            <span className="text-xs font-bold text-[#586879]">{item.count}</span>
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
              ? "bg-[#112f45] text-[#26a3fd]"
              : "text-[#7b8996] hover:bg-[#1e2428] hover:text-[#dee3e7]"
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
        stroke={up ? "#3db468" : "#cb3131"}
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
      <span className="block text-2xl font-bold leading-none text-[#dee3e7]">{day}</span>
      <span className="mt-1 block text-base font-bold text-[#d2d8df]">{month}</span>
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
  displayValue,
  icon,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  displayValue: string;
  icon?: React.ReactNode;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="relative min-w-fit" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className={`home-soft-button inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-0 ${
          isOpen
            ? "border-[#2e3841] bg-[#242b32] text-[#dee3e7]"
            : "border-[#242b32] bg-[#1e2428] text-[#dee3e7] hover:bg-[#242b32]"
        }`}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {icon ? <span className="text-[#7b8996]">{icon}</span> : null}
        <span className="max-w-[180px] truncate">{displayValue}</span>
        <ChevronDown
          className={`size-3 text-[#7b8996] transition-transform duration-150 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen ? (
        <div
          className="absolute left-0 top-full z-[90] mt-2 max-h-72 min-w-full overflow-y-auto rounded-2xl border border-[#242b32] bg-[#181d21] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.36)]"
          role="menu"
        >
          {options.map((option) => {
            const isSelected = option.value === value;

            return (
              <button
                className={`flex h-9 w-full min-w-40 items-center justify-between gap-3 rounded-xl px-3 text-left text-sm font-semibold transition ${
                  isSelected
                    ? "bg-[#112f45] text-[#26a3fd]"
                    : "text-[#dee3e7] hover:bg-[#1e2428]"
                }`}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                role="menuitemradio"
                aria-checked={isSelected}
                type="button"
              >
                <span className="truncate">{option.label}</span>
                {isSelected ? <span className="size-1.5 rounded-full bg-[#26a3fd]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function getSortOptionLabel(value: MarketFilters["sort"]) {
  if (value === "trending") {
    return "Trending";
  }

  if (value === "volume") {
    return "Volume";
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
    <label className="home-soft-button inline-flex h-8 min-w-fit cursor-pointer items-center gap-2 rounded-full px-1 pr-2 text-xs font-medium text-[#dee3e7]">
      <span
        className={`grid size-4 place-items-center rounded-[4px] border transition ${
          checked ? "border-[#0093fd] bg-[#0093fd]" : "border-[#2e3841] bg-[#181d21]"
        }`}
      >
        <input
          className="sr-only"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {checked ? <span className="size-1.5 rounded-[2px] bg-white" /> : null}
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

function marketMatchesSearch(market: Market, search: string) {
  if (!search) {
    return true;
  }

  const text = `${market.title} ${market.category ?? ""} ${market.category_label ?? ""} ${market.topics.join(" ")}`.toLowerCase();

  return text.includes(search);
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
          ? "text-[#26a3fd] drop-shadow-[0_0_10px_rgba(0,147,253,0.42)]"
          : "text-[#7b8996] hover:text-[#26a3fd]"
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


function isTopicTabActive(filters: MarketFilters, tab: TopicTab) {
  return Object.entries(tab.filter).every(([key, value]) => {
    return filters[key as keyof MarketFilters] === value;
  });
}
