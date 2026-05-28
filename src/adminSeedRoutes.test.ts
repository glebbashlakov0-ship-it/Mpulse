import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./server.js";
import { marketFixture, testConfig } from "./testUtils.js";
import type { PolymarketMarket } from "./types.js";

function getCookieHeader(response: {
  headers: Record<string, string | number | string[] | undefined>;
}) {
  const header = response.headers["set-cookie"];
  const cookie = Array.isArray(header) ? header[0] : String(header ?? "");
  assert.ok(cookie.length > 0);
  return cookie.split(";")[0];
}

async function register(app: ReturnType<typeof buildApp>, email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "password12345",
      displayName: "Admin Seed Tester",
    },
  });

  assert.equal(response.statusCode, 200);
  return getCookieHeader(response);
}

async function loginAdmin(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: {
      username: "admin",
      password: "admin",
    },
  });

  assert.equal(response.statusCode, 200);
  return getCookieHeader(response);
}

function installMarketFetch(markets: Record<string, PolymarketMarket>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname.startsWith("/markets/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      return Response.json(markets[id] ?? marketFixture({ id }));
    }

    if (url.pathname === "/markets") {
      return Response.json([]);
    }

    if (url.pathname === "/events") {
      return Response.json([]);
    }

    if (url.pathname === "/public-search") {
      return Response.json({ events: [], markets: [] });
    }

    return Response.json([]);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("admin seed odds endpoint ignores public user sessions", async () => {
  const restoreFetch = installMarketFetch({});
  const app = buildApp(testConfig());

  try {
    const cookie = await register(app, "regular@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/markets/market-1/seed-odds-history",
      headers: { cookie },
      payload: { points: 24 },
    });

    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 401);
    assert.equal(body.error.code, "ADMIN_PANEL_UNAUTHENTICATED");
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("admin event activity seed endpoint ignores public user sessions", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await register(app, "event-regular@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/markets/seed-event-activity",
      headers: { cookie },
      payload: {
        marketIds: ["activity-market"],
        userIds: ["user-1"],
      },
    });

    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 401);
    assert.equal(body.error.code, "ADMIN_PANEL_UNAUTHENTICATED");
  } finally {
    await app.close();
  }
});

test("admin seed odds endpoint is idempotent without force and updates detail history", async () => {
  const restoreFetch = installMarketFetch({
    "seed-market": marketFixture({ id: "seed-market" }),
  });
  const app = buildApp(testConfig());

  try {
    const cookie = await loginAdmin(app);
    const first = await app.inject({
      method: "POST",
      url: "/api/admin/markets/seed-market/seed-odds-history",
      headers: { cookie },
      payload: { points: 24, volatility: 0.08 },
    });
    const firstBody = JSON.parse(first.body) as {
      data: { created: boolean; pointCount: number; outcomes: Array<{ price: number }> };
    };

    assert.equal(first.statusCode, 200);
    assert.equal(firstBody.data.created, true);
    assert.notEqual(firstBody.data.outcomes[0]?.price, 0.5);

    const second = await app.inject({
      method: "POST",
      url: "/api/admin/markets/seed-market/seed-odds-history",
      headers: { cookie },
      payload: { points: 48, volatility: 0.2 },
    });
    const secondBody = JSON.parse(second.body) as {
      data: { created: boolean; pointCount: number; outcomes: Array<{ price: number }> };
    };

    assert.equal(second.statusCode, 200);
    assert.equal(secondBody.data.created, false);
    assert.equal(secondBody.data.pointCount, firstBody.data.pointCount);
    assert.deepEqual(secondBody.data.outcomes, firstBody.data.outcomes);

    const detail = await app.inject({
      method: "GET",
      url: "/api/markets/seed-market",
    });
    const detailBody = JSON.parse(detail.body) as {
      data: {
        outcomes: Array<{ price: number }>;
        history: { is_synthetic: boolean; price_history: unknown[] };
      };
    };

    assert.equal(detail.statusCode, 200);
    assert.equal(detailBody.data.history.is_synthetic, false);
    assert.equal(detailBody.data.history.price_history.length, firstBody.data.pointCount);
    assert.equal(detailBody.data.outcomes[0]?.price, firstBody.data.outcomes[0]?.price);
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("admin event activity seed creates deposits, trades, positions, history, and public activity", async () => {
  const restoreFetch = installMarketFetch({
    "activity-market": marketFixture({
      id: "activity-market",
      question: "Will activity seed work?",
      outcomePrices: JSON.stringify(["0.64", "0.36"]),
    }),
  });
  const app = buildApp(testConfig());

  try {
    const adminCookie = await loginAdmin(app);
    const userCookie = await register(app, "event-user@example.com");
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: userCookie },
    });
    const meBody = JSON.parse(me.body) as { data: { user: { id: string } } };
    const userId = meBody.data.user.id;
    const payload = {
      batchId: "event-seed-batch-1",
      marketIds: ["activity-market"],
      userIds: [userId],
      betsPerEventMin: 3,
      betsPerEventMax: 3,
      betAmountMin: 5,
      betAmountMax: 5,
      depositAmountMin: 20,
      depositAmountMax: 20,
      depositBufferMultiplier: 1.35,
      startAt: "2026-05-20T00:00:00.000Z",
      endAt: "2026-05-20T01:00:00.000Z",
      publicActivity: true,
      force: true,
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/markets/seed-event-activity",
      headers: { cookie: adminCookie },
      payload,
    });
    const body = JSON.parse(response.body) as {
      data: {
        batchId: string;
        depositsCreated: number;
        tradesCreated: number;
        summary: { eventsProcessed: number; plannedTrades: number; skipped: number; errors: number };
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.batchId, "event-seed-batch-1");
    assert.equal(body.data.summary.eventsProcessed, 1);
    assert.equal(body.data.summary.plannedTrades, 3);
    assert.equal(body.data.depositsCreated, 1);
    assert.equal(body.data.tradesCreated, 3);
    assert.equal(body.data.summary.errors, 0);

    const ledger = await app.inject({
      method: "GET",
      url: "/api/ledger/entries?limit=10",
      headers: { cookie: userCookie },
    });
    const ledgerBody = JSON.parse(ledger.body) as {
      data: { entries: Array<{ entryType: string; reason: string; metadata: Record<string, unknown> }> };
    };
    assert.equal(
      ledgerBody.data.entries.some((entry) => entry.reason === "admin_seed_deposit"),
      true,
    );
    assert.equal(
      ledgerBody.data.entries.filter((entry) => entry.entryType === "trade_debit").length,
      3,
    );
    assert.equal(
      ledgerBody.data.entries.every((entry) =>
        entry.reason === "admin_seed_deposit" || entry.metadata.source === "admin_seed"
      ),
      true,
    );

    const deposits = await app.inject({
      method: "GET",
      url: "/api/wallets/deposits",
      headers: { cookie: userCookie },
    });
    const depositBody = JSON.parse(deposits.body) as {
      data: { depositEvents: Array<{ provider: string; status: string; creditedLedgerEntryId: string | null }> };
    };
    assert.equal(depositBody.data.depositEvents[0]?.provider, "admin_seed");
    assert.equal(depositBody.data.depositEvents[0]?.status, "credited");
    assert.ok(depositBody.data.depositEvents[0]?.creditedLedgerEntryId);

    const portfolio = await app.inject({
      method: "GET",
      url: "/api/trading/positions",
      headers: { cookie: userCookie },
    });
    const portfolioBody = JSON.parse(portfolio.body) as {
      data: { positions: unknown[]; trades: unknown[] };
    };
    assert.equal(portfolioBody.data.trades.length, 3);
    assert.equal(portfolioBody.data.positions.length, 1);

    const detail = await app.inject({
      method: "GET",
      url: "/api/markets/activity-market",
    });
    const detailBody = JSON.parse(detail.body) as {
      data: { history: { is_synthetic: boolean; price_history: unknown[] } };
    };
    assert.equal(detailBody.data.history.is_synthetic, false);
    assert.equal(detailBody.data.history.price_history.length >= 99, true);

    const activity = await app.inject({
      method: "GET",
      url: "/api/platform/activity?limit=10",
    });
    const activityBody = JSON.parse(activity.body) as {
      data: { activity: Array<{ type: string; marketTitle: string | null }> };
    };
    assert.equal(activityBody.data.activity.some((item) => item.type === "trade"), true);
    assert.equal(activityBody.data.activity.some((item) => item.type === "deposit"), true);

    const replay = await app.inject({
      method: "POST",
      url: "/api/admin/markets/seed-event-activity",
      headers: { cookie: adminCookie },
      payload: { ...payload, force: false },
    });
    const replayBody = JSON.parse(replay.body) as {
      data: { depositsCreated: number; tradesCreated: number; summary: { errors: number } };
    };

    assert.equal(replay.statusCode, 200);
    assert.equal(replayBody.data.depositsCreated, 0);
    assert.equal(replayBody.data.tradesCreated, 0);
    assert.equal(replayBody.data.summary.errors, 0);
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("admin odds override validates outcome totals", async () => {
  const restoreFetch = installMarketFetch({
    "override-market": marketFixture({ id: "override-market" }),
  });
  const app = buildApp(testConfig());

  try {
    const cookie = await loginAdmin(app);
    const response = await app.inject({
      method: "PATCH",
      url: "/api/admin/markets/override-market/odds",
      headers: { cookie },
      payload: {
        outcomes: [
          { name: "Yes", price: 0.7 },
          { name: "No", price: 0.2 },
        ],
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "INVALID_MARKET_ODDS");
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("admin ledger seed creates deposits, audit log, and public activity", async () => {
  const app = buildApp(testConfig());

  try {
    const adminCookie = await loginAdmin(app);
    const userCookie = await register(app, "ledger-user@example.com");
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: userCookie },
    });
    const meBody = JSON.parse(me.body) as { data: { user: { id: string } } };
    const userId = meBody.data.user.id;

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/ledger/seed-activity",
      headers: { cookie: adminCookie },
      payload: {
        userIds: [userId],
        kind: "deposit",
        amountMin: 10,
        amountMax: 20,
        count: 2,
        startAt: "2026-05-20T00:00:00.000Z",
        endAt: "2026-05-21T00:00:00.000Z",
        publicActivity: true,
      },
    });
    const body = JSON.parse(response.body) as {
      data: { summary: { created: number }; created: Array<{ ledgerEntry: { reason: string } }> };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.summary.created, 2);
    assert.equal(body.data.created[0]?.ledgerEntry.reason, "admin_seed_deposit");

    const deposits = await app.inject({
      method: "GET",
      url: "/api/wallets/deposits",
      headers: { cookie: userCookie },
    });
    const depositBody = JSON.parse(deposits.body) as {
      data: { depositEvents: Array<{ status: string; provider: string; creditedLedgerEntryId: string | null }> };
    };
    assert.equal(depositBody.data.depositEvents.length, 2);
    assert.equal(depositBody.data.depositEvents[0]?.status, "credited");
    assert.equal(depositBody.data.depositEvents[0]?.provider, "admin_seed");
    assert.ok(depositBody.data.depositEvents[0]?.creditedLedgerEntryId);

    const activity = await app.inject({
      method: "GET",
      url: "/api/platform/activity?limit=5",
    });
    const activityBody = JSON.parse(activity.body) as {
      data: { activity: Array<{ type: string; amount: number; displayName: string }> };
    };
    assert.equal(activity.statusCode, 200);
    assert.equal(activityBody.data.activity[0]?.type, "deposit");
    assert.match(activityBody.data.activity[0]?.displayName ?? "", /\*\*\*/);

    const audit = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs",
      headers: { cookie: adminCookie },
    });
    const auditBody = JSON.parse(audit.body) as {
      data: { auditLogs: Array<{ eventType: string }> };
    };
    assert.equal(
      auditBody.data.auditLogs.some((event) => event.eventType === "admin.ledger_seed_activity"),
      true,
    );
  } finally {
    await app.close();
  }
});
