import assert from "node:assert/strict";
import test from "node:test";
import type { MarketActivityRepository } from "./marketActivityRepository.js";
import { syncTradingMarketActivity } from "./tradingActivitySync.js";
import { buildTradingMode, type PortfolioResponse, type Trade } from "./trading.js";

const trade: Trade = {
  id: "sync-trade",
  marketId: "sync-market",
  marketTitle: "Will projection failures stay non-critical?",
  userId: "sync-user",
  walletId: "sync-wallet",
  side: "yes",
  action: "buy",
  amount: 10,
  stakeAmount: 10,
  price: 0.5,
  shares: 20,
  realizedPnl: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  idempotencyKey: "sync-key",
  metadata: {},
};

const portfolio = {
  tradingMode: buildTradingMode(),
  user: {
    id: "sync-user",
    displayName: "Projection Tester",
    createdAt: "2026-06-01T00:00:00.000Z",
  },
  wallet: { balance: 9990 },
  positions: [
    {
      id: "sync-position",
      marketId: "sync-market",
      marketTitle: "Will projection failures stay non-critical?",
      userId: "sync-user",
      yesShares: 20,
      noShares: 0,
      yesCost: 10,
      noCost: 0,
      totalCost: 10,
      lastYesPrice: 0.5,
      lastNoPrice: null,
      lastTradeAt: "2026-06-01T00:00:00.000Z",
      currentValue: 10,
      pnl: 0,
    },
  ],
  trades: [trade],
  settlements: [],
  summary: {
    cash: 9990,
    heldBalance: 0,
    positionValue: 10,
    invested: 10,
    equity: 10_000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    pnl: 0,
    pnlPercent: 0,
    openPositions: 1,
  },
} satisfies PortfolioResponse;

test("market activity sync returns projection trade failures without throwing", async () => {
  const repository = {
    async recordTrade() {
      throw new Error("projection trade unavailable");
    },
  } as unknown as MarketActivityRepository;

  const result = await syncTradingMarketActivity({
    repository,
    displayName: "Projection Tester",
    result: {
      ok: true,
      trade,
      portfolio,
    },
  });

  assert.equal(result.trade, null);
  assert.deepEqual(result.error, {
    stage: "trade",
    message: "projection trade unavailable",
  });
});

test("market activity sync keeps recorded trade when position projection fails", async () => {
  const repository = {
    async recordTrade(input: Parameters<NonNullable<MarketActivityRepository["recordTrade"]>>[0]) {
      return {
        id: input.id ?? "activity-trade",
        marketId: input.marketId,
        userId: input.userId,
        displayName: input.displayName,
        side: input.side,
        action: input.action,
        amount: input.amount,
        price: input.price,
        shares: input.shares,
        createdAt: input.createdAt ?? "2026-06-01T00:00:00.000Z",
      };
    },
    async upsertPosition() {
      throw new Error("projection position unavailable");
    },
    async deletePosition() {
      throw new Error("projection position unavailable");
    },
  } as unknown as MarketActivityRepository;

  const result = await syncTradingMarketActivity({
    repository,
    displayName: "Projection Tester",
    result: {
      ok: true,
      trade,
      portfolio,
    },
  });

  assert.equal(result.trade?.id, "sync-trade");
  assert.deepEqual(result.error, {
    stage: "position",
    message: "projection position unavailable",
  });
});
