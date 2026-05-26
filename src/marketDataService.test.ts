import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCacheStore } from "./cache.js";
import { MemoryMarketRepository } from "./marketRepository.js";
import { buildMarketDataService, MarketDataError } from "./marketDataService.js";
import { buildKeywordVisibilityRules, isMarketVisible } from "./moderation.js";
import { UpstreamError } from "./polymarketClient.js";
import { marketFixture, testConfig } from "./testUtils.js";
import type { MarketSnapshot, PolymarketEvent, PolymarketMarket, PolymarketTag } from "./types.js";

function localClient(
  markets: PolymarketMarket[],
  detail = markets[0],
  events: PolymarketEvent[] = [],
  tags: PolymarketTag[] = [],
  homepageTags: PolymarketTag[] = [],
) {
  return {
    getEvents: async <T>() => events as T,
    getMarkets: async <T>() => markets as T,
    getMarket: async <T>() => detail as T,
    getTags: async <T>() => tags as T,
    getHomepageTags: async () => homepageTags,
    search: async <T>() => ({ events: [{ markets }] }) as T,
  };
}

function eventFixture(overrides: Partial<PolymarketEvent> = {}): PolymarketEvent {
  return {
    id: "event-1",
    slug: "event-1",
    title: "Featured event",
    active: true,
    closed: false,
    archived: false,
    restricted: false,
    volume: 100000,
    volume24hr: 10000,
    liquidity: 5000,
    tags: [],
    markets: [],
    ...overrides,
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
    polymarket: localClient(
      markets,
      markets[0],
      [
        eventFixture({
          id: "crypto-event",
          title: "Crypto markets",
          tags: [{ slug: "crypto", label: "Crypto" }],
          markets,
        }),
      ],
    ),
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

test("builds a diverse event-backed discovery feed instead of one repeated event series", async () => {
  const politicsSeries = eventFixture({
    id: "politics-2028-series",
    title: "Republican Presidential Nominee 2028",
    volume24hr: 100000,
    tags: [{ slug: "politics", label: "Politics" }],
    markets: Array.from({ length: 6 }).map((_, index) =>
      marketFixture({
        id: `politics-2028-${index}`,
        question: `Will Candidate ${index} win 2028?`,
        category: undefined,
        volumeNum: 900000 - index * 1000,
        volume24hr: 90000 - index * 1000,
      }),
    ),
  });
  const events = [
    politicsSeries,
    eventFixture({
      id: "sports-event",
      title: "Championship finals",
      tags: [{ slug: "sports", label: "Sports" }],
      volume24hr: 80000,
      markets: [
        marketFixture({ id: "sports", question: "Will the Knicks win?", category: undefined }),
        marketFixture({ id: "sports-2", question: "Will the Celtics win?", category: undefined }),
      ],
    }),
    eventFixture({
      id: "crypto-event",
      title: "Bitcoin daily markets",
      tags: [{ slug: "crypto", label: "Crypto" }],
      volume24hr: 70000,
      markets: [
        marketFixture({ id: "crypto", question: "Will Bitcoin hit $150k?", category: undefined }),
        marketFixture({ id: "crypto-2", question: "Will Bitcoin hit $200k?", category: undefined }),
      ],
    }),
    eventFixture({
      id: "finance-event",
      title: "Fed decision",
      tags: [{ slug: "fed", label: "Fed" }],
      volume24hr: 60000,
      markets: [
        marketFixture({ id: "finance", question: "Will the Fed cut rates?", category: undefined }),
        marketFixture({ id: "finance-2", question: "Will the Fed hold rates?", category: undefined }),
      ],
    }),
    eventFixture({
      id: "esports-event",
      title: "Esports championship",
      tags: [{ slug: "esports", label: "Esports" }],
      volume24hr: 50000,
      markets: [
        marketFixture({ id: "esports", question: "Will the Valorant final go five maps?", category: undefined }),
        marketFixture({ id: "esports-2", question: "Will the Valorant final be a sweep?", category: undefined }),
      ],
    }),
    eventFixture({
      id: "elections-event",
      title: "Election polling",
      tags: [{ slug: "elections", label: "Elections" }],
      volume24hr: 40000,
      markets: [
        marketFixture({ id: "elections", question: "Will turnout beat polling?", category: undefined }),
        marketFixture({ id: "elections-2", question: "Will polling miss by 5 points?", category: undefined }),
      ],
    }),
  ];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient([], marketFixture(), events),
  });

  const result = await service.listMarkets({ limit: 8, sort: "trending", status: "live" });
  const repeatedSeriesCount = result.data.filter((market) =>
    market.title.startsWith("Will Candidate"),
  ).length;
  const questionCardCount = result.data.filter((market) => /^will\b/i.test(market.title)).length;
  const topics = new Set(result.data.flatMap((market) => market.topics));

  assert.equal(repeatedSeriesCount, 0);
  assert.equal(questionCardCount <= 2, true);
  assert.equal(result.data[0]?.title, "Republican Presidential Nominee 2028");
  assert.equal(topics.has("sports"), true);
  assert.equal(topics.has("crypto"), true);
  assert.equal(topics.has("finance"), true);
  assert.equal(topics.has("esports"), true);
  assert.equal(topics.has("elections"), true);
});

test("keeps discovery market loading focused instead of querying every known tag", async () => {
  const eventQueries: Array<Record<string, unknown>> = [];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>(query: Record<string, unknown>) => {
        eventQueries.push(query);
        return [] as T;
      },
      getMarkets: async <T>() => [marketFixture({ id: "base-market" })] as T,
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() => ({ events: [] }) as T,
    },
  });

  await service.listMarkets({ limit: 12, sort: "trending", status: "live" });

  assert.equal(eventQueries.length, 3);
  assert.deepEqual(
    eventQueries.map((query) => ({
      order: query.order,
      featured: query.featured ?? false,
      trending: query.trending ?? false,
      tag: query.tag_slug ?? null,
    })),
    [
      { order: "volume24hr", featured: false, trending: false, tag: null },
      { order: "volume24hr", featured: true, trending: false, tag: null },
      { order: "volume24hr", featured: false, trending: true, tag: null },
    ],
  );
});

test("paginates upstream market discovery beyond Polymarket's single page cap", async () => {
  const marketQueries: Array<Record<string, unknown>> = [];
  const service = buildMarketDataService({
    config: testConfig({ upstreamMarketLimit: 250 }),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>(query: Record<string, unknown>) => {
        marketQueries.push(query);
        return [
          marketFixture({
            id: `market-offset-${query.offset ?? 0}`,
            question: `Offset ${query.offset ?? 0} market`,
            volumeNum: 1_000_000 - Number(query.offset ?? 0),
          }),
        ] as T;
      },
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() => ({ events: [] }) as T,
    },
  });

  const result = await service.listMarkets({ limit: 120, sort: "trending", status: "live" });

  assert.deepEqual(
    marketQueries.map((query) => [query.limit, query.offset]),
    [
      [100, 0],
      [100, 100],
      [50, 200],
    ],
  );
  assert.equal(result.meta.total, 3);
});

test("paginates event discovery because Polymarket cards are event-first", async () => {
  const eventQueries: Array<Record<string, unknown>> = [];
  const service = buildMarketDataService({
    config: testConfig({ upstreamMarketLimit: 250 }),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>(query: Record<string, unknown>) => {
        eventQueries.push(query);
        if (query.featured || query.trending || query.offset === 0) {
          return [] as T;
        }

        return [
          eventFixture({
            id: `event-offset-${query.offset}`,
            title: `Event offset ${query.offset}`,
            volume: 1_000_000 - Number(query.offset),
            markets: [
              marketFixture({
                id: `event-market-${query.offset}`,
                question: `Will event offset ${query.offset} resolve yes?`,
              }),
            ],
          }),
        ] as T;
      },
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() => ({ events: [] }) as T,
    },
  });

  const result = await service.listMarkets({ limit: 120, sort: "trending", status: "live" });

  assert.deepEqual(
    eventQueries
      .filter((query) => !query.featured && !query.trending)
      .map((query) => [query.limit, query.offset]),
    [
      [100, 0],
      [50, 100],
    ],
  );
  assert.equal(result.meta.total, 1);
});

test("live lists trust Polymarket active state over past end dates", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(
      [],
      marketFixture(),
      [
        eventFixture({
          id: "active-past-end",
          title: "Active sports event",
          active: true,
          closed: false,
          archived: false,
          endDate: new Date(Date.now() - 60_000).toISOString(),
          markets: [
            marketFixture({
              id: "active-past-end-market",
              question: "Will the active sports event resolve?",
              active: true,
              closed: false,
              archived: false,
              endDate: new Date(Date.now() - 60_000).toISOString(),
            }),
          ],
        }),
      ],
    ),
  });

  const result = await service.listMarkets({ limit: 5, sort: "trending", status: "live" });

  assert.equal(result.data[0]?.id, "active-past-end-market");
  assert.equal(result.data[0]?.status, "live");
});

test("grouped event cards use the parent event status instead of the first child market", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(
      [],
      marketFixture(),
      [
        eventFixture({
          id: "active-group-event",
          title: "Active grouped event",
          active: true,
          closed: false,
          archived: false,
          markets: [
            marketFixture({
              id: "closed-child",
              question: "Closed child market?",
              groupItemTitle: "Closed child",
              active: true,
              closed: true,
              archived: false,
              volume24hr: 100,
            }),
            marketFixture({
              id: "open-child",
              question: "Open child market?",
              groupItemTitle: "Open child",
              active: true,
              closed: false,
              archived: false,
              volume24hr: 50,
            }),
          ],
        }),
      ],
    ),
  });

  const result = await service.listMarkets({ limit: 5, sort: "trending", status: "live" });

  assert.equal(result.data[0]?.title, "Active grouped event");
  assert.equal(result.data[0]?.status, "live");
  assert.equal(result.data[0]?.closed, false);
  assert.equal(
    result.data[0]?.group_markets?.find((market) => market.id === "closed-child")?.closed,
    true,
  );
});

test("trending discovery preserves Polymarket event order", async () => {
  const events = [
    eventFixture({
      id: "first-event",
      title: "First upstream event",
      markets: [marketFixture({ id: "first-market", question: "First upstream event?" })],
    }),
    eventFixture({
      id: "second-event",
      title: "Second upstream event",
      markets: [marketFixture({ id: "second-market", question: "Second upstream event?" })],
    }),
    eventFixture({
      id: "third-event",
      title: "Third upstream event",
      markets: [marketFixture({ id: "third-market", question: "Third upstream event?" })],
    }),
  ];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient([], marketFixture(), events),
  });

  const result = await service.listMarkets({ limit: 3, sort: "trending", status: "live" });

  assert.deepEqual(
    result.data.map((market) => market.title),
    ["First upstream event?", "Second upstream event?", "Third upstream event?"],
  );
});

test("uses focused event tags for search pages without broad discovery fanout", async () => {
  const eventQueries: Array<Record<string, unknown>> = [];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>(query: Record<string, unknown>) => {
        eventQueries.push(query);
        return [
          eventFixture({
            id: "iran-event",
            title: "Iran leadership transition",
            tags: [{ slug: "iran", label: "Iran" }],
            markets: [
              marketFixture({
                id: "iran-child",
                question: "Will Iran leadership change in 2026?",
                category: undefined,
              }),
            ],
          }),
        ] as T;
      },
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() => ({ events: [] }) as T,
    },
  });

  const result = await service.listMarkets({ search: "Iran", sort: "trending", status: "live" });

  assert.deepEqual(eventQueries.map((query) => query.tag_slug), ["iran"]);
  assert.equal(result.meta.total, 1);
  assert.equal(result.data[0]?.title, "Will Iran leadership change in 2026?");
});

test("keeps broad fallback markets available after grouped discovery cards", async () => {
  const fallbackMarkets = Array.from({ length: 75 }).map((_, index) =>
    marketFixture({
      id: `fallback-${index}`,
      question: `Fallback market ${index}`,
      category: index % 2 === 0 ? "Politics" : "Crypto",
      volumeNum: 1_000_000 - index * 1_000,
      volume24hr: 100_000 - index * 500,
    }),
  );
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(
      fallbackMarkets,
      fallbackMarkets[0],
      [
        eventFixture({
          id: "grouped-event",
          title: "Grouped event",
          tags: [{ slug: "politics", label: "Politics" }],
          markets: [
            marketFixture({
              id: "group-child-1",
              question: "Will grouped child one resolve yes?",
              category: undefined,
              volumeNum: 2_000_000,
            }),
            marketFixture({
              id: "group-child-2",
              question: "Will grouped child two resolve yes?",
              category: undefined,
              volumeNum: 1_900_000,
            }),
          ],
        }),
      ],
    ),
  });

  const result = await service.listMarkets({ limit: 36, sort: "trending", status: "live" });

  assert.equal(result.data.length, 36);
  assert.equal(result.meta.total > 36, true);
  assert.equal(result.meta.next_cursor !== null, true);
  assert.equal(result.data.some((market) => market.title === "Grouped event"), true);
  assert.equal(result.data.some((market) => market.id.startsWith("fallback-")), true);
});

test("collapses embedded Polymarket event siblings into one grouped card", async () => {
  const nomineeEvent = eventFixture({
    id: "nominee-event",
    slug: "democratic-presidential-nominee-2028",
    title: "Democratic Presidential Nominee 2028",
    volume: 1_200_000,
    volume24hr: 100_000,
  });
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient([
      marketFixture({
        id: "oprah",
        question: "Will Oprah Winfrey win the 2028 Democratic presidential nomination?",
        category: undefined,
        volumeNum: 900_000,
        outcomePrices: JSON.stringify(["0.11", "0.89"]),
        events: [nomineeEvent],
      }),
      marketFixture({
        id: "bernie",
        question: "Will Bernie Sanders win the 2028 Democratic presidential nomination?",
        category: undefined,
        volumeNum: 800_000,
        outcomePrices: JSON.stringify(["0.09", "0.91"]),
        events: [nomineeEvent],
      }),
      marketFixture({
        id: "standalone",
        question: "Will Bitcoin be above $100k by June?",
        category: "Crypto",
        volumeNum: 100_000,
      }),
    ]),
  });

  const result = await service.listMarkets({ limit: 12, sort: "volume", status: "live" });

  assert.equal(result.meta.total, 2);
  assert.equal(result.data[0]?.title, "Democratic Presidential Nominee 2028");
  assert.equal(result.data[0]?.group_markets?.length, 2);
  assert.deepEqual(
    result.data[0]?.group_markets?.map((market) => market.label).sort(),
    ["Bernie Sanders", "Oprah Winfrey"],
  );
  assert.equal(
    result.data.some((market) => market.title.startsWith("Will Oprah")),
    false,
  );
});

test("normalizes event-backed markets with event tags, media, and 24h volume", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(
      [],
      marketFixture(),
      [
        eventFixture({
          id: "bitcoin-event",
          title: "Bitcoin daily markets",
          image: "https://example.com/bitcoin.png",
          tags: [{ slug: "crypto", label: "Crypto" }],
          markets: [
            marketFixture({
              id: "bitcoin-event-market",
              question: "Will Bitcoin be above $150k?",
              category: undefined,
              image: undefined,
              icon: undefined,
              volume24hr: 12345,
            }),
            marketFixture({
              id: "bitcoin-event-market-2",
              question: "Will Bitcoin be above $200k?",
              category: undefined,
              image: "https://example.com/bitcoin-200.png",
              volumeNum: 10,
            }),
          ],
        }),
      ],
    ),
  });

  const result = await service.listMarkets({ limit: 1, sort: "trending" });

  assert.equal(result.data[0]?.id, "bitcoin-event-market");
  assert.equal(result.data[0]?.title, "Bitcoin daily markets");
  assert.equal(result.data[0]?.category, "crypto");
  assert.equal(result.data[0]?.topics.includes("crypto"), true);
  assert.equal(result.data[0]?.image, "https://example.com/bitcoin.png");
  assert.equal(result.data[0]?.volume_24h, 0);
  assert.equal(result.data[0]?.group_markets?.length, 2);
  assert.equal(result.data[0]?.group_markets?.[0]?.image, "https://example.com/bitcoin.png");
  assert.equal(result.data[0]?.group_markets?.[1]?.image, "https://example.com/bitcoin-200.png");
});

test("suppresses individual child cards when an event-backed grouped card is available", async () => {
  const eventContext = {
    id: "starmer-event",
    slug: "starmer-out-in-2025",
    title: "Starmer out by...?",
  };
  const childMarkets = [
    marketFixture({
      id: "starmer-may-15",
      question: "Starmer out by May 15, 2026?",
      category: undefined,
      groupItemTitle: "May 15",
      groupItemThreshold: "1",
      volumeNum: 5_600_000,
      volume24hr: 500_000,
      events: [eventContext],
    }),
    marketFixture({
      id: "starmer-may-19",
      question: "Starmer out by May 19, 2026?",
      category: undefined,
      groupItemTitle: "May 19",
      groupItemThreshold: "2",
      volumeNum: 250_000,
      volume24hr: 50_000,
      outcomePrices: JSON.stringify(["0.03", "0.97"]),
      events: [eventContext],
    }),
    marketFixture({
      id: "starmer-may-31",
      question: "Starmer out by May 31, 2026?",
      category: undefined,
      groupItemTitle: "May 31",
      groupItemThreshold: "3",
      volumeNum: 900_000,
      volume24hr: 90_000,
      outcomePrices: JSON.stringify(["0.11", "0.89"]),
      events: [eventContext],
    }),
  ];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(
      childMarkets,
      childMarkets[0],
      [
        eventFixture({
          ...eventContext,
          category: "Politics",
          image: "https://example.com/starmer.png",
          volume: 25_000_000,
          volume24hr: 1_000_000,
          tags: [{ slug: "starmer", label: "Starmer" }],
          markets: childMarkets.map((market) => ({ ...market, events: undefined })),
        }),
      ],
    ),
  });

  const result = await service.listMarkets({
    category: "politics",
    limit: 10,
    sort: "trending",
    status: "live",
  });

  assert.equal(result.meta.total, 1);
  assert.equal(result.data[0]?.title, "Starmer out by...?");
  assert.equal(result.data[0]?.image, "https://example.com/starmer.png");
  assert.deepEqual(
    result.data[0]?.group_markets?.map((market) => [market.id, market.label, market.yes_price]),
    [
      ["starmer-may-15", "May 15", 0.5],
      ["starmer-may-19", "May 19", 0.5],
      ["starmer-may-31", "May 31", 0.5],
    ],
  );
});

test("builds discovery topic tags from Polymarket event tags instead of categories", async () => {
  const events = [
    eventFixture({
      id: "trump-xi-event",
      title: "What will Trump say during bilateral events with Xi Jinping?",
      volume24hr: 100000,
      tags: [
        { slug: "politics", label: "Politics" },
        { slug: "trump", label: "Trump" },
        { slug: "trump-xi-summit", label: "Trump-Xi Summit" },
        { slug: "hide-from-new", label: "Hide From New" },
      ],
    }),
    eventFixture({
      id: "iran-event",
      title: "US x Iran permanent peace deal by...?",
      volume24hr: 90000,
      tags: [
        { slug: "iran", label: "Iran" },
        { slug: "rewards-100-4pt5-100", label: "Rewards 100, 4.5, 100" },
      ],
    }),
  ];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient([], marketFixture(), events, [{ slug: "ai", label: "AI" }]),
  });

  const tags = await service.listTags();
  const labels = tags.map((tag) => tag.label);

  assert.deepEqual(labels.slice(0, 4), ["AI", "Trump", "Trump-Xi Summit", "Iran"]);
  assert.equal(labels.includes("Politics"), false);
  assert.equal(labels.includes("Hide From New"), false);
  assert.equal(labels.some((label) => label.startsWith("Rewards")), false);
});

test("uses Polymarket homepage curated topic chips before generic tags", async () => {
  const homepageTags = [
    { slug: "trump", label: "Trump" },
    { slug: "iran", label: "Iran" },
    { slug: "trump-xi-summit", label: "Trump-Xi Summit" },
    { slug: "iceman", label: "Iceman" },
    { slug: "starmer", label: "Starmer" },
    { slug: "hantavirus", label: "Hantavirus" },
    { slug: "cuba", label: "Cuba" },
    { slug: "strait-of-hormuz", label: "Strait of Hormuz" },
    { slug: "2026-nba-playoffs", label: "2026 NBA Playoffs" },
  ];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(
      [],
      marketFixture(),
      [
        eventFixture({
          tags: [{ slug: "random-event-tag", label: "Random Event Tag" }],
        }),
      ],
      [{ slug: "ai", label: "AI" }],
      homepageTags,
    ),
  });

  const tags = await service.listTags();

  assert.deepEqual(
    tags.map((tag) => tag.label),
    homepageTags.map((tag) => tag.label),
  );
});

test("searches bitcoin across event-backed search results", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() =>
        [
          eventFixture({
            id: "sports-event",
            tags: [{ slug: "sports", label: "Sports" }],
            markets: [marketFixture({ id: "sports", question: "Will the NBA finals go seven games?", category: undefined })],
          }),
        ] as T,
      getMarkets: async <T>() =>
        [marketFixture({ id: "fed", question: "Will the Fed cut rates?", category: "Finance" })] as T,
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() =>
        ({
          events: [
            eventFixture({
              id: "bitcoin-search-event",
              tags: [{ slug: "crypto", label: "Crypto" }],
              markets: [
                marketFixture({
                  id: "bitcoin-search",
                  question: "Will Bitcoin trade above $150k in May?",
                  category: undefined,
                }),
              ],
            }),
          ],
        }) as T,
    },
  });

  const result = await service.listMarkets({ search: "bitcoin", sort: "relevance" });

  assert.deepEqual(
    result.data.map((market) => market.id),
    ["bitcoin-search"],
  );
});

test("search uses market-specific titles for event-backed range markets", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() =>
        ({
          events: [
            eventFixture({
              id: "bitcoin-range-event",
              title: "When will Bitcoin hit $150k?",
              tags: [{ slug: "crypto", label: "Crypto" }],
              markets: [
                marketFixture({
                  id: "bitcoin-sept",
                  question: "Will Bitcoin hit $150k by September 30?",
                  category: undefined,
                }),
                marketFixture({
                  id: "bitcoin-dec",
                  question: "Will Bitcoin hit $150k by December 31?",
                  category: undefined,
                }),
              ],
            }),
          ],
        }) as T,
    },
  });

  const result = await service.listMarkets({ search: "bitcoin", sort: "relevance" });

  assert.deepEqual(
    result.data.map((market) => market.title),
    ["Will Bitcoin hit $150k by September 30?", "Will Bitcoin hit $150k by December 31?"],
  );
});

test("esports topic does not include generic gaming tech markets", async () => {
  const markets = [
    marketFixture({
      id: "apple-tech",
      question: "Will Apple release a new product line before 2027?",
      description: "Apple may release a gaming device or another technology product line.",
      category: undefined,
      volumeNum: 900000,
    }),
    marketFixture({
      id: "valorant",
      question: "Will the Valorant final go five maps?",
      category: undefined,
      volumeNum: 100000,
    }),
  ];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: localClient(
      markets,
      markets[0],
      [
        eventFixture({
          id: "crypto-event",
          title: "Crypto markets",
          tags: [{ slug: "crypto", label: "Crypto" }],
          markets,
        }),
      ],
    ),
  });

  const result = await service.listMarkets({ topic: "esports", sort: "volume" });

  assert.deepEqual(
    result.data.map((market) => market.id),
    ["valorant"],
  );
  assert.equal(result.data[0]?.category, "esports");
});

test("esports topic returns sports-category markets when esports is a topic", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() =>
        ({
          events: [
            eventFixture({
              id: "dota-event",
              title: "Dota 2 tournament",
              category: "Sports",
              tags: [{ slug: "esports", label: "Esports" }],
              markets: [
                marketFixture({
                  id: "dota-final",
                  question: "Will Team Spirit win the Dota 2 final?",
                  category: "Sports",
                  volumeNum: 250000,
                }),
              ],
            }),
            eventFixture({
              id: "apple-event",
              title: "Apple product line",
              category: "Tech",
              tags: [],
              markets: [
                marketFixture({
                  id: "apple-tech",
                  question: "Will Apple release a new product line before 2027?",
                  description: "Apple may release a gaming device or another technology product line.",
                  category: undefined,
                  volumeNum: 500000,
                }),
              ],
            }),
          ],
        }) as T,
    },
  });

  const result = await service.listMarkets({ topic: "esports", sort: "volume" });

  assert.deepEqual(
    result.data.map((market) => market.id),
    ["dota-final"],
  );
  assert.equal(result.data[0]?.category, "sports");
  assert.equal(result.data[0]?.topics.includes("esports"), true);
});

test("collector saves Polymarket content snapshots while detail uses Pulse chart history", async () => {
  const repository = new MemoryMarketRepository();
  const detail = marketFixture({
    id: "snapshot-market",
    question: "Will Bitcoin be above $100k?",
    outcomePrices: JSON.stringify(["0.58", "0.42"]),
    volumeNum: 150000,
    liquidityNum: 50000,
  });
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    marketRepository: repository,
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => detail as T,
      search: async <T>() => ({ events: [] }) as T,
    },
  });
  const initial = await service.getMarketDetail("snapshot-market");

  assert.equal(initial.data.history.is_synthetic, false);
  assert.equal(initial.data.history.snapshots.length, 0);
  assert.equal(initial.data.history.price_history.length, 1);
  assert.equal(initial.data.history.price_history[0]?.yes, 0.5);

  await service.collectMarketSnapshot("snapshot-market");
  const real = await service.getMarketDetail("snapshot-market");

  assert.equal(real.data.history.is_synthetic, false);
  assert.equal(real.data.history.snapshots.length, 1);
  assert.equal(real.data.history.price_history[0]?.yes, 0.5);
  assert.equal((await repository.listSnapshots("snapshot-market")).length, 1);
});

test("market detail ignores Polymarket CLOB price history", async () => {
  const detail = marketFixture({
    id: "clob-market",
    outcomePrices: JSON.stringify(["0.58", "0.42"]),
    clobTokenIds: JSON.stringify(["yes-token", "no-token"]),
  });
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => detail as T,
      getPriceHistory: async (tokenId) => ({
        history:
          tokenId === "yes-token"
            ? [
                { t: 1_770_000_000, p: 0.52 },
                { t: 1_770_000_060, p: 0.58 },
              ]
            : [
                { t: 1_770_000_060, p: 0.42 },
                { t: 1_770_000_120, p: 0.4 },
              ],
      }),
      search: async <T>() => ({ events: [] }) as T,
    },
  });
  const result = await service.getMarketDetail("clob-market");

  assert.equal(result.data.history.is_synthetic, false);
  assert.equal(result.data.history.snapshots.length, 0);
  assert.equal(result.data.history.price_history.length, 1);
  assert.equal(result.data.history.price_history[0]?.yes, 0.5);
});

test("market detail can resolve a market by slug", async () => {
  const detail = marketFixture({
    id: "slug-market",
    slug: "slug-market-question",
  });
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>(query: Record<string, unknown>) => {
        assert.equal(query.slug, "slug-market-question");
        return [detail] as T;
      },
      getMarket: async <T>() => {
        throw new UpstreamError("invalid id", 422);
      },
      search: async <T>() => ({ events: [] }) as T,
    },
  });

  const result = await service.getMarketDetail("slug-market-question");

  assert.equal(result.data.id, "slug-market");
  assert.equal(result.data.slug, "slug-market-question");
});

test("market detail uses Pulse Market trades for odds, volume, and chart history", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    marketActivityRepository: {
      listComments: async () => [],
      createComment: async () => {
        throw new Error("not used");
      },
      listTopHolders: async () => [],
      listPositions: async () => [],
      listTrades: async () => [
        {
          id: "bbbbbbbb-0000-4000-8000-000000000003",
          marketId: "own-odds",
          userId: "33333333-3333-4333-8333-333333333333",
          displayName: "Pulse Demo",
          side: "no",
          action: "buy",
          amount: 10000,
          price: 0.5,
          shares: 20000,
          createdAt: "2026-05-20T11:00:00.000Z",
        },
        {
          id: "trade-1",
          marketId: "own-odds",
          userId: "user-1",
          displayName: "Trader",
          side: "yes",
          action: "buy",
          amount: 100,
          price: 0.5,
          shares: 196,
          createdAt: "2026-05-20T12:00:00.000Z",
        },
      ],
    },
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => marketFixture({ id: "own-odds" }) as T,
      getPriceHistory: async () => ({
        history: [{ t: 1_770_000_000, p: 0.1 }],
      }),
      search: async <T>() => ({ events: [] }) as T,
    },
  });

  const result = await service.getMarketDetail("own-odds");

  assert.equal(result.data.volume, 100);
  assert.equal(result.data.volume_detail.volume, 100);
  assert.equal(result.data.prices.yes, 1);
  assert.equal(result.data.history.is_synthetic, false);
  assert.equal(result.data.history.price_history.length, 2);
  assert.equal(result.data.history.price_history[0]?.yes, 0.5);
  assert.equal(result.data.history.price_history[0]?.volume, 0);
  assert.equal(result.data.history.price_history[1]?.yes, 1);
  assert.equal(result.data.history.price_history[1]?.volume, 100);
});

test("market detail falls back to stored snapshots when CLOB history is unavailable", async () => {
  const snapshot: MarketSnapshot = {
    id: "snapshot-1",
    market_id: "snapshot-fallback",
    captured_at: "2026-05-14T10:00:00.000Z",
    prices: {
      yes: 0.66,
      no: 0.34,
      best_bid: 0.65,
      best_ask: 0.67,
      last_trade: 0.66,
      midpoint: 0.66,
      spread: 0.02,
    },
    volume: 1000,
    liquidity: 500,
    source: "polymarket",
  };
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    getSnapshots: async () => [snapshot],
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => marketFixture({ id: "snapshot-fallback" }) as T,
      getPriceHistory: async () => {
        throw new UpstreamError("CLOB unavailable", 503);
      },
      search: async <T>() => ({ events: [] }) as T,
    },
  });
  const result = await service.getMarketDetail("snapshot-fallback");

  assert.equal(result.data.history.is_synthetic, false);
  assert.equal(result.data.history.snapshots.length, 1);
  assert.equal(result.data.history.price_history.length, 1);
  assert.equal(result.data.history.price_history[0]?.yes, 0.5);
  assert.equal(result.data.history.price_history[0]?.volume, 0);
});

test("market detail creates an initial Pulse chart point when no Pulse trades exist", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => marketFixture({ id: "synthetic-fallback" }) as T,
      getPriceHistory: async () => {
        throw new UpstreamError("CLOB unavailable", 503);
      },
      search: async <T>() => ({ events: [] }) as T,
    },
  });
  const result = await service.getMarketDetail("synthetic-fallback");

  assert.equal(result.data.history.is_synthetic, false);
  assert.equal(result.data.history.price_history.length, 1);
  assert.equal(result.data.history.price_history[0]?.yes, 0.5);
  assert.equal(result.data.history.price_history[0]?.volume, 0);
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
    polymarket: localClient(
      markets,
      markets[0],
      [
        eventFixture({
          id: "crypto-event",
          title: "Crypto markets",
          tags: [{ slug: "crypto", label: "Crypto" }],
          markets,
        }),
      ],
    ),
  });

  const crypto = await service.listMarkets({ topic: "crypto", sort: "volume" });
  const all = await service.listMarkets({ topic: "all", sort: "volume" });

  assert.deepEqual(
    crypto.data.map((market) => market.id),
    ["crypto-category"],
  );
  assert.equal(all.meta.total, 3);
});

test("filters Polymarket topic slugs without widening AI into every tech market", async () => {
  const aiMarket = marketFixture({
    id: "ai-market",
    question: "Will OpenAI release a new model?",
    category: "Tech",
  });
  const aiTaggedEventMarket = marketFixture({
    id: "ai-tagged-event-market",
    question: "Will this model win benchmark?",
    category: "Tech",
  });
  const plainTechMarket = marketFixture({
    id: "plain-tech-market",
    question: "Will Apple release a new device?",
    category: "Tech",
  });
  const cryptoMarket = marketFixture({
    id: "crypto-market",
    question: "Will Bitcoin rise?",
    category: "Crypto",
  });
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() =>
        [
          eventFixture({
            id: "ai-tagged-event",
            title: "AI benchmark",
            tags: [{ slug: "ai", label: "AI" }],
            markets: [aiTaggedEventMarket],
          }),
        ] as T,
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() =>
        ({
          events: [
            eventFixture({
              id: "ai-search",
              title: "Search results",
              markets: [aiMarket, plainTechMarket, cryptoMarket],
            }),
          ],
        }) as T,
    },
  });

  const result = await service.listMarkets({ topic: "ai" });

  assert.deepEqual(
    result.data.map((market) => market.id).sort(),
    ["ai-market", "ai-tagged-event-market"],
  );
});

test("keeps grouped list odds at 50/50 after own activity enrichment", async () => {
  const childMarkets = [
    marketFixture({
      id: "grouped-child-a",
      question: "Will Team A win?",
      groupItemTitle: "Team A",
    }),
    marketFixture({
      id: "grouped-child-b",
      question: "Will Team B win?",
      groupItemTitle: "Team B",
    }),
  ];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    marketActivityRepository: {
      listComments: async () => [],
      createComment: async () => {
        throw new Error("not used");
      },
      listTopHolders: async () => [],
      listPositions: async () => [],
      listTrades: async () => [],
    },
    polymarket: localClient(
      [],
      childMarkets[0],
      [
        eventFixture({
          id: "grouped-event",
          title: "Grouped event",
          markets: childMarkets,
        }),
      ],
    ),
  });

  const result = await service.listMarkets({ limit: 10, sort: "trending", status: "live" });
  const groupMarkets = result.data[0]?.group_markets ?? [];

  assert.deepEqual(
    groupMarkets.map((market) => [market.label, market.yes_price, market.no_price]),
    [
      ["Team A", 0.5, 0.5],
      ["Team B", 0.5, 0.5],
    ],
  );
  assert.deepEqual(
    groupMarkets[0]?.outcomes.map((outcome) => [outcome.name, outcome.price]),
    [
      ["Yes", 0.5],
      ["No", 0.5],
    ],
  );
});

test("uses culture search fallback when Polymarket category queries are not useful", async () => {
  const searchQueries: string[] = [];
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() => [] as T,
      getMarkets: async <T>() => [] as T,
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>(query: Record<string, unknown>) => {
        searchQueries.push(String(query.q ?? ""));

        return {
          events:
            query.q === "movies"
              ? [
                  eventFixture({
                    id: "movie-event",
                    title: "Movie box office",
                    tags: [
                      { slug: "movies", label: "Movies" },
                      { slug: "pop-culture", label: "Pop Culture" },
                    ],
                    markets: [
                      marketFixture({
                        id: "movie-market",
                        question: "Will a movie top the box office?",
                        category: undefined,
                      }),
                    ],
                  }),
                ]
              : [],
        } as T;
      },
    },
  });

  const result = await service.listMarkets({ category: "culture", sort: "trending", status: "live" });

  assert.equal(searchQueries.includes("movies"), true);
  assert.deepEqual(
    result.data.map((market) => market.id),
    ["movie-market"],
  );
});

test("focused market query failures do not fail category pages with event-backed data", async () => {
  const service = buildMarketDataService({
    config: testConfig(),
    cache: new MemoryCacheStore(false),
    polymarket: {
      getEvents: async <T>() =>
        [
          eventFixture({
            id: "politics-event",
            title: "Election market",
            tags: [{ slug: "politics", label: "Politics" }],
            markets: [
              marketFixture({
                id: "politics-event-market",
                question: "Will the election market stay active?",
                category: undefined,
              }),
            ],
          }),
        ] as T,
      getMarkets: async <T>() => {
        throw new UpstreamError("Focused market query timed out", 0);
      },
      getMarket: async <T>() => marketFixture() as T,
      search: async <T>() => ({ events: [] }) as T,
    },
  });

  const result = await service.listMarkets({ category: "politics", sort: "trending", status: "live" });

  assert.deepEqual(
    result.data.map((market) => market.id),
    ["politics-event-market"],
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
      getEvents: async <T>() => [] as T,
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
      getEvents: async <T>() => [] as T,
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
