import assert from "node:assert/strict";
import test from "node:test";
import { buildAuditService, MemoryAuditLogRepository } from "./audit.js";
import { buildLedgerService, MemoryLedgerRepository } from "./ledger.js";
import { MemoryPortfolioRepository, type PositionWriteRecord } from "./portfolioRepository.js";
import {
  buildSettlementService,
  MemorySettlementRepository,
  SettlementError,
} from "./settlement.js";

function position(input: {
  userId: string;
  marketId: string;
  side: "yes" | "no";
  stake: number;
}): PositionWriteRecord {
  const now = "2026-05-20T12:00:00.000Z";

  return {
    id: `${input.marketId}:${input.userId}:${input.side}`,
    userId: input.userId,
    marketId: input.marketId,
    marketTitle: "Settlement test market",
    side: input.side,
    shares: String(input.stake / 0.5),
    totalCost: String(input.stake),
    averagePrice: "0.5",
    lastPrice: "0.5",
    openedAt: now,
    updatedAt: now,
  };
}

function buildTestSettlementService() {
  const portfolio = new MemoryPortfolioRepository();
  const ledger = buildLedgerService(new MemoryLedgerRepository());
  const auditRepository = new MemoryAuditLogRepository();
  const audit = buildAuditService(auditRepository);
  const settlementRepository = new MemorySettlementRepository();
  const settlement = buildSettlementService({
    repository: settlementRepository,
    portfolioRepository: portfolio,
    ledger,
    audit,
  });

  return { portfolio, ledger, auditRepository, settlement, settlementRepository };
}

test("settlement resolves winners with platform fee, losses, and balanced payouts", async () => {
  const { portfolio, ledger, auditRepository, settlement } = buildTestSettlementService();

  await portfolio.upsertPosition(position({ userId: "winner", marketId: "market-1", side: "yes", stake: 60 }));
  await portfolio.upsertPosition(position({ userId: "loser", marketId: "market-1", side: "no", stake: 40 }));

  const result = await settlement.resolveMarket({
    marketId: "market-1",
    winningSide: "yes",
    adminUserId: "admin",
    idempotencyKey: "resolve-market-1",
  });
  const winnerPayout = result.payouts.find((payout) => payout.userId === "winner");
  const loserPayout = result.payouts.find((payout) => payout.userId === "loser");
  const winnerBalance = await ledger.getBalance({ userId: "winner", asset: "USDT", walletId: null });
  const loserBalance = await ledger.getBalance({ userId: "loser", asset: "USDT", walletId: null });
  const auditEvents = await auditRepository.listRecent();

  assert.equal(result.settlement.totalPool, 100);
  assert.equal(result.settlement.winningPool, 60);
  assert.equal(result.settlement.platformFee, 2);
  assert.equal(result.settlement.distributablePool, 98);
  assert.equal(result.balancing.payoutTotal, 98);
  assert.equal(result.balancing.balanced, true);
  assert.equal(winnerPayout?.payout, 98);
  assert.equal(winnerPayout?.profit, 38);
  assert.equal(winnerPayout?.kind, "payout");
  assert.equal(loserPayout?.payout, 0);
  assert.equal(loserPayout?.profit, -40);
  assert.equal(loserPayout?.kind, "loss");
  assert.equal(winnerBalance.availableBalance, 98);
  assert.equal(loserBalance.availableBalance, 0);
  assert.equal((await portfolio.listPositionsByMarketId("market-1")).length, 0);
  assert.equal(auditEvents[0]?.eventType, "market.settled");

  await assert.rejects(
    () =>
      settlement.resolveMarket({
        marketId: "market-1",
        winningSide: "yes",
        adminUserId: "admin",
      }),
    (error) => error instanceof SettlementError && error.code === "MARKET_ALREADY_SETTLED",
  );
});

test("settlement cancellation refunds all stakes without a fee", async () => {
  const { portfolio, ledger, settlement } = buildTestSettlementService();

  await portfolio.upsertPosition(position({ userId: "yes-user", marketId: "market-2", side: "yes", stake: 10 }));
  await portfolio.upsertPosition(position({ userId: "no-user", marketId: "market-2", side: "no", stake: 20 }));

  const result = await settlement.cancelMarket({
    marketId: "market-2",
    adminUserId: "admin",
    idempotencyKey: "cancel-market-2",
  });
  const yesBalance = await ledger.getBalance({ userId: "yes-user", asset: "USDT", walletId: null });
  const noBalance = await ledger.getBalance({ userId: "no-user", asset: "USDT", walletId: null });

  assert.equal(result.settlement.status, "cancelled");
  assert.equal(result.settlement.platformFee, 0);
  assert.equal(result.balancing.payoutTotal, 30);
  assert.equal(result.balancing.balanced, true);
  assert.deepEqual(
    result.payouts.map((payout) => [payout.userId, payout.payout, payout.profit, payout.kind]).sort(),
    [
      ["no-user", 20, 0, "refund"],
      ["yes-user", 10, 0, "refund"],
    ],
  );
  assert.equal(yesBalance.availableBalance, 10);
  assert.equal(noBalance.availableBalance, 20);
  assert.equal((await portfolio.listPositionsByMarketId("market-2")).length, 0);
});

test("settlement rounding assigns the cents remainder while preserving the pool balance", async () => {
  const { portfolio, settlement } = buildTestSettlementService();

  await portfolio.upsertPosition(position({ userId: "winner-a", marketId: "market-3", side: "yes", stake: 1 }));
  await portfolio.upsertPosition(position({ userId: "winner-b", marketId: "market-3", side: "yes", stake: 1 }));
  await portfolio.upsertPosition(position({ userId: "winner-c", marketId: "market-3", side: "yes", stake: 1 }));
  await portfolio.upsertPosition(position({ userId: "loser", marketId: "market-3", side: "no", stake: 1 }));

  const result = await settlement.resolveMarket({
    marketId: "market-3",
    winningSide: "yes",
    adminUserId: "admin",
    idempotencyKey: "resolve-market-3",
  });
  const winnerPayouts = result.payouts
    .filter((payout) => payout.kind === "payout")
    .map((payout) => payout.payout)
    .sort();

  assert.deepEqual(winnerPayouts, [1.3, 1.3, 1.32]);
  assert.equal(result.settlement.platformFee, 0.08);
  assert.equal(result.balancing.payoutTotal, 3.92);
  assert.equal(result.balancing.balanced, true);
});
