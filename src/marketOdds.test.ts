import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnMarketHistory, buildOwnMarketStats } from "./marketOdds.js";
import type { MarketTradeActivityRecord } from "./marketActivityRepository.js";
import type { NormalizedOutcome } from "./types.js";

function outcome(name: string): NormalizedOutcome {
  return {
    name,
    price: null,
    probability: null,
    price_cents: null,
    clobTokenId: null,
  };
}

function trade(
  side: "yes" | "no",
  amount: number,
  createdAt = "2026-05-20T12:00:00.000Z",
): MarketTradeActivityRecord {
  return {
    id: `${side}-${amount}-${createdAt}`,
    marketId: "market-1",
    userId: "user-1",
    displayName: "Pulse Trader",
    side,
    action: "buy",
    amount,
    price: 0.5,
    shares: amount / 0.5,
    createdAt,
  };
}

test("binary markets start at 50/50 with no Pulse bets", () => {
  const stats = buildOwnMarketStats(
    { outcomes: [outcome("Yes"), outcome("No")] },
    [],
  );

  assert.equal(stats.yes, 0.5);
  assert.equal(stats.no, 0.5);
  assert.equal(stats.volume, 0);
  assert.equal(stats.liquidity, 0);
  assert.deepEqual(stats.outcomeVolumes, { Yes: 0, No: 0 });
});

test("multi-outcome markets start at 1/n across every event outcome", () => {
  const outcomes32 = Array.from({ length: 32 }, (_, index) => outcome(`Team ${index + 1}`));
  const outcomes150 = Array.from({ length: 150 }, (_, index) => outcome(`Candidate ${index + 1}`));

  const stats32 = buildOwnMarketStats({ outcomes: outcomes32 }, []);
  const stats150 = buildOwnMarketStats({ outcomes: outcomes150 }, []);

  assert.equal(stats32.outcomes.length, 32);
  assert.equal(stats32.outcomes[0]?.price, 1 / 32);
  assert.equal(stats150.outcomes.length, 150);
  assert.equal(stats150.outcomes[0]?.price, 1 / 150);
});

test("Pulse odds follow parimutuel outcome pool over total pool after bets", () => {
  const stats = buildOwnMarketStats(
    { outcomes: [outcome("Yes"), outcome("No")] },
    [
      trade("yes", 60, "2026-05-20T12:00:00.000Z"),
      trade("no", 40, "2026-05-20T12:05:00.000Z"),
    ],
  );

  assert.equal(stats.volume, 100);
  assert.equal(stats.liquidity, 100);
  assert.equal(stats.yes, 0.6);
  assert.equal(stats.no, 0.4);
  assert.deepEqual(stats.outcomeVolumes, { Yes: 60, No: 40 });
});

test("Pulse chart history starts with initial odds and appends a point after every bet", () => {
  const history = buildOwnMarketHistory(
    {
      id: "market-1",
      starts_at: "2026-05-20T11:00:00.000Z",
      outcomes: [outcome("Yes"), outcome("No")],
    },
    [
      trade("yes", 60, "2026-05-20T12:00:00.000Z"),
      trade("no", 40, "2026-05-20T12:05:00.000Z"),
    ],
  );

  assert.equal(history.length, 3);
  assert.equal(history[0]?.timestamp, "2026-05-20T11:00:00.000Z");
  assert.equal(history[0]?.yes, 0.5);
  assert.equal(history[0]?.volume, 0);
  assert.equal(history[1]?.yes, 1);
  assert.equal(history[1]?.volume, 60);
  assert.equal(history[2]?.yes, 0.6);
  assert.equal(history[2]?.no, 0.4);
  assert.deepEqual(history[2]?.outcomeVolumes, { Yes: 60, No: 40 });
});
