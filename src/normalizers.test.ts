import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDateSummary,
  normalizeMarket,
  normalizeMarketDetail,
  normalizePriceSummary,
} from "./normalizers.js";
import { marketFixture } from "./testUtils.js";

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
  assert.equal(market.trading.best_bid, 0.6);
});

test("normalizes price summary for binary markets", () => {
  const market = normalizeMarket(
    marketFixture({
      outcomePrices: JSON.stringify(["0.7", "0.3"]),
      bestBid: 0.68,
      bestAsk: 0.72,
    }),
  );
  const prices = normalizePriceSummary(market);

  assert.equal(prices.yes, 0.7);
  assert.equal(prices.no, 0.3);
  assert.equal(prices.midpoint, 0.7);
  assert.ok(prices.spread !== null && Math.abs(prices.spread - 0.04) < 0.000001);
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

test("detail includes related markets and synthetic price history by default", () => {
  const detail = normalizeMarketDetail(marketFixture());

  assert.deepEqual(detail.related_markets, []);
  assert.equal(detail.history.is_synthetic, true);
  assert.equal(detail.history.snapshots.length, 12);
  assert.equal(detail.history.price_history.length, 12);
  assert.equal(detail.volume_detail.volume, 125000);
});
