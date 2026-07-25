import assert from "node:assert/strict";
import test from "node:test";
import {
  compactMarketForList,
  normalizeDateSummary,
  normalizeGroupMarkets,
  normalizeMarket,
  normalizeMarketDetail,
  normalizePriceSummary,
} from "./normalizers.js";
import { marketFixture } from "./testUtils.js";
import type { MarketSnapshot } from "./types.js";

test("normalizes market fields with stable nulls, arrays, category, and fallback image", () => {
  const market = normalizeMarket(
    marketFixture({
      image: undefined,
      icon: undefined,
      outcomes: undefined,
      outcomePrices: undefined,
    }),
  );

  assert.equal(market.id, "market-1");
  assert.equal(market.slug, "bitcoin-above-100k");
  assert.equal(market.category, "crypto");
  assert.equal(market.category_label, "Crypto");
  assert.match(market.image ?? "", /^https:\/\/images\.unsplash\.com\//);
  assert.deepEqual(market.outcomes, []);
  assert.equal(market.trading.best_bid, null);
});

test("normalizes the exact local binary opening price independently of upstream display data", () => {
  const market = normalizeMarket(
    marketFixture({
      outcomePrices: JSON.stringify(["0.7", "0.3"]),
      bestBid: 0.68,
      bestAsk: 0.72,
    }),
  );
  const prices = normalizePriceSummary(market);

  assert.equal(market.outcomes[0]?.priceDecimal, "0.5");
  assert.equal(market.outcomes[1]?.priceDecimal, "0.5");
  assert.equal(prices.yes, 0.5);
  assert.equal(prices.no, 0.5);
  assert.equal(prices.midpoint, null);
  assert.equal(prices.spread, null);
});

test("normalizes Polymarket card metadata for rewards and footers", () => {
  const market = normalizeMarket(
    marketFixture({
      volume24hr: 25000,
      commentCount: 62,
      rewardsMinSize: 200,
      rewardsMaxSpread: 5.5,
      clobRewards: [{ rewardsDailyRate: 1000 }],
      holdingRewardsEnabled: false,
      gameStartTime: "2026-05-17T18:00:00.000Z",
    }),
  );

  assert.equal(market.volume_24h, 0);
  assert.equal(market.comment_count, 62);
  assert.equal(market.game_start_time, "2026-05-17T18:00:00.000Z");
  assert.deepEqual(market.rewards, {
    enabled: false,
    daily_rate: 0,
    holding: false,
    min_size: null,
    max_spread: null,
  });
});

test("normalizes date summary without throwing on missing dates", () => {
  const market = normalizeMarket(
    marketFixture({
      startDate: undefined,
      endDate: undefined,
      closed: true,
    }),
  );
  const dates = normalizeDateSummary(market);

  assert.equal(dates.starts_at, null);
  assert.equal(dates.ends_at, null);
  assert.equal(dates.starts_at_ms, null);
  assert.equal(dates.ends_at_ms, null);
  assert.equal(dates.status, "closed");
});

test("keeps Polymarket-active markets live even when their end date has passed", () => {
  const market = normalizeMarket(
    marketFixture({
      active: true,
      closed: false,
      archived: false,
      endDate: new Date(Date.now() - 60_000).toISOString(),
    }),
  );

  assert.equal(normalizeDateSummary(market).status, "live");
});

test("detail includes related markets and synthetic price history by default", () => {
  const detail = normalizeMarketDetail(marketFixture());

  assert.deepEqual(detail.related_markets, []);
  assert.equal(detail.history.is_synthetic, true);
  assert.equal(detail.history.snapshots.length, 12);
  assert.equal(detail.history.price_history.length, 12);
  assert.equal(detail.history.price_history[0]?.outcomes?.length, detail.outcomes.length);
  assert.equal(detail.volume_detail.volume, 0);
});

test("normalizes grouped event context and child market labels", () => {
  const event = {
    id: "event-1",
    slug: "democratic-presidential-nominee-2028",
    title: "Democratic Presidential Nominee 2028",
    markets: [],
  };
  const childMarket = marketFixture({
    id: "roy-cooper",
    question: "Will Roy Cooper win the 2028 Democratic presidential nomination?",
    groupItemTitle: "Roy Cooper",
    groupItemThreshold: "12",
    image: "https://example.com/roy-cooper.png",
    events: [event],
  });
  const otherChildMarket = marketFixture({
    id: "oprah",
    groupItemTitle: "Oprah Winfrey",
    groupItemThreshold: "35",
    outcomePrices: JSON.stringify(["0.08", "0.92"]),
    image: "https://example.com/oprah.png",
    events: [event],
  });
  const detail = normalizeMarketDetail(
    childMarket,
    [],
    [],
    [],
    [otherChildMarket, childMarket],
  );

  assert.equal(detail.event_id, "event-1");
  assert.equal(detail.event_slug, "democratic-presidential-nominee-2028");
  assert.equal(detail.groupItemTitle, "Roy Cooper");
  assert.equal(detail.group_markets.length, 2);
  assert.deepEqual(
    detail.group_markets.map((market) => [market.id, market.label, market.yes_price]),
    [
      ["roy-cooper", "Roy Cooper", 0.5],
      ["oprah", "Oprah Winfrey", 0.5],
    ],
  );
  assert.deepEqual(
    detail.group_markets.map((market) => [market.id, market.image]),
    [
      ["roy-cooper", "https://example.com/roy-cooper.png"],
      ["oprah", "https://example.com/oprah.png"],
    ],
  );
  assert.deepEqual(normalizeGroupMarkets([childMarket])[0]?.clobTokenIds, [
    "yes-token",
    "no-token",
  ]);
});

test("compacts market list payloads without removing card-critical grouped data", () => {
  const parent = normalizeMarket({
    ...marketFixture({
      id: "group-parent",
      question: "Grouped event",
      description: "Long parent description that is only needed on detail pages.",
    }),
    groupMarkets: [
      ...Array.from({ length: 10 }).map((_, index) =>
        marketFixture({
          id: `group-child-${index}`,
          question: `Grouped event child ${index}`,
          description: "Long child description that should not ship with the card grid.",
          groupItemTitle: `Child ${index}`,
          outcomePrices: JSON.stringify([String(0.1 + index * 0.05), String(0.9 - index * 0.05)]),
        }),
      ),
    ],
  });
  const compact = compactMarketForList(parent);
  const child = compact.group_markets?.[0];

  assert.equal(compact.description, null);
  assert.equal(compact.group_markets?.length, 8);
  assert.equal(child?.description, null);
  assert.equal(child?.label, "Child 0");
  assert.equal(child?.yes_price, 0.5);
  assert.equal(child?.trading.accepting_orders, true);
  assert.deepEqual(child?.outcomes, []);
  assert.deepEqual(child?.clobTokenIds, []);
});

test("detail uses real snapshots before synthetic price history", () => {
  const snapshots: MarketSnapshot[] = [
    {
      id: "snapshot-1",
      market_id: "market-1",
      captured_at: "2026-05-13T10:00:00.000Z",
      prices: {
        yes: 0.55,
        no: 0.45,
        best_bid: 0.54,
        best_ask: 0.56,
        last_trade: 0.55,
        midpoint: 0.55,
        spread: 0.02,
      },
      volume: 1000,
      liquidity: 500,
      source: "polymarket",
    },
    {
      id: "snapshot-2",
      market_id: "market-1",
      captured_at: "2026-05-13T11:00:00.000Z",
      prices: {
        yes: 0.61,
        no: 0.39,
        best_bid: 0.6,
        best_ask: 0.62,
        last_trade: 0.61,
        midpoint: 0.61,
        spread: 0.02,
      },
      volume: 1200,
      liquidity: 550,
      source: "polymarket",
    },
  ];

  const detail = normalizeMarketDetail(marketFixture(), [], snapshots);

  assert.equal(detail.history.is_synthetic, false);
  assert.equal(detail.history.snapshots.length, 2);
  assert.deepEqual(
    detail.history.price_history.map((point) => [point.timestamp, point.yes, point.synthetic]),
    [
      ["2026-05-13T10:00:00.000Z", 0.55, undefined],
      ["2026-05-13T11:00:00.000Z", 0.61, undefined],
    ],
  );
});
