import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getFallbackImage,
  getMarketEyebrowParts,
  getOutcomeActionLabel,
  getPortfolioSummary,
  getPositionPnl,
  getPositionValue,
  getRelatedMarketDisplayImage,
  withUniqueImages,
} from "./market";
import {
  getCardRows,
  getGaugeArcPaths,
  getGaugeStroke,
  getGaugeStrokeOpacity,
  getMarketProbabilityGaugeVariant,
  getProbabilityGaugeDisplay,
} from "../components/MarketCard";
import type { Market, LocalPosition, RelatedMarket } from "./types";

function market(overrides: Partial<Market>): Market {
  return {
    id: "m1",
    slug: null,
    title: "BTC Up or Down",
    title_ar: null,
    description: null,
    category: "crypto",
    category_label: "Crypto",
    topics: ["crypto"],
    image: null,
    icon: null,
    starts_at: null,
    ends_at: null,
    status: "live",
    active: true,
    closed: false,
    archived: false,
    restricted: false,
    volume: 1000,
    liquidity: 100,
    outcomes: [
      { name: "Yes", price: 0.6, clobTokenId: null },
      { name: "No", price: 0.4, clobTokenId: null },
    ],
    trading: {
      order_book_enabled: true,
      accepting_orders: true,
      best_bid: null,
      best_ask: null,
      last_trade_price: null,
    },
    event_id: null,
    event_slug: null,
    event_title: null,
    groupItemTitle: null,
    groupItemThreshold: null,
    canonical_market_id: "m1",
    canonical_event_slug: null,
    source: "polymarket",
    ...overrides,
  };
}

describe("market helpers", () => {
  it("keeps upstream images even when Polymarket reuses the same event media", () => {
    const sharedImage = "https://example.com/reused.png";
    const inputs = [
      market({ id: "crypto-a", slug: "btc-up", title: "BTC Up", image: sharedImage }),
      market({ id: "crypto-b", slug: "eth-up", title: "ETH Up", image: sharedImage }),
      market({ id: "crypto-c", slug: "sol-up", title: "SOL Up", image: sharedImage }),
    ];
    const [first, second, third] = withUniqueImages(inputs);
    const [repeatFirst] = withUniqueImages(inputs);

    assert.equal(first.displayImage, sharedImage);
    assert.equal(second.displayImage, sharedImage);
    assert.equal(third.displayImage, sharedImage);
    assert.equal(first.displayImage, repeatFirst.displayImage);
  });

  it("falls back by slug and title when a market id is not available", () => {
    const [first, second] = withUniqueImages([
      market({ id: "", slug: "first-election", title: "First election", image: null }),
      market({ id: "", slug: null, title: "Second election", image: null }),
    ]);

    assert.notEqual(first.displayImage, second.displayImage);
    assert.equal(first.displayImage, getFallbackImage(first));
  });

  it("keeps unique upstream images", () => {
    const sourceImage = "https://example.com/unique.png";
    const [result] = withUniqueImages([market({ id: "a", image: sourceImage })]);

    assert.equal(result.displayImage, sourceImage);
  });

  it("uses related market media instead of the opened market context", () => {
    const related: RelatedMarket = {
      id: "related-with-image",
      slug: "related-with-image",
      title: "Different related market",
      category: "politics",
      image: "https://example.com/related.png",
      icon: "https://example.com/related-icon.png",
      volume: 100,
      ends_at: null,
      probability: 0.42,
    };

    assert.equal(getRelatedMarketDisplayImage(related), related.image);
  });

  it("creates deterministic related market fallbacks from related identity", () => {
    const first: RelatedMarket = {
      id: "related-a",
      slug: "first-related",
      title: "First related market",
      category: "crypto",
      image: null,
      icon: null,
      volume: 100,
      ends_at: null,
      probability: 0.42,
    };
    const second: RelatedMarket = {
      ...first,
      id: "related-b",
      slug: "second-related",
      title: "Second related market",
    };

    assert.notEqual(getRelatedMarketDisplayImage(first), getRelatedMarketDisplayImage(second));
    assert.equal(getRelatedMarketDisplayImage(first), getRelatedMarketDisplayImage(first));
  });

  it("labels card outcome actions without hardcoding yes for every row", () => {
    assert.equal(getOutcomeActionLabel("Yes", true), "Yes");
    assert.equal(getOutcomeActionLabel("No", true), "No");
    assert.equal(getOutcomeActionLabel("Candidate A", false), "Candidate A");
    assert.equal(getOutcomeActionLabel("", false), "Trade");
  });

  it("builds detail eyebrow labels from meaningful topics instead of generic duplicates", () => {
    assert.deepEqual(
      getMarketEyebrowParts(
        market({
          category: "politics",
          category_label: "Politics",
          topics: ["politics", "crypto", "trump-xi-summit", "china"],
          event_slug: "trump-xi-summit-what-will-china-announce-by-may-22",
          canonical_event_slug: "trump-xi-summit-what-will-china-announce-by-may-22",
          event_title: "Trump-Xi Summit: What will China announce by May 22?",
        }),
      ),
      ["Politics", "Trump-Xi Summit"],
    );

    assert.deepEqual(
      getMarketEyebrowParts(
        market({
          category: "geopolitics",
          category_label: "Geopolitics",
          topics: ["geopolitics", "iran"],
          event_slug: null,
          canonical_event_slug: null,
          event_title: null,
        }),
      ),
      ["Geopolitics", "Iran"],
    );
  });

  it("uses live high-probability grouped outcomes for card previews before resolved zero rows", () => {
    const grouped = market({
      id: "starmer-card",
      title: "Starmer out by...?",
      category: "politics",
      topics: ["politics"],
      group_markets: [
        {
          ...market({
            id: "starmer-2025",
            title: "Starmer out in 2025?",
            groupItemTitle: "December 31, 2025",
            active: true,
            closed: true,
            status: "closed",
          }),
          label: "December 31, 2025",
          yes_price: 0,
          no_price: 1,
          clobTokenIds: [],
        },
        {
          ...market({
            id: "starmer-feb",
            title: "Starmer out by February 28, 2026?",
            groupItemTitle: "February 28",
            active: true,
            closed: true,
            status: "closed",
          }),
          label: "February 28",
          yes_price: 0,
          no_price: 1,
          clobTokenIds: [],
        },
        {
          ...market({
            id: "starmer-june",
            title: "Starmer out by June 30, 2026?",
            groupItemTitle: "June 30",
          }),
          label: "June 30",
          yes_price: 0.26,
          no_price: 0.74,
          clobTokenIds: [],
        },
        {
          ...market({
            id: "starmer-dec",
            title: "Starmer out by December 31, 2026?",
            groupItemTitle: "December 31",
          }),
          label: "December 31",
          yes_price: 0.73,
          no_price: 0.27,
          clobTokenIds: [],
        },
      ],
    });

    assert.deepEqual(
      getCardRows(grouped).slice(0, 2).map((row) => [row.label, row.yesPrice]),
      [
        ["December 31", 0.73],
        ["June 30", 0.26],
      ],
    );
  });

  it("hides probability gauges on card previews", () => {
    const singleBinary = market({
      id: "hantavirus-card",
      title: "Hantavirus pandemic in 2026?",
      category: "weather",
      category_label: "Weather",
      topics: ["weather"],
    });
    const upDown = market({
      id: "btc-updown",
      title: "BTC Up or Down 5m",
      outcomes: [
        { name: "Up", price: 0.53, clobTokenId: null },
        { name: "Down", price: 0.47, clobTokenId: null },
      ],
    });
    const grouped = market({
      id: "venezuela-leader-card",
      title: "Venezuela leader end of 2026?",
      category: "politics",
      category_label: "Politics",
      topics: ["politics"],
      group_markets: [
        {
          ...market({
            id: "venezuela-maduro",
            title: "Will Nicolas Maduro be the leader of Venezuela end of 2026?",
            groupItemTitle: "Nicolas Maduro",
          }),
          label: "Nicolas Maduro",
          yes_price: 0.64,
          no_price: 0.36,
          clobTokenIds: [],
        },
        {
          ...market({
            id: "venezuela-rodriguez",
            title: "Will Delcy Rodriguez be the leader of Venezuela end of 2026?",
            groupItemTitle: "Delcy Rodriguez",
          }),
          label: "Delcy Rodriguez",
          yes_price: 0.21,
          no_price: 0.79,
          clobTokenIds: [],
        },
      ],
    });

    assert.equal(getMarketProbabilityGaugeVariant(singleBinary), null);
    assert.equal(getMarketProbabilityGaugeVariant(upDown), null);
    assert.equal(getMarketProbabilityGaugeVariant(grouped), null);
  });

  it("matches Polymarket gauge display, color thresholds, and arc spacing", () => {
    const upDown = market({
      id: "btc-updown",
      title: "BTC Up or Down 5m",
      outcomes: [
        { name: "Up", price: 0.49, clobTokenId: null },
        { name: "Down", price: 0.51, clobTokenId: null },
      ],
    });

    assert.deepEqual(getProbabilityGaugeDisplay(upDown, "updown"), {
      label: "Up",
      value: 0.49,
    });
    assert.equal(getGaugeStroke(0.07), "#e23939");
    assert.equal(getGaugeStroke(0.31), "#f7d022");
    assert.equal(getGaugeStroke(0.61), "#30a159");
    assert.equal(getGaugeStrokeOpacity(0.5), 0.55);
    assert.equal(getGaugeStrokeOpacity(0.07), 0.937);
    assert.deepEqual(getGaugeArcPaths(0.07), {
      track: "M -28.560424837354034 -5.035797152340984 A 29 29 0 1 1 28.559424837354037 5.035797152340968",
      value: "M -28.560424837354034 5.035797152340978 A 29 29 0 0 1 -28.982333983553776 1.0120854043725203",
    });
  });

  it("calculates position value and pnl from market prices", () => {
    const position: LocalPosition = {
      id: "p1",
      userId: "u1",
      marketId: "m1",
      marketTitle: "BTC Up or Down",
      yesShares: 100,
      noShares: 50,
      yesCost: 55,
      noCost: 15,
      totalCost: 70,
      lastYesPrice: 0.55,
      lastNoPrice: 0.45,
      currentValue: 80,
      pnl: 10,
      lastTradeAt: new Date().toISOString(),
    };
    const currentMarket = market({ id: "m1" });

    assert.equal(getPositionValue(position, currentMarket), 80);
    assert.equal(getPositionPnl(position, currentMarket), 10);
  });

  it("summarizes portfolio equity and pnl", () => {
    const position: LocalPosition = {
      id: "p1",
      userId: "u1",
      marketId: "m1",
      marketTitle: "BTC Up or Down",
      yesShares: 100,
      noShares: 0,
      yesCost: 50,
      noCost: 0,
      totalCost: 50,
      lastYesPrice: 0.5,
      lastNoPrice: 0.5,
      currentValue: 50,
      pnl: 0,
      lastTradeAt: new Date().toISOString(),
    };

    const summary = getPortfolioSummary(
      {
        wallet: { balance: 9900, initialBalance: 10000 },
        positions: [position],
      },
      [market({ id: "m1" })],
    );

    assert.equal(summary.cash, 9900);
    assert.equal(summary.positionValue, 60);
    assert.equal(summary.equity, 9960);
    assert.equal(summary.pnl, -40);
    assert.equal(summary.openPositions, 1);
  });
});
