import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCacheStore } from "./cache.js";
import { buildMarketDataService, MarketDataError } from "./marketDataService.js";
import { buildKeywordVisibilityRules, isMarketVisible } from "./moderation.js";
import { UpstreamError } from "./polymarketClient.js";
import { marketFixture, testConfig } from "./testUtils.js";
import type { PolymarketMarket } from "./types.js";

function localClient(markets: PolymarketMarket[], detail = markets[0]) {
  return {
    getMarkets: async <T>() => markets as T,
    getMarket: async <T>() => detail as T,
    search: async <T>() => ({ events: [{ markets }] }) as T,
  };
}

test("filters, searches, sorts, and paginates market lists on the backend", async () => {
  const markets = [
    marketFixture({
      id: "sports-high",
      question: "Will the NBA finals go to game 7?",
      category: "Sports",
      volumeNum: 500000,
      liquidityNum: 10000,
    }),
    marketFixture({
      id: "sports-low",
      question: "Will an NBA team win by 20?",
      category: "Sports",
      volumeNum: 20000,
      liquidityNum: 5000,
    }),
    marketFixture({
      id: "crypto",
      question: "Will Bitcoin be above $100k?",
      category: "Crypto",
      volumeNum: 900000,
    }),
  ];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(markets),
  });
  const result = await service.listMarkets({
    category: "sports",
    search: "NBA",
    sort: "volume",
    limit: 1,
  });

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.id, "sports-high");
  assert.equal(result.meta.total, 2);
  assert.equal(result.meta.next_cursor !== null, true);
});

test("filters market lists by topic while treating all as no-op", async () => {
  const markets = [
    marketFixture({
      id: "crypto-category",
      question: "Will Bitcoin be above $100k?",
      category: "Crypto",
      volumeNum: 900000,
    }),
    marketFixture({
      id: "crypto-topic",
      question: "Will the Fed mention Bitcoin?",
      category: "Finance",
      volumeNum: 500000,
    }),
    marketFixture({
      id: "sports",
      question: "Will the NBA finals go to game 7?",
      description: "A basketball market.",
      category: "Sports",
      volumeNum: 400000,
    }),
  ];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(markets),
  });

  const crypto = await service.listMarkets({ topic: "crypto", sort: "volume" });
  const all = await service.listMarkets({ topic: "all", sort: "volume" });

  assert.deepEqual(
    crypto.data.map((market) => market.id),
    ["crypto-category", "crypto-topic"],
  );
  assert.equal(all.meta.total, 3);
});

test("supports topic aliases such as ai through normalized topics/categories", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient([
      marketFixture({
        id: "ai-market",
        question: "Will OpenAI release a new model?",
        category: "Tech",
      }),
      marketFixture({
        id: "crypto-market",
        question: "Will Bitcoin rise?",
        category: "Crypto",
      }),
    ]),
  });

  const result = await service.listMarkets({ topic: "ai" });

  assert.deepEqual(
    result.data.map((market) => market.id),
    ["ai-market"],
  );
});

test("blocks hidden local topics before markets reach the client", async () => {
  const rules = buildKeywordVisibilityRules(["war"]);

  assert.equal(
    isMarketVisible(marketFixture({ question: "Will a war headline trend?" }), rules),
    false,
  );
  assert.equal(
    isMarketVisible(marketFixture({ question: "Will Bitcoin rise?" }), rules),
    true,
  );
});

test("related markets exclude the current market and blocked topics", async () => {
  const main = marketFixture({
    id: "main",
    question: "Will Bitcoin hit $100k?",
    category: "Crypto",
    volumeNum: 100000,
  });
  const candidates = [
    main,
    marketFixture({
      id: "blocked",
      question: "Will a war headline move crypto?",
      category: "Crypto",
      volumeNum: 999999,
    }),
    marketFixture({
      id: "same-category",
      question: "Will Ethereum hit a new high?",
      category: "Crypto",
      volumeNum: 500000,
    }),
    marketFixture({
      id: "keyword",
      question: "Will Bitcoin ETFs see inflows?",
      category: "Finance",
      volumeNum: 100000,
    }),
  ];
  const service = buildMarketDataService({
    config: testConfig({ relatedMarketLimit: 2 }),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(candidates, main),
  });
  const detail = await service.getMarketDetail("main");

  assert.deepEqual(
    detail.data.related_markets.map((market) => market.id),
    ["same-category", "keyword"],
  );
});

test("returns stale cached market lists when upstream fails after TTL expiry", async () => {
  let shouldFail = false;
  const cache = new MemoryCacheStore(true);
  const service = buildMarketDataService({
    config: testConfig({
      cacheEnabled: true,
      cacheTtlMs: {
        activeMarkets: 1,
        closedMarkets: 1,
        marketDetail: 1,
        categories: 1,
        relatedMarkets: 1,
        searchResults: 1,
      },
    }),
    cache,
    polymarket: {
      getMarkets: async <T>() => {
        if (shouldFail) {
          throw new UpstreamError("Polymarket unavailable", 503);
        }

        return [marketFixture({ id: "cached-market" })] as T;
      },
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() => ({ events: [] }) as T,
    },
  });

  const fresh = await service.listMarkets({ active: true, closed: false });
  await new Promise((resolve) => setTimeout(resolve, 5));
  shouldFail = true;
  const stale = await service.listMarkets({ active: true, closed: false });

  assert.equal(fresh.meta.sourceStatus, "fresh");
  assert.equal(stale.data[0]?.id, "cached-market");
  assert.equal(stale.meta.sourceStatus, "stale");
  assert.equal(stale.meta.isStale, true);
  assert.match(stale.meta.warnings.join(" "), /stale cached market data/);
});

test("rejects invalid market list query values", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient([marketFixture()]),
  });

  await assert.rejects(
    () => service.listMarkets({ sort: "not-real" }),
    (error) => error instanceof MarketDataError && error.code === "INVALID_QUERY",
  );
  await assert.rejects(
    () => service.listMarkets({ min_volume: "100", max_volume: "10" }),
    /min_volume cannot be greater than max_volume/,
  );
});

test("rejects malformed numeric market list query values", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient([marketFixture()]),
  });
  const cases: Array<[string, Record<string, unknown>]> = [
    ["limit", { limit: "abc" }],
    ["offset", { offset: "abc" }],
    ["min_volume", { min_volume: "abc" }],
    ["max_volume", { max_volume: "abc" }],
  ];

  for (const [field, params] of cases) {
    await assert.rejects(
      () => service.listMarkets(params),
      (error) =>
        error instanceof MarketDataError &&
        error.code === "INVALID_QUERY" &&
        error.message.includes(field),
    );
  }
});

test("returns fallback related markets by category when direct related query is empty", async () => {
  const main = marketFixture({
    id: "main",
    question: "Will Bitcoin reach a new high?",
    category: "Crypto",
  });
  let callCount = 0;
  const service = buildMarketDataService({
    config: testConfig({ relatedMarketLimit: 1 }),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getMarkets: async <T>() => {
        callCount += 1;
        if (callCount === 1) {
          return [] as T;
        }

        return [
          main,
          marketFixture({
            id: "fallback-related",
            question: "Will Ethereum reach a new high?",
            category: "Crypto",
            volumeNum: 800000,
          }),
        ] as T;
      },
      getMarket: async <T>() => main as T,
      search: async <T>() => ({ events: [] }) as T,
    },
  });
  const detail = await service.getMarketDetail("main");

  assert.deepEqual(
    detail.data.related_markets.map((market) => market.id),
    ["fallback-related"],
  );
});
