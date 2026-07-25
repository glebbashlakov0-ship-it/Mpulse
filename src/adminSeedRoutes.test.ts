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

test("legacy money seed endpoints remain retired after the Coin cutover", async () => {
  const app = buildApp(testConfig());

  try {
    const adminCookie = await loginAdmin(app);
    for (const url of [
      "/api/admin/markets/seed-event-activity",
      "/api/admin/ledger/seed-activity",
    ]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { cookie: adminCookie },
        payload: {},
      });
      assert.equal(response.statusCode, 410);
    }
  } finally {
    await app.close();
  }
});
