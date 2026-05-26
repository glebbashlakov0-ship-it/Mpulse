import type { MarketFilters, MarketTag } from "./types";

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
  filter: Pick<MarketFilters, "category" | "topic" | "sort"> &
    Partial<Pick<MarketFilters, "search">>;
};

export type TopicTab = {
  label: string;
  value: string;
  filter: Partial<MarketFilters>;
};

export const primaryNav: PrimaryNavItem[] = [
  { label: "Trending", filter: { category: "", topic: "all", sort: "trending" } },
  { label: "Breaking", filter: { category: "", topic: "all", sort: "closing_soon" } },
  { label: "New", filter: { category: "", topic: "all", sort: "newest" } },
  { label: "Politics", filter: { category: "politics", topic: "all", sort: "trending" } },
  { label: "Sports", filter: { category: "sports", topic: "all", sort: "trending" } },
  { label: "Crypto", filter: { category: "crypto", topic: "all", sort: "trending" } },
  { label: "Esports", filter: { category: "", topic: "esports", sort: "trending" } },
  { label: "Iran", filter: { category: "politics", topic: "all", sort: "trending", search: "Iran" } },
  { label: "Finance", filter: { category: "finance", topic: "all", sort: "trending" } },
  { label: "Geopolitics", filter: { category: "geopolitics", topic: "all", sort: "trending" } },
  { label: "Tech", filter: { category: "tech", topic: "all", sort: "trending" } },
  { label: "Culture", filter: { category: "culture", topic: "all", sort: "trending" } },
  { label: "Economy", filter: { category: "economy", topic: "all", sort: "trending" } },
  { label: "Weather", filter: { category: "weather", topic: "all", sort: "trending" } },
  { label: "Mentions", filter: { category: "", topic: "social", sort: "trending" } },
  { label: "Elections", filter: { category: "", topic: "elections", sort: "trending" } },
];

export const topicTabs = [
  { label: "All", value: "all", filter: { category: "", topic: "all", search: "" } },
  { label: "Trump", value: "trump", filter: { category: "politics", topic: "all", search: "Trump" } },
  { label: "Iran", value: "iran", filter: { category: "politics", topic: "all", search: "Iran" } },
  {
    label: "Trump-Xi Summit",
    value: "trump-xi-summit",
    filter: { category: "politics", topic: "all", search: "Trump-Xi Summit" },
  },
  { label: "Starmer", value: "starmer", filter: { category: "politics", topic: "all", search: "Starmer" } },
  { label: "Hantavirus", value: "hantavirus", filter: { category: "", topic: "all", search: "Hantavirus" } },
  {
    label: "Strait of Hormuz",
    value: "hormuz",
    filter: { category: "politics", topic: "all", search: "Strait of Hormuz" },
  },
  {
    label: "2026 NBA Playoffs",
    value: "2026-nba-playoffs",
    filter: { category: "sports", topic: "all", search: "2026 NBA Playoffs" },
  },
  {
    label: "2026 NHL Playoffs",
    value: "2026-nhl-playoffs",
    filter: { category: "sports", topic: "all", search: "2026 NHL Playoffs" },
  },
  { label: "Eurovision", value: "eurovision", filter: { category: "culture", topic: "all", search: "Eurovision" } },
  { label: "GTA VI", value: "gta-vi", filter: { category: "culture", topic: "all", search: "GTA VI" } },
  {
    label: "Musk v Altman",
    value: "musk-v-altman",
    filter: { category: "tech", topic: "all", search: "Musk Altman" },
  },
  { label: "Oil", value: "oil", filter: { category: "finance", topic: "all", search: "Oil" } },
  { label: "James Comey", value: "james-comey", filter: { category: "politics", topic: "all", search: "James Comey" } },
  { label: "Cuomo", value: "cuomo", filter: { category: "politics", topic: "all", search: "Cuomo" } },
  { label: "Romania", value: "romania", filter: { category: "politics", topic: "all", search: "Romania" } },
  { label: "Fed Chair", value: "fed-chair", filter: { category: "finance", topic: "all", search: "Fed Chair" } },
  { label: "NBA", value: "nba", filter: { category: "sports", topic: "all", search: "NBA" } },
  { label: "Esports", value: "esports", filter: { category: "", topic: "esports", search: "" } },
  { label: "Weather", value: "weather", filter: { category: "weather", topic: "all", search: "" } },
  { label: "Elections", value: "elections", filter: { category: "", topic: "elections", search: "" } },
  { label: "Tech", value: "tech", filter: { category: "tech", topic: "all", search: "" } },
] satisfies TopicTab[];

export function buildTopicTabsFromTags(tags: MarketTag[]): TopicTab[] {
  const seen = new Set(["all"]);
  const dynamicTabs = tags
    .map((tag) => ({
      label: tag.label,
      value: tag.slug,
      filter: { category: "", topic: tag.slug, search: "", status: "all" as const },
    }))
    .filter((tab) => {
      if (!tab.label.trim() || seen.has(tab.value)) {
        return false;
      }

      seen.add(tab.value);
      return true;
    });

  return [topicTabs[0], ...dynamicTabs].slice(0, 49);
}

export const sortOptions = [
  { label: "Trending", value: "trending" },
  { label: "Our volume", value: "volume" },
  { label: "Pool", value: "liquidity" },
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
  const backendTopic = filters.topic === "social" ? "all" : filters.topic;
  const backendSearch = filters.search.trim() || (filters.topic === "social" ? "during" : "");

  if (backendCategory) {
    params.set("category", backendCategory);
  }

  if (backendSearch) {
    params.set("search", backendSearch);
  }

  if (backendTopic !== "all") {
    params.set("topic", backendTopic);
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
