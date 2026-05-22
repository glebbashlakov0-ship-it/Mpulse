import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { primaryNav } from "./constants";
import {
  buildTopicTabsFromTags,
  buildMarketSearchParams,
  defaultMarketFilters,
  getDiscoveryUrl,
  getFiltersFromUrl,
  mergeDiscoveryFilters,
} from "./discovery";

describe("navigation constants", () => {
  it("wires primary nav labels to backend-owned market filters", () => {
    const byLabel = new Map(primaryNav.map((item) => [item.label, item.filter]));

    assert.deepEqual(byLabel.get("Trending"), {
      category: "",
      topic: "all",
      sort: "trending",
    });
    assert.deepEqual(byLabel.get("Politics"), {
      category: "politics",
      topic: "all",
      sort: "trending",
    });
    assert.deepEqual(byLabel.get("Elections"), {
      category: "",
      topic: "elections",
      sort: "trending",
    });

    for (const item of primaryNav) {
      assert.ok(item.filter.category || item.filter.topic !== "all" || item.filter.sort);
    }
  });
});

describe("market discovery filters", () => {
  it("round-trips route and search params through one filter model", () => {
    const filters = getFiltersFromUrl({
      searchParams: new URLSearchParams("search=fed&sort=volume&status=closed"),
      category: "finance",
    });

    assert.deepEqual(filters, {
      ...defaultMarketFilters,
      search: "fed",
      category: "finance",
      sort: "volume",
      status: "closed",
    });
    assert.equal(getDiscoveryUrl(filters), "/markets/category/finance?search=fed&sort=volume&status=closed");
  });

  it("keeps category and topic mutually exclusive for navigation", () => {
    const categoryFilters = mergeDiscoveryFilters(defaultMarketFilters, {
      category: "crypto",
      topic: "sports",
    });
    const topicFilters = mergeDiscoveryFilters(categoryFilters, {
      category: "",
      topic: "elections",
    });

    assert.equal(getDiscoveryUrl(categoryFilters), "/markets/category/crypto");
    assert.equal(getDiscoveryUrl(topicFilters), "/markets/topic/elections");
  });

  it("builds paginated backend params without hardcoded bulk discovery loads", () => {
    const params = buildMarketSearchParams(
      { ...defaultMarketFilters, topic: "ai", search: "gpt" },
      { limit: 36, offset: 72 },
    );

    assert.equal(params.get("limit"), "36");
    assert.equal(params.get("offset"), "72");
    assert.equal(params.get("category"), null);
    assert.equal(params.get("topic"), "ai");
    assert.equal(params.get("search"), "gpt");
  });

  it("turns Polymarket tags into real topic filters instead of short text searches", () => {
    const tabs = buildTopicTabsFromTags([
      { id: "ai", slug: "ai", label: "AI" },
      { id: "trump-xi-summit", slug: "trump-xi-summit", label: "Trump-Xi Summit" },
    ]);

    assert.deepEqual(tabs[1], {
      label: "AI",
      value: "ai",
      filter: { category: "", topic: "ai", search: "", status: "all" },
    });
    assert.equal(getDiscoveryUrl(mergeDiscoveryFilters(defaultMarketFilters, tabs[1].filter)), "/markets/topic/ai?status=all");
  });

  it("uses category params for broad chips so crypto and sports stay strict", () => {
    const cryptoParams = buildMarketSearchParams(
      { ...defaultMarketFilters, category: "crypto" },
      { limit: 36 },
    );
    const sportsParams = buildMarketSearchParams(
      { ...defaultMarketFilters, category: "sports" },
      { limit: 36 },
    );

    assert.equal(cryptoParams.get("category"), "crypto");
    assert.equal(cryptoParams.get("topic"), null);
    assert.equal(sportsParams.get("category"), "sports");
    assert.equal(sportsParams.get("topic"), null);
  });

  it("keeps all status in shareable URLs without sending a backend status filter", () => {
    const filters = getFiltersFromUrl({
      searchParams: new URLSearchParams("status=all&sort=newest"),
    });
    const params = buildMarketSearchParams(filters, { limit: 36 });

    assert.equal(filters.status, "all");
    assert.equal(getDiscoveryUrl(filters), "/markets?sort=newest&status=all");
    assert.equal(params.get("status"), null);
    assert.equal(params.get("active"), null);
    assert.equal(params.get("closed"), null);
  });

  it("builds primary nav URLs from the same discovery model as home filters", () => {
    const byLabel = new Map(primaryNav.map((item) => [item.label, item.filter]));

    assert.equal(
      getDiscoveryUrl(mergeDiscoveryFilters(defaultMarketFilters, byLabel.get("Crypto")!)),
      "/markets/category/crypto",
    );
    assert.equal(
      getDiscoveryUrl(mergeDiscoveryFilters(defaultMarketFilters, byLabel.get("New")!)),
      "/markets?sort=newest",
    );
  });
});
