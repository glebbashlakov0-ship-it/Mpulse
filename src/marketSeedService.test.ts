import assert from "node:assert/strict";
import test from "node:test";
import { chartSeedRanges, generateSeedOddsHistory } from "./marketSeedService.js";

const fixedNow = Date.parse("2026-05-28T12:00:00.000Z");

test("seed generator is stable for the same market scope", () => {
  const input = {
    scope: {
      scopeType: "market" as const,
      scopeId: "market-stable",
      marketExternalId: "market-stable",
    },
    outcomes: [{ name: "Yes" }, { name: "No" }],
    points: 32,
    volatility: 0.08,
    nowMs: fixedNow,
  };
  const first = generateSeedOddsHistory(input);
  const second = generateSeedOddsHistory(input);

  assert.deepEqual(second, first);
  assert.equal(first.at(-1)?.outcomes[0]?.name, "Yes");
  assert.equal(first.at(-1)?.outcomes[1]?.name, "No");
  assert.equal((first.at(-1)?.yes ?? 0) + (first.at(-1)?.no ?? 0), 1);
});

test("multi-outcome seed prices always sum to one", () => {
  const history = generateSeedOddsHistory({
    scope: {
      scopeType: "event",
      scopeId: "event-1",
      marketExternalId: "market-1",
    },
    outcomes: Array.from({ length: 18 }, (_, index) => ({ name: `Candidate ${index + 1}` })),
    points: 40,
    volatility: 0.12,
    nowMs: fixedNow,
  });

  for (const point of history) {
    const sum = point.outcomes.reduce((total, outcome) => total + (outcome.price ?? 0), 0);
    assert.equal(Math.round(sum * 1_000_000) / 1_000_000, 1);
  }
});

test("multi-outcome seed creates a visible long-tail spread", () => {
  const history = generateSeedOddsHistory({
    scope: {
      scopeType: "event",
      scopeId: "wide-event",
      marketExternalId: "market-1",
    },
    outcomes: Array.from({ length: 40 }, (_, index) => ({ name: `Candidate ${index + 1}` })),
    points: 32,
    volatility: 0.12,
    nowMs: fixedNow,
  });
  const latest = history.at(-1);
  assert.ok(latest);

  const prices = latest.outcomes.map((outcome) => outcome.price ?? 0);
  assert.equal(Math.abs((prices[0] ?? 0) - 0.6) < 0.00001, true);
  assert.equal(Math.round(prices.reduce((total, price) => total + price, 0) * 1_000_000) / 1_000_000, 1);
  assert.equal((prices[1] ?? 0) > 0.07, true);
  assert.equal((prices[0] ?? 0) - (prices.at(-1) ?? 0) > 0.55, true);
});

test("multi-outcome seed history creates visible price movement", () => {
  const history = generateSeedOddsHistory({
    scope: {
      scopeType: "event",
      scopeId: "movement-check",
      marketExternalId: "market-1",
    },
    outcomes: Array.from({ length: 40 }, (_, index) => ({ name: `Candidate ${index + 1}` })),
    nowMs: fixedNow,
  });
  const priceRange = (outcomeIndex: number) => {
    const values = history.map((point) => point.outcomes[outcomeIndex]?.price ?? 0);
    return Math.max(...values) - Math.min(...values);
  };
  const leaderPrices = history.map((point) => point.outcomes[0]?.price ?? 0);

  assert.equal(history.length > 250, true);
  assert.equal(leaderPrices[0] >= 0.29 && leaderPrices[0] <= 0.31, true);
  assert.equal(Math.abs((leaderPrices.at(-1) ?? 0) - 0.6) < 0.00001, true);
  assert.equal(priceRange(0) > 0.25, true);
  assert.equal(priceRange(1) > 0.035, true);
  assert.equal(priceRange(2) > 0.025, true);
});

test("seed history includes points visible in every chart range", () => {
  const history = generateSeedOddsHistory({
    scope: {
      scopeType: "market",
      scopeId: "range-market",
      marketExternalId: "range-market",
    },
    outcomes: [{ name: "Yes" }, { name: "No" }],
    points: 24,
    nowMs: fixedNow,
  });
  const timestamps = history.map((point) => Date.parse(point.capturedAt));
  const hasPointSince = (ms: number) => timestamps.some((timestamp) => timestamp >= fixedNow - ms);

  assert.deepEqual([...chartSeedRanges], ["1H", "6H", "1D", "1W", "1M", "ALL"]);
  assert.equal(hasPointSince(60 * 60 * 1000), true);
  assert.equal(hasPointSince(6 * 60 * 60 * 1000), true);
  assert.equal(hasPointSince(24 * 60 * 60 * 1000), true);
  assert.equal(hasPointSince(7 * 24 * 60 * 60 * 1000), true);
  assert.equal(hasPointSince(30 * 24 * 60 * 60 * 1000), true);
  assert.equal(timestamps.some((timestamp) => timestamp <= fixedNow - 300 * 24 * 60 * 60 * 1000), true);
});

test("seed history spreads all-range points across the year", () => {
  const history = generateSeedOddsHistory({
    scope: {
      scopeType: "event",
      scopeId: "timeline-event",
      marketExternalId: "market-1",
    },
    outcomes: Array.from({ length: 40 }, (_, index) => ({ name: `Candidate ${index + 1}` })),
    points: 260,
    volatility: 0.2,
    nowMs: fixedNow,
  });
  const timestamps = history.map((point) => Date.parse(point.capturedAt));
  const olderThanMonth = timestamps.filter(
    (timestamp) => timestamp < fixedNow - 30 * 24 * 60 * 60 * 1000,
  );
  const lastMonth = timestamps.filter(
    (timestamp) => timestamp >= fixedNow - 30 * 24 * 60 * 60 * 1000,
  );

  assert.equal(olderThanMonth.length > 120, true);
  assert.equal(lastMonth.length > 60, true);
  assert.equal(timestamps.length >= 240, true);
});

test("seed history spreads six-hour points outside the last hour", () => {
  const history = generateSeedOddsHistory({
    scope: {
      scopeType: "event",
      scopeId: "six-hour-event",
      marketExternalId: "market-1",
    },
    outcomes: Array.from({ length: 40 }, (_, index) => ({ name: `Candidate ${index + 1}` })),
    points: 260,
    volatility: 0.2,
    nowMs: fixedNow,
  });
  const timestamps = history.map((point) => Date.parse(point.capturedAt));
  const sixHourPoints = timestamps.filter((timestamp) => timestamp >= fixedNow - 6 * 60 * 60 * 1000);
  const sixToOneHourPoints = sixHourPoints.filter(
    (timestamp) => timestamp < fixedNow - 60 * 60 * 1000,
  );

  assert.equal(sixHourPoints.length >= 40, true);
  assert.equal(sixToOneHourPoints.length >= 15, true);
});
