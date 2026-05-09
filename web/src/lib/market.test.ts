import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getFallbackImage,
  getOutcomeActionLabel,
  getPortfolioSummary,
  getPositionPnl,
  getPositionValue,
  getRelatedMarketDisplayImage,
  withUniqueImages,
} from "./market";
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
    source: "polymarket",
    ...overrides,
  };
}

describe("market helpers", () => {
  it("spreads duplicated upstream images across deterministic category fallbacks", () => {
    const sharedImage = "https://example.com/reused.png";
    const inputs = [
      market({ id: "crypto-a", slug: "btc-up", title: "BTC Up", image: sharedImage }),
      market({ id: "crypto-b", slug: "eth-up", title: "ETH Up", image: sharedImage }),
      market({ id: "crypto-c", slug: "sol-up", title: "SOL Up", image: sharedImage }),
    ];
    const [first, second, third] = withUniqueImages(inputs);
    const [repeatFirst] = withUniqueImages(inputs);

    assert.notEqual(first.displayImage, sharedImage);
    assert.notEqual(second.displayImage, sharedImage);
    assert.notEqual(third.displayImage, sharedImage);
    assert.notEqual(first.displayImage, second.displayImage);
    assert.notEqual(second.displayImage, third.displayImage);
    assert.equal(first.displayImage, repeatFirst.displayImage);

    for (const result of [first, second, third]) {
      assert.match(result.displayImage ?? "", /^https:\/\/images\.unsplash\.com\//);
    }
  });

  it("falls back by slug and title when a market id is not available", () => {
    const sharedImage = "https://example.com/reused.png";
    const [first, second] = withUniqueImages([
      market({ id: "", slug: "first-election", title: "First election", image: sharedImage }),
      market({ id: "", slug: null, title: "Second election", image: sharedImage }),
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
