import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Filter, X } from "lucide-react";
import { MarketCard } from "../components/MarketCard";
import { MarketSkeleton } from "../components/MarketSkeleton";
import { useMarkets } from "../hooks/useMarkets";
import { useCategories } from "../hooks/useCategories";
import {
  defaultMarketFilters,
  getDiscoveryUrl,
  getFiltersFromUrl,
  mergeDiscoveryFilters,
  sortOptions,
  topicTabs,
} from "../lib/discovery";
import type { AuthUser, Market, MarketFilters } from "../lib/types";

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
  const [marketsState, , loadMore] = useMarkets(filters);
  const categoriesState = useCategories();

  const markets = marketsState.data;
  const loading = marketsState.status === "loading";
  const error = marketsState.message;
  const categories = categoriesState.data;

  const updateFilter = <K extends keyof MarketFilters>(
    key: K,
    value: MarketFilters[K],
  ) => {
    const nextFilters = mergeDiscoveryFilters(filters, { [key]: value });
    navigate(getDiscoveryUrl(nextFilters));
  };

  const clearFilters = () => {
    navigate("/markets");
  };

  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) =>
      value !== "" &&
      value !== "all" &&
      value !== defaultMarketFilters[key as keyof MarketFilters],
  ).length;
  const hasMore = marketsState.nextOffset !== null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Search and Filters */}
        <div className="mb-6 space-y-4">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={t("markets.search")}
                value={filters.search}
                onChange={(e) => updateFilter("search", e.target.value)}
                className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              aria-label={t("markets.filters")}
              aria-expanded={showFilters}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 hover:bg-gray-50"
            >
              <Filter className="size-5" />
              {t("markets.filters")}
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-blue-500 px-2 py-0.5 text-xs text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Topic Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {topicTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => navigate(getDiscoveryUrl({ ...filters, category: "", topic: tab.value }))}
                aria-pressed={filters.topic === tab.value}
                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  filters.topic === tab.value
                    ? "bg-blue-500 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Advanced Filters */}
          {showFilters && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold">{t("markets.filters")}</h3>
                <button
                  onClick={() => setShowFilters(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label htmlFor="market-sort-filter" className="mb-1 block text-sm font-medium text-gray-700">
                    {t("markets.sort")}
                  </label>
                  <select
                    id="market-sort-filter"
                    aria-label={t("markets.sort")}
                    value={filters.sort}
                    onChange={(e) =>
                      updateFilter("sort", e.target.value as MarketFilters["sort"])
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="market-category-filter" className="mb-1 block text-sm font-medium text-gray-700">
                    {t("markets.category")}
                  </label>
                  <select
                    id="market-category-filter"
                    aria-label={t("markets.category")}
                    value={filters.category}
                    onChange={(e) => updateFilter("category", e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">{t("markets.all")}</option>
                    {categories.map((category) => (
                      <option key={category.slug} value={category.slug}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="market-status-filter" className="mb-1 block text-sm font-medium text-gray-700">
                    {t("markets.status")}
                  </label>
                  <select
                    id="market-status-filter"
                    aria-label={t("markets.status")}
                    value={filters.status}
                    onChange={(e) =>
                      updateFilter("status", e.target.value as MarketFilters["status"])
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="all">{t("markets.all")}</option>
                    <option value="live">{t("markets.live")}</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="closed">{t("markets.closed")}</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={clearFilters}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  {t("common.clear")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Markets Grid */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        {loading && markets.length === 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <MarketSkeleton key={i} />
            ))}
          </div>
        ) : markets.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-500">
              {t("markets.noResults")}
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {markets.map((market) => (
                <MarketCard
                  key={market.id}
                  market={market}
                  onOpen={() => navigate(`/markets/${market.id}`)}
                  isWatched={watchlistIds.has(market.id)}
                  onWatchlistToggle={() => onWatchlistToggle(market)}
                />
              ))}
            </div>
            <div className="mt-8 flex justify-center">
              {hasMore ? (
                <button
                  className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 disabled:opacity-60"
                  onClick={() => void loadMore()}
                  disabled={marketsState.isLoadingMore}
                  type="button"
                >
                  {marketsState.isLoadingMore ? "Loading..." : "Load more"}
                </button>
              ) : marketsState.total !== null ? (
                <span className="text-sm font-medium text-gray-500">
                  Showing {markets.length} of {marketsState.total} markets
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
