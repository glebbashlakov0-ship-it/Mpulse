import type { MarketFilters } from "./types";

export const DISCOVERY_PAGE_SIZE = 36;

export const defaultMarketFilters: MarketFilters = {
  search: "",
  category: "",
  topic: "all",
  sort: "trending",
  status: "live",
  minVolume: "",
  maxVolume: "",
  closingAfter: "",
  closingBefore: "",
};

export type PrimaryNavItem = {
  label: string;
  filter: Pick<MarketFilters, "category" | "topic" | "sort">;
};

export const primaryNav: PrimaryNavItem[] = [
  { label: "Trending", filter: { category: "", topic: "all", sort: "trending" } },
  { label: "Breaking", filter: { category: "", topic: "all", sort: "closing_soon" } },
  { label: "New", filter: { category: "", topic: "all", sort: "newest" } },
  { label: "Politics", filter: { category: "politics", topic: "all", sort: "trending" } },
  { label: "Sports", filter: { category: "sports", topic: "all", sort: "trending" } },
  { label: "Crypto", filter: { category: "crypto", topic: "all", sort: "trending" } },
  { label: "Esports", filter: { category: "", topic: "esports", sort: "trending" } },
  { label: "Finance", filter: { category: "finance", topic: "all", sort: "trending" } },
  { label: "Tech", filter: { category: "tech", topic: "all", sort: "trending" } },
  { label: "Culture", filter: { category: "culture", topic: "all", sort: "trending" } },
  { label: "Economy", filter: { category: "economy", topic: "all", sort: "trending" } },
  { label: "Weather", filter: { category: "weather", topic: "all", sort: "trending" } },
  { label: "Mentions", filter: { category: "", topic: "social", sort: "trending" } },
  { label: "Elections", filter: { category: "", topic: "elections", sort: "trending" } },
];

export const topicTabs = [
  { label: "All", value: "all" },
  { label: "Trump", value: "trump" },
  { label: "Iran", value: "iran" },
  { label: "Indian Elections", value: "elections" },
  { label: "GPT-5.5", value: "ai" },
  { label: "Strait of Hormuz", value: "hormuz" },
  { label: "Fed Chair", value: "fed" },
  { label: "Oil", value: "oil" },
  { label: "NBA", value: "sports" },
  { label: "Iceman", value: "culture" },
  { label: "Daily Temperature", value: "weather" },
  { label: "Tweet Markets", value: "social" },
] satisfies Array<{ label: string; value: string }>;

export const sortOptions = [
  { label: "Trending", value: "trending" },
  { label: "Volume", value: "volume" },
  { label: "Liquidity", value: "liquidity" },
  { label: "Newest", value: "newest" },
  { label: "Closing soon", value: "closing_soon" },
  { label: "Relevance", value: "relevance" },
] satisfies Array<{ label: string; value: MarketFilters["sort"] }>;

const sortValues = new Set(sortOptions.map((option) => option.value));
const statusValues = new Set(["all", "live", "upcoming", "closed", "expired"]);

function getBackendCategory(topic: string) {
  if (["sports", "culture", "weather"].includes(topic)) {
    return topic;
  }

  if (topic === "ai") {
    return "tech";
  }

  return null;
}

function getSearchParam(params: URLSearchParams, key: string) {
  return params.get(key)?.trim() ?? "";
}

export function getFiltersFromUrl({
  searchParams,
  category,
  topic,
}: {
  searchParams: URLSearchParams;
  category?: string;
  topic?: string;
}): MarketFilters {
  const sort = getSearchParam(searchParams, "sort");
  const status = getSearchParam(searchParams, "status");
  const routeCategory = category ? decodeURIComponent(category).trim() : "";
  const routeTopic = topic ? decodeURIComponent(topic).trim() : "";

  return {
    ...defaultMarketFilters,
    search: getSearchParam(searchParams, "search") || getSearchParam(searchParams, "q"),
    category: routeCategory || getSearchParam(searchParams, "category"),
    topic: routeTopic || getSearchParam(searchParams, "topic") || defaultMarketFilters.topic,
    sort: sortValues.has(sort as MarketFilters["sort"])
      ? (sort as MarketFilters["sort"])
      : defaultMarketFilters.sort,
    status: statusValues.has(status as MarketFilters["status"])
      ? (status as MarketFilters["status"])
      : defaultMarketFilters.status,
    minVolume: getSearchParam(searchParams, "min_volume"),
    maxVolume: getSearchParam(searchParams, "max_volume"),
    closingAfter: getSearchParam(searchParams, "closing_after"),
    closingBefore: getSearchParam(searchParams, "closing_before"),
  };
}

export function getDiscoveryPath(filters: MarketFilters) {
  if (filters.category) {
    return `/markets/category/${encodeURIComponent(filters.category)}`;
  }

  if (filters.topic !== "all") {
    return `/markets/topic/${encodeURIComponent(filters.topic)}`;
  }

  return "/markets";
}

export function getDiscoverySearch(filters: MarketFilters) {
  const params = new URLSearchParams();

  if (filters.search.trim()) {
    params.set("search", filters.search.trim());
  }

  if (filters.sort !== defaultMarketFilters.sort) {
    params.set("sort", filters.sort);
  }

  if (filters.status !== defaultMarketFilters.status) {
    params.set("status", filters.status);
  }

  if (filters.minVolume.trim()) {
    params.set("min_volume", filters.minVolume.trim());
  }

  if (filters.maxVolume.trim()) {
    params.set("max_volume", filters.maxVolume.trim());
  }

  if (filters.closingAfter) {
    params.set("closing_after", filters.closingAfter);
  }

  if (filters.closingBefore) {
    params.set("closing_before", filters.closingBefore);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getDiscoveryUrl(filters: MarketFilters) {
  return `${getDiscoveryPath(filters)}${getDiscoverySearch(filters)}`;
}

export function mergeDiscoveryFilters(
  filters: MarketFilters,
  patch: Partial<MarketFilters>,
): MarketFilters {
  return {
    ...filters,
    ...patch,
    category: patch.category !== undefined ? patch.category : filters.category,
    topic:
      patch.category !== undefined && patch.category
        ? "all"
        : patch.topic !== undefined
          ? patch.topic
          : filters.topic,
  };
}

export function buildMarketSearchParams(
  filters: MarketFilters,
  {
    limit = DISCOVERY_PAGE_SIZE,
    offset = 0,
  }: {
    limit?: number;
    offset?: number;
  } = {},
) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
    sort: filters.sort,
  });
  const backendCategory = filters.category || getBackendCategory(filters.topic);
  const backendSearch = filters.search.trim();

  if (backendCategory) {
    params.set("category", backendCategory);
  }

  if (backendSearch) {
    params.set("search", backendSearch);
  }

  if (filters.topic !== "all") {
    params.set("topic", filters.topic);
  }

  if (filters.status !== "all") {
    params.set("status", filters.status);
  }

  if (filters.status === "live" || filters.status === "upcoming") {
    params.set("active", "true");
    params.set("closed", "false");
  } else if (filters.status === "closed") {
    params.set("closed", "true");
  }

  if (filters.minVolume.trim()) {
    params.set("min_volume", filters.minVolume.trim());
  }

  if (filters.maxVolume.trim()) {
    params.set("max_volume", filters.maxVolume.trim());
  }

  if (filters.closingAfter) {
    params.set("closing_after", new Date(filters.closingAfter).toISOString());
  }

  if (filters.closingBefore) {
    params.set("closing_before", new Date(filters.closingBefore).toISOString());
  }

  return params;
}
