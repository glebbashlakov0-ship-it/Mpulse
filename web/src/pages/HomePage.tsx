import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bookmark, ChevronDown, ChevronRight, Search, SlidersHorizontal, TrendingUp } from "lucide-react";
import { MarketCard } from "../components/MarketCard";
import { MarketSkeleton } from "../components/MarketSkeleton";
import { useMarkets } from "../hooks/useMarkets";
import { useCategories } from "../hooks/useCategories";
import { useMarketTags } from "../hooks/useMarketTags";
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

export function HomePage({
  user,
  watchlistIds,
  onWatchlistToggle,
}: {
  user: AuthUser | null;
  watchlistIds: Set<string>;
  onWatchlistToggle: (market: Market) => void;
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
  const [showFilters, setShowFilters] = React.useState(false);
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
  const scrollTopicTabs = () => {
    topicTabsRef.current?.scrollBy({
      left: Math.round(topicTabsRef.current.clientWidth * 0.82),
      behavior: "smooth",
    });
  };

  return (
    <div className="min-h-screen bg-[#0f1318] text-[#edf1f5]">
      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal text-[#edf1f5]">All markets</h1>
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
                  <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-[#3b91f6] px-1 text-[11px] font-bold text-white">
                    {activeFilterCount}
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

          <div className="relative">
            <div
              className="flex gap-2 overflow-x-auto pb-2 pr-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              ref={topicTabsRef}
            >
              {discoveryTopicTabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() =>
                    navigate(getDiscoveryUrl(mergeDiscoveryFilters(filters, tab.filter)))
                  }
                  aria-pressed={isTopicTabActive(filters, tab)}
                  className={`min-w-fit whitespace-nowrap rounded-2xl border px-3.5 py-2 text-sm font-semibold transition ${
                    isTopicTabActive(filters, tab)
                      ? "border-[#3b91f6] bg-[#3b91f6] text-white shadow-[0_0_0_1px_rgba(59,145,246,0.18)]"
                      : "border-[#293440] bg-[#171d24] text-[#b8c1cc] hover:border-[#3b91f6]/50 hover:bg-[#1d252e] hover:text-[#edf1f5]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="pointer-events-none absolute bottom-2 right-0 top-0 flex w-16 justify-end bg-gradient-to-l from-[#0f1318] via-[#0f1318] to-transparent">
              <button
                aria-label="Scroll market topics"
                className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full text-[#8f9aa8] transition hover:bg-white/5 hover:text-[#edf1f5]"
                onClick={scrollTopicTabs}
                type="button"
              >
                <ChevronRight size={24} />
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <CompactSelect
                ariaLabel={t("markets.sort")}
                icon={<TrendingUp size={18} />}
                value={filters.sort}
                onChange={(value) => updateFilter("sort", value as MarketFilters["sort"])}
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === "trending"
                      ? "24hr Volume"
                      : option.value === "volume"
                        ? "Total Volume"
                      : option.value === "closing_soon"
                        ? "Closing soon"
                        : option.label}
                  </option>
                ))}
              </CompactSelect>

              <CompactSelect
                ariaLabel={t("markets.category")}
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

        {error && (
          <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            {error}
          </div>
        )}

        {loading && markets.length === 0 ? (
          <div className="mt-5">
            <MarketSkeleton />
          </div>
        ) : visibleMarkets.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-[#293440] bg-[#11161c] p-12 text-center">
            <p className="text-[#8f9aa8]">
              {t("markets.noResults")}
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleMarkets.map((market) => (
                <MarketCard
                  key={market.id}
                  market={market}
                  onOpen={() => navigate(`/markets/${market.id}`)}
                  isWatched={watchlistIds.has(market.id)}
                  onWatchlistToggle={user ? () => onWatchlistToggle(market) : undefined}
                />
              ))}
            </div>
            <div className="mt-8 flex justify-center">
              {hasMore ? (
                <button
                  className="rounded-2xl border border-[#293440] bg-[#171d24] px-5 py-3 text-sm font-semibold text-[#edf1f5] transition hover:border-[#3b91f6]/50 hover:bg-[#1d252e] disabled:opacity-60"
                  onClick={() => void loadMore()}
                  disabled={marketsState.isLoadingMore}
                  type="button"
                >
                  {marketsState.isLoadingMore ? "Loading..." : "Load more"}
                </button>
              ) : marketsState.total !== null ? (
                <span className="text-sm font-medium text-[#8f9aa8]">
                  Showing {visibleMarkets.length} of {marketsState.total} markets
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CompactSelect({
  ariaLabel,
  children,
  icon,
  value,
  onChange,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative inline-flex h-11 min-w-fit items-center gap-2 rounded-full bg-[#20272f] pl-4 pr-9 text-sm font-bold text-[#d8dde3] transition hover:bg-[#29313a]">
      {icon ? <span className="text-[#d8dde3]">{icon}</span> : null}
      <select
        aria-label={ariaLabel}
        className="max-w-[180px] appearance-none bg-transparent pr-1 text-sm font-bold text-[#d8dde3] outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-[#8f9aa8]" />
    </label>
  );
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
    <label className="inline-flex h-11 min-w-fit items-center gap-2 rounded-full px-1 pr-3 text-sm font-semibold text-[#d8dde3]">
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
      className={`relative grid h-10 w-10 place-items-center rounded-2xl border transition ${
        pressed
          ? "border-[#8f9aa8] bg-[#20272f] text-[#edf1f5]"
          : "border-[#293440] bg-[#171d24] text-[#8f9aa8] hover:border-[#8f9aa8]/70 hover:text-[#edf1f5]"
      }`}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function isTopicTabActive(filters: MarketFilters, tab: TopicTab) {
  return Object.entries(tab.filter).every(([key, value]) => {
    return filters[key as keyof MarketFilters] === value;
  });
}
