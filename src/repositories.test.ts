import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthService, MemoryAuthStore } from "./auth.js";
import { MemoryAuditLogRepository, buildAuditService } from "./audit.js";
import { getConfig } from "./config.js";
import { buildDatabase } from "./db.js";
import { MemoryMarketRepository } from "./marketRepository.js";
import { MemoryPortfolioRepository } from "./portfolioRepository.js";
import type { NormalizedMarket, MarketSnapshot } from "./types.js";

function testConfig() {
  return {
    ...getConfig(),
    nodeEnv: "test",
    databaseUrl: null,
    sessionSecret: "test-session-secret",
    authRateLimitMax: 100,
  };
}

test("auth service keeps working with the memory repository fallback", async () => {
  const auth = buildAuthService({
    config: testConfig(),
    store: new MemoryAuthStore(),
  });

  const registered = await auth.register({
    email: "repo-memory@example.com",
    password: "password123",
    displayName: "Repo Memory",
  });
  const context = await auth.authenticateToken(registered.session.token);

  assert.equal(registered.user.email, "repo-memory@example.com");
  assert.equal("passwordHash" in registered.user, false);
  assert.equal(context?.user.id, registered.user.id);
});

test("database module is disabled without DATABASE_URL", async () => {
  const db = buildDatabase(testConfig());

  assert.equal(db.enabled, false);
  await assert.rejects(() => db.query("select 1"), /Database is disabled/);
  await db.close();
});

test("memory market repository upserts markets, outcomes, and snapshots", async () => {
  const repository = new MemoryMarketRepository();
  const market: NormalizedMarket = {
    id: "market-1",
    slug: "market-1",
    title: "Will the test pass?",
    title_ar: null,
    description: null,
    category: "tech",
    category_label: "Tech",
    topics: ["tech"],
    image: null,
    icon: null,
    starts_at: null,
    ends_at: null,
    status: "live",
    active: true,
    closed: false,
    archived: false,
    restricted: false,
    volume: 100,
    liquidity: 50,
    outcomes: [],
    trading: {
      order_book_enabled: true,
      accepting_orders: true,
      best_bid: null,
      best_ask: null,
      last_trade_price: null,
    },
    source: "polymarket",
  };
  const snapshot: MarketSnapshot = {
    id: "snapshot-1",
    market_id: market.id,
    captured_at: new Date().toISOString(),
    prices: {
      yes: 0.6,
      no: 0.4,
      best_bid: null,
      best_ask: null,
      last_trade: null,
      midpoint: null,
      spread: null,
    },
    volume: 100,
    liquidity: 50,
    source: "polymarket",
  };

  await repository.upsertMarket(market);
  await repository.upsertOutcomes(market.id, [
    {
      name: "Yes",
      price: 0.6,
      probability: 0.6,
      price_cents: 60,
      clobTokenId: "token-yes",
    },
  ]);
  await repository.saveSnapshot(snapshot);

  const storedMarket = await repository.getMarketById(market.id);
  const snapshots = await repository.listSnapshots(market.id);

  assert.equal(storedMarket?.outcomes[0]?.name, "Yes");
  assert.equal(snapshots[0]?.id, snapshot.id);
});

test("memory audit repository records auth events without a database", async () => {
  const repository = new MemoryAuditLogRepository();
  const audit = buildAuditService(repository);

  await audit.record({
    eventType: "auth.login",
    userId: "00000000-0000-0000-0000-000000000001",
    metadata: { source: "test" },
  });

  const events = await repository.listRecent();

  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventType, "auth.login");
  assert.equal(events[0]?.metadata.source, "test");
});

test("memory portfolio repository clears only the requested user's positions and trades", async () => {
  const repository = new MemoryPortfolioRepository();
  const now = new Date().toISOString();

  await repository.upsertPosition({
    id: "first-position",
    userId: "first-user",
    marketId: "market-1",
    marketTitle: "Market 1",
    side: "yes",
    shares: "10",
    totalCost: "5",
    averagePrice: "0.5",
    lastPrice: "0.5",
    openedAt: now,
    updatedAt: now,
  });
  await repository.upsertPosition({
    id: "second-position",
    userId: "second-user",
    marketId: "market-2",
    marketTitle: "Market 2",
    side: "no",
    shares: "8",
    totalCost: "4",
    averagePrice: "0.5",
    lastPrice: "0.5",
    openedAt: now,
    updatedAt: now,
  });
  await repository.createTrade({
    id: "first-trade",
    userId: "first-user",
    walletId: null,
    marketId: "market-1",
    side: "yes",
    tradeType: "buy",
    amount: "5",
    price: "0.5",
    shares: "10",
    status: "filled",
    idempotencyKey: "first-trade-key",
    createdAt: now,
  });
  await repository.createTrade({
    id: "second-trade",
    userId: "second-user",
    walletId: null,
    marketId: "market-2",
    side: "no",
    tradeType: "buy",
    amount: "4",
    price: "0.5",
    shares: "8",
    status: "filled",
    idempotencyKey: "second-trade-key",
    createdAt: now,
  });

  await repository.clearUserPortfolio("first-user");

  assert.equal((await repository.getPositionsByUserId("first-user")).length, 0);
  assert.equal((await repository.getTradesByUserId("first-user")).length, 0);
  assert.equal((await repository.getPositionsByUserId("second-user")).length, 1);
  assert.equal((await repository.getTradesByUserId("second-user")).length, 1);
});
