import assert from "node:assert/strict";
import test from "node:test";
import { buildAuditService, MemoryAuditLogRepository } from "./audit.js";
import type { Database, Queryable } from "./db.js";
import { buildLedgerService, MemoryLedgerRepository } from "./ledger.js";
import { MemoryPortfolioRepository, type PositionWriteRecord } from "./portfolioRepository.js";
import {
  buildSettlementService,
  MemorySettlementRepository,
  PostgresSettlementRepository,
  SettlementError,
  type SettlementCommitInput,
  type SettlementRecord,
  type SettlementRepository,
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

test("settlement service delegates payouts to atomic repository commit without pre-crediting ledger", async () => {
  const portfolio = new MemoryPortfolioRepository();
  const ledger = buildLedgerService(new MemoryLedgerRepository(), {
    marketSettlementCreditEnabled: false,
  });
  const audit = buildAuditService(new MemoryAuditLogRepository());
  const capturedCommits: SettlementCommitInput[] = [];
  const repository: SettlementRepository = {
    async findByMarketId() {
      return null;
    },
    async createSettlement() {
      throw new Error("non-atomic settlement path should not be used");
    },
    async commitSettlement(input) {
      capturedCommits.push(input);
      const payouts = input.payouts.map((payout) => ({
        ...payout,
        ledgerEntryId:
          input.ledgerEntries.find((entry) => entry.payoutId === payout.id)
            ? `ledger:${payout.id}`
            : null,
      }));
      const payoutTotal = payouts.reduce((total, payout) => total + payout.payout, 0);

      return {
        settlement: input.settlement,
        payouts,
        balancing: {
          totalPool: input.settlement.totalPool,
          payoutTotal,
          platformFee: input.settlement.platformFee,
          balanced: Math.abs(payoutTotal + input.settlement.platformFee - input.settlement.totalPool) < 0.01,
        },
      };
    },
  };
  const settlement = buildSettlementService({
    repository,
    portfolioRepository: portfolio,
    ledger,
    audit,
  });

  await portfolio.upsertPosition(
    position({ userId: "winner", marketId: "atomic-market", side: "yes", stake: 60 }),
  );
  await portfolio.upsertPosition(
    position({ userId: "loser", marketId: "atomic-market", side: "no", stake: 40 }),
  );

  const result = await settlement.resolveMarket({
    marketId: "atomic-market",
    winningSide: "yes",
    adminUserId: "admin",
    idempotencyKey: "atomic-settlement",
  });
  const winnerBalance = await ledger.getBalance({ userId: "winner", walletId: null });

  assert.equal(capturedCommits[0]?.ledgerEntries.length, 1);
  assert.equal(capturedCommits[0]?.ledgerEntries[0]?.input.metadata?.source, "market_settlement");
  assert.equal(
    result.payouts
      .find((payout) => payout.userId === "winner")
      ?.ledgerEntryId?.startsWith("ledger:"),
    true,
  );
  assert.equal(winnerBalance.availableBalance, 0);
});

test("settlement service rejects committed positive payouts without ledger entries", async () => {
  const portfolio = new MemoryPortfolioRepository();
  const ledger = buildLedgerService(new MemoryLedgerRepository(), {
    marketSettlementCreditEnabled: false,
  });
  const auditRepository = new MemoryAuditLogRepository();
  const audit = buildAuditService(auditRepository);
  const repository: SettlementRepository = {
    async findByMarketId() {
      return null;
    },
    async createSettlement() {
      throw new Error("non-atomic settlement path should not be used");
    },
    async commitSettlement(input) {
      return {
        settlement: input.settlement,
        payouts: input.payouts,
        balancing: {
          totalPool: input.settlement.totalPool,
          payoutTotal: input.payouts.reduce((total, payout) => total + payout.payout, 0),
          platformFee: input.settlement.platformFee,
          balanced: true,
        },
      };
    },
  };
  const settlement = buildSettlementService({
    repository,
    portfolioRepository: portfolio,
    ledger,
    audit,
  });

  await portfolio.upsertPosition(
    position({ userId: "winner", marketId: "missing-ledger-market", side: "yes", stake: 60 }),
  );
  await portfolio.upsertPosition(
    position({ userId: "loser", marketId: "missing-ledger-market", side: "no", stake: 40 }),
  );

  await assert.rejects(
    () =>
      settlement.resolveMarket({
        marketId: "missing-ledger-market",
        winningSide: "yes",
        adminUserId: "admin",
        idempotencyKey: "missing-ledger-settlement",
      }),
    (error) =>
      error instanceof SettlementError &&
      error.code === "SETTLEMENT_COMMIT_INCOMPLETE" &&
      error.statusCode === 500,
  );

  assert.equal((await auditRepository.listRecent()).length, 0);
});

test("settlement service requires atomic commits when policy demands it", async () => {
  const portfolio = new MemoryPortfolioRepository();
  const ledger = buildLedgerService(new MemoryLedgerRepository(), {
    marketSettlementCreditEnabled: true,
  });
  const audit = buildAuditService(new MemoryAuditLogRepository());
  const settlement = buildSettlementService({
    repository: new MemorySettlementRepository(),
    portfolioRepository: portfolio,
    ledger,
    audit,
    requireAtomicSettlementCommits: true,
  });

  await portfolio.upsertPosition(
    position({ userId: "winner", marketId: "atomic-required-market", side: "yes", stake: 60 }),
  );
  await portfolio.upsertPosition(
    position({ userId: "loser", marketId: "atomic-required-market", side: "no", stake: 40 }),
  );

  await assert.rejects(
    () =>
      settlement.resolveMarket({
        marketId: "atomic-required-market",
        winningSide: "yes",
        adminUserId: "admin",
        idempotencyKey: "atomic-required-settlement",
      }),
    (error) =>
      error instanceof SettlementError &&
      error.code === "SETTLEMENT_ATOMIC_COMMIT_REQUIRED" &&
      error.statusCode === 500,
  );

  const winnerBalance = await ledger.getBalance({ userId: "winner", walletId: null });
  const positions = await portfolio.listPositionsByMarketId("atomic-required-market");

  assert.equal(winnerBalance.availableBalance, 0);
  assert.equal(positions.length, 2);
});

test("settlement without atomic repository stops before persistence when ledger policy blocks payouts", async () => {
  const portfolio = new MemoryPortfolioRepository();
  const ledger = buildLedgerService(new MemoryLedgerRepository(), {
    marketSettlementCreditEnabled: false,
  });
  const auditRepository = new MemoryAuditLogRepository();
  const audit = buildAuditService(auditRepository);
  const settlementRepository = new MemorySettlementRepository();
  const settlement = buildSettlementService({
    repository: settlementRepository,
    portfolioRepository: portfolio,
    ledger,
    audit,
  });

  await portfolio.upsertPosition(
    position({ userId: "winner", marketId: "blocked-policy-market", side: "yes", stake: 60 }),
  );
  await portfolio.upsertPosition(
    position({ userId: "loser", marketId: "blocked-policy-market", side: "no", stake: 40 }),
  );

  await assert.rejects(
    () =>
      settlement.resolveMarket({
        marketId: "blocked-policy-market",
        winningSide: "yes",
        adminUserId: "admin",
        idempotencyKey: "blocked-policy-settlement",
      }),
    /MARKET_SETTLEMENT_LEDGER_DISABLED/,
  );

  assert.equal(await settlementRepository.findByMarketId("blocked-policy-market"), null);
  assert.equal((await portfolio.listPositionsByMarketId("blocked-policy-market")).length, 2);
  assert.equal((await auditRepository.listRecent()).length, 0);
  assert.equal(
    (await ledger.getBalance({ userId: "winner", walletId: null })).availableBalance,
    0,
  );
});

test("postgres settlement repository rejects direct writes outside atomic commit", async () => {
  let queryWasCalled = false;
  const db: Queryable = {
    async query() {
      queryWasCalled = true;
      throw new Error("query should not run for direct Postgres settlement writes");
    },
  };
  const repository = new PostgresSettlementRepository(db);
  const settlement: SettlementRecord = {
    id: "00000000-0000-0000-0000-000000000011",
    marketId: "direct-settlement-market",
    status: "resolved",
    winningSide: "yes",
    totalPool: 10,
    winningPool: 10,
    platformFee: 0.2,
    distributablePool: 9.8,
    payoutCount: 1,
    createdBy: null,
    idempotencyKey: "direct-settlement",
    createdAt: "2026-05-20T12:00:00.000Z",
  };

  await assert.rejects(
    () =>
      repository.createSettlement(settlement, [
        {
          id: "00000000-0000-0000-0000-000000000012",
          settlementId: settlement.id,
          marketId: settlement.marketId,
          userId: "00000000-0000-0000-0000-000000000013",
          side: "yes",
          originalStake: 10,
          payout: 9.8,
          profit: -0.2,
          kind: "payout",
          ledgerEntryId: null,
          createdAt: settlement.createdAt,
        },
      ]),
    (error) =>
      error instanceof SettlementError &&
      error.code === "SETTLEMENT_ATOMIC_COMMIT_REQUIRED" &&
      error.statusCode === 500,
  );

  assert.equal(queryWasCalled, false);
});

test("postgres settlement commit writes settlement audit inside the owner transaction", async () => {
  const queries: string[] = [];
  let auditInsertValues: readonly unknown[] | undefined;
  const settlementRecord: SettlementRecord = {
    id: "00000000-0000-0000-0000-000000000021",
    marketId: "audit-settlement-market",
    status: "resolved",
    winningSide: "yes",
    totalPool: 10,
    winningPool: 10,
    platformFee: 0.2,
    distributablePool: 9.8,
    payoutCount: 1,
    createdBy: "admin-user",
    idempotencyKey: "audit-settlement",
    createdAt: "2026-05-20T12:00:00.000Z",
  };
  const db: Database = {
    enabled: true,
    async query() {
      throw new Error("outer query should not be used");
    },
    async transaction<T>(callback: (client: Queryable) => Promise<T>) {
      const client: Queryable = {
        async query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]) {
          if (text.includes("pg_advisory_xact_lock")) {
            queries.push("market_lock");
            return { rows: [] };
          }

          if (text.includes("from trade_execution_orders")) {
            queries.push("active_execution_check");
            return { rows: [{ count: "0" } as T] };
          }

          if (text.includes("insert into market_settlements")) {
            queries.push("settlement_insert");
            return { rows: [] };
          }

          if (text.includes("insert into market_settlement_payouts")) {
            queries.push("payout_insert");
            return { rows: [] };
          }

          if (text.includes("delete from positions")) {
            queries.push("positions_delete");
            return { rows: [] };
          }

          if (text.includes("insert into audit_logs")) {
            queries.push("audit_insert");
            auditInsertValues = values;
            return { rows: [] };
          }

          throw new Error(`Unexpected query: ${text}`);
        },
      };

      return callback(client);
    },
    async close() {
      // No-op.
    },
  };
  const repository = new PostgresSettlementRepository(db, {
    marketSettlementCreditEnabled: true,
  });

  const result = await repository.commitSettlement({
    settlement: settlementRecord,
    payouts: [
      {
        id: "00000000-0000-0000-0000-000000000022",
        settlementId: settlementRecord.id,
        marketId: settlementRecord.marketId,
        userId: "00000000-0000-0000-0000-000000000023",
        side: "yes",
        originalStake: 10,
        payout: 0,
        profit: -10,
        kind: "loss",
        ledgerEntryId: null,
        createdAt: settlementRecord.createdAt,
      },
    ],
    ledgerEntries: [],
    auditEvent: (settlementResult) => ({
      id: "11111111-1111-4111-8111-111111111122",
      eventType: "market.settled",
      userId: "admin-user",
      sessionId: "admin-session",
      metadata: {
        settlementId: settlementResult.settlement.id,
        payoutTotal: settlementResult.balancing.payoutTotal,
        balanced: settlementResult.balancing.balanced,
      },
      createdAt: settlementResult.settlement.createdAt,
    }),
  });

  assert.equal(result.settlement.id, settlementRecord.id);
  assert.deepEqual(queries, [
    "market_lock",
    "active_execution_check",
    "settlement_insert",
    "payout_insert",
    "positions_delete",
    "audit_insert",
  ]);
  assert.equal(auditInsertValues?.[1], "market.settled");
  assert.equal(auditInsertValues?.[2], "admin-user");
  assert.equal(auditInsertValues?.[3], "admin-session");
  assert.deepEqual(JSON.parse(String(auditInsertValues?.[4])), {
    settlementId: settlementRecord.id,
    payoutTotal: 0,
    balanced: false,
  });
});

test("postgres settlement commit inserts settlement before ledger entries", async () => {
  const queries: string[] = [];
  const settlementRecord: SettlementRecord = {
    id: "00000000-0000-0000-0000-000000000001",
    marketId: "duplicate-market",
    status: "resolved",
    winningSide: "yes",
    totalPool: 10,
    winningPool: 10,
    platformFee: 0.2,
    distributablePool: 9.8,
    payoutCount: 1,
    createdBy: null,
    idempotencyKey: "duplicate-settlement",
    createdAt: "2026-05-20T12:00:00.000Z",
  };
  const db: Database = {
    enabled: true,
    async query() {
      throw new Error("outer query should not be used");
    },
    async transaction<T>(callback: (client: Queryable) => Promise<T>) {
      const client: Queryable = {
        async query(text) {
          queries.push(text);
          if (text.includes("insert into market_settlements")) {
            throw Object.assign(new Error("duplicate market settlement"), { code: "23505" });
          }
          return { rows: [] };
        },
      };

      return callback(client);
    },
    async close() {
      // No-op.
    },
  };
  const repository = new PostgresSettlementRepository(db, {
    marketSettlementCreditEnabled: true,
  });

  await assert.rejects(
    () =>
      repository.commitSettlement({
        settlement: settlementRecord,
        payouts: [
          {
            id: "00000000-0000-0000-0000-000000000002",
            settlementId: settlementRecord.id,
            marketId: settlementRecord.marketId,
            userId: "00000000-0000-0000-0000-000000000003",
            side: "yes",
            originalStake: 10,
            payout: 9.8,
            profit: -0.2,
            kind: "payout",
            ledgerEntryId: null,
            createdAt: settlementRecord.createdAt,
          },
        ],
        ledgerEntries: [
          {
            payoutId: "00000000-0000-0000-0000-000000000002",
            input: {
              userId: "00000000-0000-0000-0000-000000000003",
              entryType: "credit",
              amount: 9.8,
              reason: "settlement_payout",
              referenceType: "market_settlement",
              referenceId: settlementRecord.id,
              idempotencyKey: "settlement:duplicate-market:winner:yes",
              metadata: { source: "market_settlement" },
            },
          },
        ],
      }),
    (error) => error instanceof SettlementError && error.code === "MARKET_ALREADY_SETTLED",
  );

  assert.equal(queries.length, 3);
  assert.match(queries[0] ?? "", /pg_advisory_xact_lock/);
  assert.match(queries[1] ?? "", /from trade_execution_orders/);
  assert.match(queries[2] ?? "", /insert into market_settlements/);
  assert.equal(queries.some((query) => query.includes("ledger_entries")), false);
});

test("postgres Coin settlement blocks while an execution needs reconciliation", async () => {
  let settlementInserted = false;
  const db: Database = {
    enabled: true,
    async query() {
      throw new Error("outer query should not be used");
    },
    async transaction<T>(callback: (client: Queryable) => Promise<T>) {
      return callback({
        async query<T = Record<string, unknown>>(text: string) {
          if (text.includes("pg_advisory_xact_lock")) {
            return { rows: [] };
          }
          if (text.includes("from trade_execution_orders")) {
            return { rows: [{ count: "1" } as T] };
          }
          if (text.includes("insert into market_settlements")) {
            settlementInserted = true;
          }
          return { rows: [] };
        },
      });
    },
    async close() {
      // No-op.
    },
  };
  const repository = new PostgresSettlementRepository(db, {
    marketSettlementCreditEnabled: true,
  });

  await assert.rejects(
    () =>
      repository.commitCoinSettlement({
        marketId: "market-with-pending-execution",
        status: "resolved",
        winningSide: "yes",
        adminUserId: null,
        adminActorId: null,
        sessionId: null,
        idempotencyKey: "pending-execution-settlement",
      }),
    (error) =>
      error instanceof SettlementError &&
      error.code === "SETTLEMENT_EXECUTIONS_PENDING",
  );
  assert.equal(settlementInserted, false);
});
