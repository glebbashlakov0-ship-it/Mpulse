import assert from "node:assert/strict";
import test from "node:test";
import { buildLedgerService, MemoryLedgerRepository } from "./ledger.js";
import {
  MemoryPortfolioRepository,
  PortfolioRepositoryError,
  type CancelCoinTradeOrderInput,
  type CoinTradeOrderRecord,
  type FinalizeCoinTradeOrderInput,
  type FinalizeCoinTradeOrderResult,
  type PortfolioResetCommitInput,
  type PortfolioResetCommitResult,
  type ReserveCoinTradeOrderInput,
  type TradeCommitInput,
  type TradeCommitResult,
} from "./portfolioRepository.js";
import {
  buildTradingMode,
  type CoinLedgerPort,
  createCoinTradingQuote,
  createTradingQuote,
  getPortfolio,
  getTradingMode,
  getTradingModeReadinessBlockerDetails,
  getTradingModeReadinessBlockers,
  LOCAL_SIMULATED_TRADING_PRODUCTION_DISABLED_REASON,
  placeCoinTradingOrder,
  placeLocalOrder,
  placeTradingOrder,
  resetPortfolio,
  TradingPolicyError,
} from "./trading.js";
import type { NormalizedMarketDetail } from "./types.js";
import type { RealMoneyInfrastructureRequirementCode } from "./moneyMovement.js";
import type { RealMoneyExecutionVenueRuntime } from "./realMoneyAdapterRuntime.js";
import {
  realMoneyProviderAdapterRuntimeKindByRequirement,
  requiredVerifiedRealMoneyProviderAdapterEvidenceKinds,
} from "./realMoneyProviderAdapters.js";

test("Coin quotes use the exact decimal price boundary and reject display-only prices", async () => {
  const userId = "exact-price-user";
  const exactMarket = marketDetail({
    outcomes: [
      {
        name: "Yes",
        price: 0.33333333300000004,
        priceDecimal: "0.333333333",
        probability: 0.33333333300000004,
        price_cents: 33,
        clobTokenId: "yes-token",
      },
      {
        name: "No",
        price: 0.666666667,
        priceDecimal: "0.666666667",
        probability: 0.666666667,
        price_cents: 67,
        clobTokenId: "no-token",
      },
    ],
  });
  const input = {
    market: exactMarket,
    side: "yes" as const,
    action: "buy" as const,
    amountCoinMicros: "10000000",
    userId,
    tradingMode: buildTradingMode({ nodeEnv: "test" }),
    coinLedger: fundedCoinLedger(userId),
    portfolioRepository: new MemoryPortfolioRepository(),
    createdAt: "2026-06-01T00:00:00.000Z",
  };

  const exact = await createCoinTradingQuote(input);
  assert.equal(exact.ok, true);
  if (exact.ok) {
    assert.equal(exact.quote.price, "0.333333333");
    assert.equal(exact.quote.shares, "30");
  }

  const unavailable = await createCoinTradingQuote({
    ...input,
    market: {
      ...exactMarket,
      outcomes: exactMarket.outcomes.map((outcome) => ({
        ...outcome,
        priceDecimal: null,
      })),
    },
  });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) {
    assert.equal(unavailable.code, "PRICE_UNAVAILABLE");
  }
});

class FailingCommitPortfolioRepository extends MemoryPortfolioRepository {
  commitCalls = 0;

  async commitTrade(_input: TradeCommitInput): Promise<TradeCommitResult> {
    this.commitCalls += 1;
    throw new Error("atomic commit failed");
  }
}

class RecordingCommitPortfolioRepository extends MemoryPortfolioRepository {
  readonly commits: TradeCommitInput[] = [];

  constructor(private readonly ledger: ReturnType<typeof buildLedgerService>) {
    super();
  }

  async commitTrade(input: TradeCommitInput): Promise<TradeCommitResult> {
    this.commits.push(input);
    const ledger = await this.ledger.createEntry(input.ledgerEntry);

    if (!ledger.idempotent) {
      await super.createTrade(input.trade);
      for (const position of input.positions) {
        await super.upsertPosition(position);
      }
      for (const position of input.deletePositions) {
        await super.deletePosition(position.userId, position.marketId, position.side);
      }
    }

    return {
      ledger,
      audit: input.auditEvent
        ? {
            committed: !ledger.idempotent,
          }
        : undefined,
    };
  }
}

class ResetCommitPortfolioRepository extends MemoryPortfolioRepository {
  readonly resetCommits: PortfolioResetCommitInput[] = [];
  clearCalls = 0;

  async commitPortfolioReset(input: PortfolioResetCommitInput): Promise<PortfolioResetCommitResult> {
    this.resetCommits.push(input);
    await super.clearUserPortfolio(input.userId);
    return { ledger: null };
  }

  async clearUserPortfolio(userId: string) {
    this.clearCalls += 1;
    throw new Error(`clearUserPortfolio should not be called for ${userId}`);
  }
}

class CoinOrderSafetyPortfolioRepository extends MemoryPortfolioRepository {
  order: CoinTradeOrderRecord | null = null;
  reserveReturnsIdempotent = false;
  reserveError: Error | null = null;
  finalizeCalls = 0;
  readonly cancellations: CancelCoinTradeOrderInput[] = [];

  async findCoinTradeOrderByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ) {
    return this.order?.userId === userId &&
      this.order.idempotencyKey === idempotencyKey
      ? this.order
      : null;
  }

  async reserveCoinTradeOrder(input: ReserveCoinTradeOrderInput) {
    if (this.reserveError) throw this.reserveError;
    this.order ??= input.order;
    return {
      order: this.order,
      reserveEntry: null,
      idempotent: this.reserveReturnsIdempotent,
    };
  }

  async finalizeCoinTradeOrder(
    _input: FinalizeCoinTradeOrderInput,
  ): Promise<FinalizeCoinTradeOrderResult> {
    this.finalizeCalls += 1;
    throw new Error("unsafe execution must not reach finalization");
  }

  async cancelCoinTradeOrder(input: CancelCoinTradeOrderInput) {
    this.cancellations.push(input);
    if (!this.order) {
      throw new Error("test order was not reserved");
    }
    this.order = {
      ...this.order,
      status: input.status,
      lastError: input.error,
    };
    return {
      order: this.order,
      releaseEntry: null,
      idempotent: false,
    };
  }
}

function marketDetail(overrides: Partial<NormalizedMarketDetail> = {}): NormalizedMarketDetail {
  const now = new Date("2026-06-01T00:00:00.000Z").toISOString();
  const endsAt = new Date("2030-06-01T00:00:00.000Z").toISOString();

  return {
    id: "atomic-market",
    slug: "atomic-market",
    title: "Will atomic order persistence work?",
    title_ar: null,
    description: null,
    category: "Tech",
    category_label: "Tech",
    topics: ["tech"],
    image: null,
    icon: null,
    starts_at: now,
    ends_at: endsAt,
    status: "live",
    active: true,
    closed: false,
    archived: false,
    restricted: false,
    volume: 100,
    liquidity: 100,
    outcomes: [
      {
        name: "Yes",
        price: 0.5,
        priceDecimal: "0.5",
        probability: 0.5,
        price_cents: 50,
        clobTokenId: "yes-token",
      },
      {
        name: "No",
        price: 0.5,
        priceDecimal: "0.5",
        probability: 0.5,
        price_cents: 50,
        clobTokenId: "no-token",
      },
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
    canonical_market_id: "atomic-market",
    canonical_event_slug: null,
    source: "polymarket",
    prices: {
      yes: 0.5,
      no: 0.5,
      best_bid: null,
      best_ask: null,
      last_trade: null,
      midpoint: null,
      spread: null,
    },
    dates: {
      starts_at: now,
      ends_at: endsAt,
      starts_at_ms: Date.parse(now),
      ends_at_ms: Date.parse(endsAt),
      seconds_to_close: Math.floor((Date.parse(endsAt) - Date.parse(now)) / 1000),
      status: "live",
    },
    volume_detail: {
      volume: 100,
      liquidity: 100,
    },
    related_markets: [],
    history: {
      snapshots: [],
      price_history: [],
      is_synthetic: false,
    },
    group_markets: [],
    ...overrides,
  };
}

async function fundLegacyTradingTest(
  ledger: ReturnType<typeof buildLedgerService>,
  userId: string,
) {
  await ledger.createEntry({
    userId,
    walletId: null,
    asset: "USDT",
    entryType: "credit",
    amount: 100,
    reason: "Explicit legacy test funding",
    referenceType: "test_funding",
    referenceId: userId,
    idempotencyKey: `test-funding:${userId}`,
    metadata: { source: "trading_test" },
  });
}

test("local orders use repository atomic commit instead of writing ledger first", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository());
  const portfolioRepository = new FailingCommitPortfolioRepository();
  await fundLegacyTradingTest(ledger, "atomic-user");

  await assert.rejects(
    () =>
      placeLocalOrder({
        market: marketDetail(),
        side: "yes",
        action: "buy",
        amount: 10,
        userId: "atomic-user",
        idempotencyKey: "atomic-order-1",
        ledger,
        portfolioRepository,
      }),
    /atomic commit failed/,
  );

  const entries = await ledger.listEntries({
    userId: "atomic-user",
    asset: "USDT",
    walletId: null,
    limit: 20,
  });

  assert.equal(portfolioRepository.commitCalls, 1);
  assert.equal(entries.some((entry) => entry.entryType === "trade_debit"), false);
  assert.equal(entries.filter((entry) => entry.referenceType === "local_init").length, 0);
  assert.equal((await portfolioRepository.getTradesByUserId("atomic-user")).length, 0);
});

test("local orders require atomic trade commits when policy demands it", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository());
  const portfolioRepository = new MemoryPortfolioRepository();
  await fundLegacyTradingTest(ledger, "atomic-required-user");

  const order = await placeLocalOrder({
    market: marketDetail(),
    side: "yes",
    action: "buy",
    amount: 10,
    userId: "atomic-required-user",
    idempotencyKey: "atomic-required-order-1",
    ledger,
    portfolioRepository,
    requireAtomicTradeCommits: true,
  });
  const entries = await ledger.listEntries({
    userId: "atomic-required-user",
    asset: "USDT",
    walletId: null,
    limit: 20,
  });

  assert.equal(order.ok, false);
  assert.equal(order.code, "TRADE_ATOMIC_COMMIT_REQUIRED");
  assert.equal(entries.some((entry) => entry.entryType === "trade_debit"), false);
  assert.equal(entries.filter((entry) => entry.referenceType === "local_init").length, 0);
  assert.equal((await portfolioRepository.getTradesByUserId("atomic-required-user")).length, 0);
});

test("local order commit carries trade audit event into the repository owner", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository());
  const portfolioRepository = new RecordingCommitPortfolioRepository(ledger);
  await fundLegacyTradingTest(ledger, "audit-user");

  const order = await placeLocalOrder({
    market: marketDetail(),
    side: "yes",
    action: "buy",
    amount: 10,
    userId: "audit-user",
    idempotencyKey: "audit-order-1",
    ledger,
    portfolioRepository,
    audit: {
      sessionId: "11111111-1111-4111-8111-111111111111",
      metadata: {
        source: "route_test",
      },
    },
  });

  assert.equal(order.ok, true);
  assert.equal(portfolioRepository.commits.length, 1);
  const auditEvent = portfolioRepository.commits[0]?.auditEvent;
  assert.equal(auditEvent?.eventType, "trading.buy_local");
  assert.equal(auditEvent?.userId, "audit-user");
  assert.equal(auditEvent?.sessionId, "11111111-1111-4111-8111-111111111111");
  assert.equal(auditEvent?.metadata.marketId, "atomic-market");
  assert.equal(auditEvent?.metadata.side, "yes");
  assert.equal(auditEvent?.metadata.amount, 10);
  assert.equal(auditEvent?.metadata.idempotencyKey, "audit-order-1");
  assert.equal(auditEvent?.metadata.tradingMode, "local_simulated");
  assert.equal(auditEvent?.metadata.realMoneyEnabled, false);
  assert.equal(auditEvent?.metadata.source, "route_test");
  assert.equal(order.internal?.tradeAuditCommitted, true);
});

test("sell realized PnL and trade details survive a repository reload", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository());
  const portfolioRepository = new MemoryPortfolioRepository();
  const userId = "persisted-pnl-user";
  await fundLegacyTradingTest(ledger, userId);

  const buy = await placeLocalOrder({
    market: marketDetail(),
    side: "yes",
    action: "buy",
    amount: 10,
    userId,
    idempotencyKey: "persisted-pnl-buy",
    ledger,
    portfolioRepository,
  });
  assert.equal(buy.ok, true);

  const yesPrice = 0.75;
  const sellMarket = marketDetail({
    outcomes: [
      {
        name: "Yes",
        price: yesPrice,
        probability: yesPrice,
        price_cents: yesPrice * 100,
        clobTokenId: "yes-token",
      },
      {
        name: "No",
        price: 1 - yesPrice,
        probability: 1 - yesPrice,
        price_cents: (1 - yesPrice) * 100,
        clobTokenId: "no-token",
      },
    ],
    prices: {
      yes: yesPrice,
      no: 1 - yesPrice,
      best_bid: null,
      best_ask: null,
      last_trade: null,
      midpoint: null,
      spread: null,
    },
  });
  const sell = await placeLocalOrder({
    market: sellMarket,
    side: "yes",
    action: "sell",
    shares: 10,
    userId,
    idempotencyKey: "persisted-pnl-sell",
    ledger,
    portfolioRepository,
  });
  assert.equal(sell.ok, true);
  if (!sell.ok) {
    return;
  }

  assert.equal(sell.trade.realizedPnl, 2.5);
  const storedSell = (await portfolioRepository.getTradesByUserId(userId)).find(
    (trade) => trade.tradeType === "sell",
  );
  assert.equal(storedSell?.metadata?.realizedPnl, 2.5);
  assert.equal(storedSell?.metadata?.marketTitle, sellMarket.title);
  assert.equal(storedSell?.metadata?.stakeAmount, 7.5);
  assert.equal(storedSell?.metadata?.platformFee, 0);

  await portfolioRepository.createTrade({
    id: "legacy-trade-without-pnl-metadata",
    userId,
    walletId: null,
    marketId: sellMarket.id,
    side: "yes",
    tradeType: "buy",
    amount: "1",
    price: "0.5",
    shares: "2",
    status: "filled",
    idempotencyKey: null,
    createdAt: "2026-05-01T00:00:00.000Z",
  });

  const reloaded = await getPortfolio(userId, ledger, portfolioRepository);
  const reloadedSell = reloaded.trades.find((trade) => trade.action === "sell");
  const reloadedBuy = reloaded.trades.find((trade) => trade.action === "buy");
  const legacyTrade = reloaded.trades.find(
    (trade) => trade.id === "legacy-trade-without-pnl-metadata",
  );

  assert.equal(reloadedSell?.realizedPnl, 2.5);
  assert.equal(reloadedSell?.marketTitle, sellMarket.title);
  assert.equal(reloadedSell?.stakeAmount, 7.5);
  assert.equal(reloadedSell?.platformFee, 0);
  assert.equal(reloadedBuy?.realizedPnl, null);
  assert.equal(legacyTrade?.realizedPnl, null);
  assert.equal(reloaded.summary.realizedPnl, 2.5);
});

test("portfolio revalues each market once and falls back when live pricing fails", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository());
  const portfolioRepository = new MemoryPortfolioRepository();
  const userId = "live-portfolio-user";
  const now = "2026-06-01T00:00:00.000Z";

  await portfolioRepository.upsertPosition({
    id: "live-position-yes",
    userId,
    marketId: "atomic-market",
    marketTitle: "Stored title",
    side: "yes",
    shares: "10",
    totalCost: "5",
    averagePrice: "0.5",
    lastPrice: "0.5",
    openedAt: now,
    updatedAt: now,
  });
  await portfolioRepository.upsertPosition({
    id: "live-position-no",
    userId,
    marketId: "atomic-market",
    marketTitle: "Stored title",
    side: "no",
    shares: "5",
    totalCost: "2.5",
    averagePrice: "0.5",
    lastPrice: "0.5",
    openedAt: now,
    updatedAt: now,
  });
  await portfolioRepository.upsertPosition({
    id: "fallback-position",
    userId,
    marketId: "unavailable-market",
    marketTitle: "Fallback market",
    side: "yes",
    shares: "2",
    totalCost: "1",
    averagePrice: "0.5",
    lastPrice: "0.4",
    openedAt: now,
    updatedAt: now,
  });

  const calls: string[] = [];
  const portfolio = await getPortfolio(
    userId,
    ledger,
    portfolioRepository,
    undefined,
    undefined,
    async (marketId) => {
      calls.push(marketId);
      if (marketId === "unavailable-market") {
        throw new Error("price feed unavailable");
      }
      return marketDetail({
        title: "Live title",
        outcomes: [
          {
            name: "Yes",
            price: 0.8,
            probability: 0.8,
            price_cents: 80,
            clobTokenId: "yes-token",
          },
          {
            name: "No",
            price: 0.2,
            probability: 0.2,
            price_cents: 20,
            clobTokenId: "no-token",
          },
        ],
        prices: {
          yes: 0.8,
          no: 0.2,
          best_bid: null,
          best_ask: null,
          last_trade: null,
          midpoint: null,
          spread: null,
        },
      });
    },
  );

  assert.deepEqual(calls.sort(), ["atomic-market", "unavailable-market"]);
  const livePosition = portfolio.positions.find(
    (position) => position.marketId === "atomic-market",
  );
  const fallbackPosition = portfolio.positions.find(
    (position) => position.marketId === "unavailable-market",
  );
  assert.equal(livePosition?.marketTitle, "Live title");
  assert.equal(livePosition?.currentValue, 9);
  assert.equal(fallbackPosition?.currentValue, 0.8);
  assert.equal(portfolio.summary.positionValue, 9.8);
  assert.ok(Math.abs(portfolio.summary.unrealizedPnl - 1.3) < 1e-9);
});

test("real-money order execution uses verified runtime and commits a real trade ledger entry", async () => {
  const ledgerRepository = new MemoryLedgerRepository();
  await ledgerRepository.createEntry({
    id: "real-deposit-entry",
    userId: "real-user",
    walletId: null,
    asset: "USDT",
    entryType: "credit",
    amount: 100,
    reason: "Seeded real deposit balance",
    referenceType: "provider_deposit",
    referenceId: "provider-deposit-1",
    idempotencyKey: "provider-deposit-1",
    metadata: { source: "provider_deposit" },
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  const ledger = buildLedgerService(ledgerRepository, {
    appMode: "real_money",
    nodeEnv: "production",
    productionDeployment: true,
    realTradingExecutionEnabled: true,
    marketSettlementCreditEnabled: true,
  });
  const portfolioRepository = new RecordingCommitPortfolioRepository(ledger);
  const tradingMode = buildTradingMode({
    appMode: "real_money",
    nodeEnv: "production",
    productionDeployment: true,
    ...declaredRealMoneyTradingConfig(),
    ...approvedRealMoneyLaunchConfig(),
    verifiedRealMoneyProviderAdapters: completeVerifiedAdapterRegistry(),
  });
  let runtimeInput: unknown = null;
  const realExecutionRuntime: RealMoneyExecutionVenueRuntime = {
    kind: "execution_venue",
    adapterId: "real-execution-adapter-v1",
    provider: "polymarket clob",
    executesOrders: true,
    async executeOrder(input) {
      runtimeInput = input;
      return {
        status: "filled",
        providerOrderId: "provider-order-1",
        providerTradeId: "provider-trade-1",
        executedPrice: 0.5,
        executedShares: 20,
        executedAmount: 10,
        feeAmount: 0,
        settledAt: "2026-06-01T00:00:01.000Z",
        raw: { clob: "filled" },
      };
    },
  };

  const order = await placeTradingOrder({
    market: marketDetail(),
    side: "yes",
    action: "buy",
    amount: 10,
    userId: "real-user",
    idempotencyKey: "real-order-1",
    tradingMode,
    ledger,
    portfolioRepository,
    realExecutionRuntime,
    requireAtomicTradeCommits: true,
    audit: {
      sessionId: "22222222-2222-4222-8222-222222222222",
    },
  });
  const entries = await ledger.listEntries({
    userId: "real-user",
    asset: "USDT",
    walletId: null,
    limit: 20,
  });

  assert.equal(order.ok, true);
  assert.equal(runtimeInput && typeof runtimeInput === "object" && "clobTokenId" in runtimeInput, true);
  assert.equal(portfolioRepository.commits.length, 1);
  assert.equal(portfolioRepository.commits[0]?.ledgerEntry.referenceType, "real_trade");
  assert.equal(portfolioRepository.commits[0]?.ledgerEntry.metadata?.source, "real_execution");
  assert.equal(portfolioRepository.commits[0]?.auditEvent?.eventType, "trading.buy_real");
  assert.equal(order.trade.metadata.providerOrderId, "provider-order-1");
  assert.equal(order.trade.metadata.executionAdapterId, "real-execution-adapter-v1");
  assert.equal(order.quote.tradingMode.mode, "real_money");
  assert.equal(entries.some((entry) => entry.referenceType === "local_init"), false);
  assert.equal(entries.some((entry) => entry.referenceType === "local_trade"), false);
  assert.equal(entries.some((entry) => entry.referenceType === "real_trade"), true);
  assert.equal((await ledger.getBalance({ userId: "real-user" })).availableBalance, 90);
});

test("portfolio reset uses repository atomic reset owner when available", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository());
  const portfolioRepository = new ResetCommitPortfolioRepository();
  const now = "2026-06-01T00:00:00.000Z";

  await ledger.createEntry({
    userId: "reset-user",
    walletId: null,
    asset: "USDT",
    entryType: "credit",
    amount: 10_000,
    reason: "Initial test balance",
    referenceType: "local_init",
    referenceId: "reset-user",
    idempotencyKey: "reset-user-initial",
    metadata: {},
  });
  await portfolioRepository.upsertPosition({
    id: "reset-position",
    userId: "reset-user",
    marketId: "reset-market",
    marketTitle: "Reset market",
    side: "yes",
    shares: "10",
    totalCost: "5",
    averagePrice: "0.5",
    lastPrice: "0.5",
    openedAt: now,
    updatedAt: now,
  });
  await portfolioRepository.createTrade({
    id: "reset-trade",
    userId: "reset-user",
    walletId: null,
    marketId: "reset-market",
    side: "yes",
    tradeType: "buy",
    amount: "5",
    price: "0.5",
    shares: "10",
    status: "filled",
    idempotencyKey: "reset-trade-key",
    createdAt: now,
  });

  await resetPortfolio("reset-user", ledger, portfolioRepository);

  assert.equal(portfolioRepository.resetCommits.length, 1);
  assert.equal(portfolioRepository.resetCommits[0]?.ledgerAdjustment?.targetAvailableBalance, 10_000);
  assert.equal(portfolioRepository.resetCommits[0]?.ledgerAdjustment?.referenceType, "local_reset");
  assert.equal(portfolioRepository.clearCalls, 0);
  assert.equal((await portfolioRepository.getPositionsByUserId("reset-user")).length, 0);
  assert.equal((await portfolioRepository.getTradesByUserId("reset-user")).length, 0);
});

test("trading mode readiness exposes structured real-money blockers", () => {
  const tradingMode = getTradingMode();
  const blockers = getTradingModeReadinessBlockers(tradingMode);
  const details = getTradingModeReadinessBlockerDetails(tradingMode);

  assert.deepEqual(blockers, details.map((blocker) => blocker.message));
  assert.deepEqual(
    details.map((blocker) => [blocker.source, blocker.code]),
    [
      ["trading", "TRADING_MODE_SIMULATED_BALANCES_DISABLED"],
      ["trading", "TRADING_EXECUTION_SIMULATED"],
    ],
  );
  assert.equal(
    tradingMode.warning,
    "Trading uses the Coin ledger with simulated local execution; no external order is submitted.",
  );
  assert.equal(tradingMode.balance.asset, "COIN");
  assert.equal(tradingMode.balance.initialCoinMicros, "0");
  assert.equal(tradingMode.balance.simulatedCreditEnabled, false);
});

test("production trading policy blocks local simulated credits and order execution", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository());
  const tradingMode = buildTradingMode({
    appMode: "local",
    nodeEnv: "production",
  });

  assert.equal(tradingMode.localSimulationEnabled, false);
  assert.equal(tradingMode.balance.simulatedCreditEnabled, false);
  assert.equal(tradingMode.orders.simulatedExecutionEnabled, false);
  assert.equal(
    tradingMode.localSimulationBlockReason,
    LOCAL_SIMULATED_TRADING_PRODUCTION_DISABLED_REASON,
  );

  const portfolio = await getPortfolio(
    "prod-user",
    ledger,
    undefined,
    undefined,
    tradingMode,
  );
  assert.equal(portfolio.wallet.balance, 0);

  const quote = await createTradingQuote({
    market: marketDetail(),
    side: "yes",
    action: "buy",
    amount: 10,
    userId: "prod-user",
    tradingMode,
    ledger,
  });
  assert.equal(quote.ok, false);
  assert.equal(quote.code, "TRADING_UNAVAILABLE");

  const order = await placeLocalOrder({
    market: marketDetail(),
    side: "yes",
    action: "buy",
    amount: 10,
    userId: "prod-user",
    idempotencyKey: "prod-order-1",
    tradingMode,
    ledger,
  });
  assert.equal(order.ok, false);
  assert.equal(order.code, "TRADING_UNAVAILABLE");

  await assert.rejects(
    () => resetPortfolio("prod-user", ledger, undefined, undefined, tradingMode),
    TradingPolicyError,
  );

  const entries = await ledger.listEntries({
    userId: "prod-user",
    asset: "USDT",
    walletId: null,
    limit: 20,
  });
  assert.equal(entries.length, 0);
});

test("production deployment context blocks local simulated trading before NODE_ENV is corrected", () => {
  const tradingMode = buildTradingMode({
    appMode: "local",
    nodeEnv: "development",
    productionDeployment: true,
  });

  assert.equal(tradingMode.localSimulationEnabled, false);
  assert.equal(tradingMode.balance.simulatedCreditEnabled, false);
  assert.equal(tradingMode.orders.simulatedExecutionEnabled, false);
  assert.equal(
    tradingMode.localSimulationBlockReason,
    LOCAL_SIMULATED_TRADING_PRODUCTION_DISABLED_REASON,
  );
});

test("production internal Coin trading requires an explicit opt-in and never enables CLOB execution", () => {
  const tradingMode = buildTradingMode({
    appMode: "local",
    nodeEnv: "production",
    productionDeployment: true,
    coinInternalTradingEnabled: true,
  });

  assert.equal(tradingMode.mode, "local_simulated");
  assert.equal(tradingMode.localSimulationEnabled, true);
  assert.equal(tradingMode.orders.simulatedExecutionEnabled, true);
  assert.equal(tradingMode.realMoneyEnabled, false);
  assert.equal(tradingMode.orders.realExecutionEnabled, false);
});

test("verified production real-money trading mode enables real execution readiness", () => {
  const tradingMode = buildTradingMode({
    appMode: "real_money",
    nodeEnv: "production",
    productionDeployment: true,
    ...declaredRealMoneyTradingConfig(),
    ...approvedRealMoneyLaunchConfig(),
    verifiedRealMoneyProviderAdapters: completeVerifiedAdapterRegistry(),
  });
  const blockerCodes = getTradingModeReadinessBlockerDetails(tradingMode).map(
    (blocker) => blocker.code,
  );

  assert.equal(tradingMode.mode, "real_money");
  assert.equal(tradingMode.realMoneyEnabled, true);
  assert.equal(tradingMode.simulated, false);
  assert.equal(tradingMode.localSimulationEnabled, false);
  assert.equal(tradingMode.balance.simulatedCreditEnabled, false);
  assert.equal(tradingMode.orders.simulatedExecutionEnabled, false);
  assert.equal(tradingMode.orders.realExecutionEnabled, true);
  assert.equal(tradingMode.orders.blockReason, null);
  assert.equal(tradingMode.realMoneyInfrastructure.status, "verified");
  assert.equal(blockerCodes.includes("TRADING_MODE_SIMULATED_BALANCES"), false);
  assert.equal(blockerCodes.includes("TRADING_EXECUTION_SIMULATED"), false);
  assert.deepEqual(blockerCodes, []);
});

test("verified production infrastructure stays fail-closed without audited launch approval", () => {
  const tradingMode = buildTradingMode({
    appMode: "real_money",
    nodeEnv: "production",
    productionDeployment: true,
    ...declaredRealMoneyTradingConfig(),
    realMoneyLaunchApprovalRef: "docs/real-money-launch-approval.md",
    verifiedRealMoneyProviderAdapters: completeVerifiedAdapterRegistry(),
  });

  assert.equal(tradingMode.launchApproval.refAccepted, true);
  assert.equal(tradingMode.launchApproval.approved, false);
  assert.equal(tradingMode.realMoneyEnabled, false);
  assert.equal(tradingMode.orders.realExecutionEnabled, false);
});

test("an execution-pending idempotent retry never calls the venue again", async () => {
  const repository = new CoinOrderSafetyPortfolioRepository();
  repository.reserveReturnsIdempotent = true;
  let venueCalls = 0;
  const runtime = coinExecutionRuntime(async () => {
    venueCalls += 1;
    return validCoinExecution();
  });
  const input = {
    market: marketDetail(),
    side: "yes" as const,
    action: "buy" as const,
    amountCoinMicros: "10000000",
    userId: "pending-coin-user",
    tradingMode: approvedRealMoneyTradingMode(),
    coinLedger: fundedCoinLedger("pending-coin-user"),
    portfolioRepository: repository,
    idempotencyKey: "pending-coin-order",
    realExecutionRuntime: runtime,
    createdAt: "2026-06-01T00:00:00.000Z",
  };

  const racedReservation = await placeCoinTradingOrder(input);
  const explicitRetry = await placeCoinTradingOrder(input);

  assert.equal(racedReservation.ok, false);
  assert.equal(explicitRetry.ok, false);
  if (!racedReservation.ok) {
    assert.equal(racedReservation.code, "EXECUTION_RECONCILIATION_REQUIRED");
  }
  if (!explicitRetry.ok) {
    assert.equal(explicitRetry.code, "EXECUTION_RECONCILIATION_REQUIRED");
  }
  assert.equal(repository.order?.status, "execution_pending");
  assert.equal(repository.cancellations.length, 0);
  assert.equal(venueCalls, 0);
});

test("provider fills that violate exact Coin invariants stay reserved for reconciliation", async (t) => {
  const unsafeExecutions = [
    {
      name: "amount does not equal shares times price",
      result: {
        ...validCoinExecution(),
        executedAmount: 9,
        feeAmount: 0.18,
      },
    },
    {
      name: "executed shares exceed requested shares",
      result: {
        ...validCoinExecution(),
        executedShares: 21,
        executedAmount: 10.5,
        feeAmount: 0.21,
      },
    },
    {
      name: "partial status claims a full share fill",
      result: {
        ...validCoinExecution(),
        status: "partially_filled" as const,
      },
    },
    {
      name: "fee differs from the fixed two-percent policy",
      result: {
        ...validCoinExecution(),
        feeAmount: 0,
      },
    },
    {
      name: "filled status with shares but zero amount is never treated as a cancellation",
      result: {
        ...validCoinExecution(),
        executedAmount: 0,
        feeAmount: 0,
      },
    },
    {
      name: "invalid provider fill units require reconciliation",
      result: {
        ...validCoinExecution(),
        executedAmount: -1,
      },
    },
    {
      name: "missing provider order identity requires reconciliation",
      result: {
        ...validCoinExecution(),
        providerOrderId: "",
      },
    },
  ];

  for (const [index, fixture] of unsafeExecutions.entries()) {
    await t.test(fixture.name, async () => {
      const repository = new CoinOrderSafetyPortfolioRepository();
      let venueCalls = 0;
      const result = await placeCoinTradingOrder({
        market: marketDetail(),
        side: "yes",
        action: "buy",
        amountCoinMicros: "10000000",
        userId: `unsafe-fill-user-${index}`,
        tradingMode: approvedRealMoneyTradingMode(),
        coinLedger: fundedCoinLedger(`unsafe-fill-user-${index}`),
        portfolioRepository: repository,
        idempotencyKey: `unsafe-fill-${index}`,
        realExecutionRuntime: coinExecutionRuntime(async () => {
          venueCalls += 1;
          return fixture.result;
        }),
        createdAt: "2026-06-01T00:00:00.000Z",
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "EXECUTION_RECONCILIATION_REQUIRED");
      }
      assert.equal(venueCalls, 1);
      assert.equal(repository.finalizeCalls, 0);
      assert.equal(repository.cancellations.length, 1);
      assert.equal(repository.cancellations[0]?.status, "manual_review");
      assert.equal(repository.cancellations[0]?.releaseEntry, null);
      assert.equal(repository.order?.status, "manual_review");
    });
  }
});

test("active sell state conflicts are returned before venue execution", async () => {
  const repository = new CoinOrderSafetyPortfolioRepository();
  await repository.upsertPosition({
    id: "active-sell-position",
    userId: "active-sell-user",
    marketId: "atomic-market",
    marketTitle: "Will atomic order persistence work?",
    side: "yes",
    shares: "20",
    totalCost: "10",
    averagePrice: "0.5",
    lastPrice: "0.5",
    totalCostCoinMicros: "10000000",
    averagePriceNanos: "500000000",
    lastPriceNanos: "500000000",
    openedAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
  repository.reserveError = new PortfolioRepositoryError(
    "TRADING_ORDER_STATE_CONFLICT",
    "Another sell execution is already active for this market position.",
    409,
  );
  let venueCalls = 0;

  const result = await placeCoinTradingOrder({
    market: marketDetail(),
    side: "yes",
    action: "sell",
    shares: "10",
    userId: "active-sell-user",
    tradingMode: approvedRealMoneyTradingMode(),
    coinLedger: fundedCoinLedger("active-sell-user"),
    portfolioRepository: repository,
    idempotencyKey: "active-sell-conflict",
    realExecutionRuntime: coinExecutionRuntime(async () => {
      venueCalls += 1;
      return {
        ...validCoinExecution(),
        executedShares: 10,
        executedAmount: 5,
        feeAmount: 0.1,
      };
    }),
    createdAt: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "TRADING_ORDER_STATE_CONFLICT");
  }
  assert.equal(venueCalls, 0);
});

function declaredRealMoneyTradingConfig() {
  return {
    realMoneyCustodyProvider: "Fireblocks",
    realMoneyDepositProvider: "TRONGrid",
    realMoneyWithdrawalProvider: "Fireblocks",
    realMoneyExecutionProvider: "Polymarket CLOB",
    realMoneyReconciliationProvider: "internal-ledger-reconciler",
    realMoneyAccountRiskProvider: "internal-risk-engine",
    realMoneySanctionsProvider: "chainalysis",
    realMoneyLedgerSettlementReconciliationConfigured: true,
    realMoneyOperationsMonitoringConfigured: true,
  };
}

function approvedRealMoneyLaunchConfig() {
  return {
    realMoneyLaunchApprovalRef: "docs/real-money-launch-approval.md",
    realMoneyLaunchApprovalArtifactApproved: true,
  };
}

function approvedRealMoneyTradingMode() {
  return buildTradingMode({
    appMode: "real_money",
    nodeEnv: "production",
    productionDeployment: true,
    ...declaredRealMoneyTradingConfig(),
    ...approvedRealMoneyLaunchConfig(),
    verifiedRealMoneyProviderAdapters: completeVerifiedAdapterRegistry(),
  });
}

function fundedCoinLedger(userId: string): CoinLedgerPort {
  return {
    async getBalance() {
      return {
        userId,
        availableCoinMicros: "100000000",
        reservedCoinMicros: "0",
        totalCoinMicros: "100000000",
      };
    },
    async listEntries() {
      return [];
    },
    async postEntry() {
      throw new Error("test repository owns Coin ledger writes");
    },
  };
}

function validCoinExecution() {
  return {
    status: "filled" as const,
    providerOrderId: "provider-order-safe",
    providerTradeId: "provider-trade-safe",
    executedPrice: 0.5,
    executedShares: 20,
    executedAmount: 10,
    feeAmount: 0.2,
    settledAt: "2026-06-01T00:00:01.000Z",
    raw: { fixture: true },
  };
}

function coinExecutionRuntime(
  executeOrder: () => Promise<unknown>,
) {
  return {
    kind: "execution_venue",
    adapterId: "coin-safety-test-runtime",
    provider: "polymarket",
    executesOrders: true,
    executeOrder,
  } as unknown as RealMoneyExecutionVenueRuntime;
}

function completeVerifiedAdapterRegistry() {
  return realMoneyRequirementCodes.map((requirementCode) =>
    verifiedAdapter(requirementCode, providerForRequirement(requirementCode)),
  );
}

const realMoneyRequirementCodes: RealMoneyInfrastructureRequirementCode[] = [
  "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
  "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
  "WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED",
  "PROVIDER_RECONCILIATION_REQUIRED",
  "ACCOUNT_RISK_PROVIDER_REQUIRED",
  "SANCTIONS_SCREENING_PROVIDER_REQUIRED",
  "REAL_EXECUTION_VENUE_REQUIRED",
  "LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED",
  "OPERATIONS_MONITORING_REQUIRED",
];

function providerForRequirement(requirementCode: RealMoneyInfrastructureRequirementCode) {
  switch (requirementCode) {
    case "PRODUCTION_CUSTODY_PROVIDER_REQUIRED":
    case "WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED":
      return "fireblocks";
    case "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED":
      return "trongrid";
    case "PROVIDER_RECONCILIATION_REQUIRED":
      return "internal-ledger-reconciler";
    case "ACCOUNT_RISK_PROVIDER_REQUIRED":
      return "internal-risk-engine";
    case "SANCTIONS_SCREENING_PROVIDER_REQUIRED":
      return "chainalysis";
    case "REAL_EXECUTION_VENUE_REQUIRED":
      return "polymarket clob";
    case "LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED":
    case "OPERATIONS_MONITORING_REQUIRED":
      return null;
  }
}

function verifiedAdapter(
  requirementCode: RealMoneyInfrastructureRequirementCode,
  provider: string | null,
) {
  return {
    requirementCode,
    provider,
    adapterId: `${requirementCode.toLowerCase()}-adapter-v1`,
    runtime: {
      moduleRef: `src/realMoneyAdapters/adapter_${requirementCode.toLowerCase()}.ts`,
      exportName: `adapter_${requirementCode.toLowerCase()}`,
      kind: realMoneyProviderAdapterRuntimeKindByRequirement[requirementCode],
    },
    verified: true,
    evidence: requiredVerifiedRealMoneyProviderAdapterEvidenceKinds.map((kind) => ({
      kind,
      ref:
        kind === "integration_test"
          ? `src/${requirementCode.toLowerCase()}.test.ts`
          : `docs/${requirementCode.toLowerCase()}-${kind}.md`,
    })),
  } as const;
}
