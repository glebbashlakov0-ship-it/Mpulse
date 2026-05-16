import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./server.js";
import { marketFixture, testConfig } from "./testUtils.js";

function getSetCookie(response: {
  headers: Record<string, string | number | string[] | undefined>;
}) {
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header[0] : String(header ?? "");
}

function getCookieHeader(response: {
  headers: Record<string, string | number | string[] | undefined>;
}) {
  const setCookie = getSetCookie(response);
  assert.ok(setCookie.length > 0);
  return setCookie.split(";")[0];
}

test("buildApp fails fast instead of using memory fallback in production without DATABASE_URL", () => {
  assert.throws(
    () =>
      buildApp(
        testConfig({
          nodeEnv: "production",
          databaseUrl: null,
          sessionCookieSecure: true,
          corsAllowedOrigins: ["https://market.example"],
          walletDepositWebhookSecret: "prod-webhook-secret-32-characters-long",
        }),
      ),
    /DATABASE_URL is required in production/,
  );
});

test("DATABASE_URL mode rejects guest portfolio state instead of falling back to memory", async () => {
  const app = buildApp(
    testConfig({
      databaseUrl: "postgres://market:market@127.0.0.1:65432/market_pulse_test",
    }),
  );

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/portfolio",
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 401);
    assert.equal(body.error.code, "UNAUTHENTICATED");
  } finally {
    await app.close();
  }
});

test("GET /api/markets returns normalized data and meta without raw upstream shape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/public-search") {
      return Response.json({ events: [] });
    }

    return Response.json([
      marketFixture({
        id: "bitcoin",
        question: "Will Bitcoin be above $100k?",
        category: "Crypto",
      }),
    ]);
  };

  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets?limit=5&active=true&closed=false&search=bitcoin",
    });
    const body = JSON.parse(response.body) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.id, "bitcoin");
    assert.equal(body.data[0]?.title, "Will Bitcoin be above $100k?");
    assert.equal(body.data[0]?.question, undefined);
    assert.equal(body.data[0]?.category, "crypto");
    assert.deepEqual(body.data[0]?.topics, ["crypto"]);
    assert.equal(body.data[0]?.status, "live");
    assert.equal(typeof body.data[0]?.image, "string");
    assert.equal(body.meta.limit, 5);
    assert.equal(body.meta.sourceStatus, "fresh");
    assert.equal(body.meta.isStale, false);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/markets filters by topic on the backend", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json([
      marketFixture({
        id: "crypto",
        question: "Will Bitcoin be above $100k?",
        category: "Crypto",
      }),
      marketFixture({
        id: "finance-with-crypto-topic",
        question: "Will the Fed mention Bitcoin?",
        category: "Finance",
      }),
      marketFixture({
        id: "sports",
        question: "Will the NBA finals go to game 7?",
        description: "A basketball market.",
        category: "Sports",
      }),
    ]);
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets?topic=crypto&sort=volume",
    });
    const body = JSON.parse(response.body) as {
      data: Array<{ id: string }>;
      meta: { total: number };
    };

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      body.data.map((market) => market.id),
      ["crypto"],
    );
    assert.equal(body.meta.total, 1);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/markets keeps esports topic strict", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/events" || url.pathname === "/public-search") {
      return Response.json(url.pathname === "/events" ? [] : { events: [] });
    }

    return Response.json([
      marketFixture({
        id: "apple-tech",
        question: "Will Apple release a new product line before 2027?",
        description: "Apple may release a gaming device or another technology product line.",
        category: undefined,
      }),
      marketFixture({
        id: "valorant",
        question: "Will the Valorant final go five maps?",
        category: undefined,
      }),
    ]);
  };
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets?topic=esports",
    });
    const body = JSON.parse(response.body) as {
      data: Array<{ id: string; category: string }>;
      meta: { total: number };
    };

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      body.data.map((market) => market.id),
      ["valorant"],
    );
    assert.equal(body.data[0]?.category, "esports");
    assert.equal(body.meta.total, 1);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/markets topic=esports returns sports-category esports topics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/events" || url.pathname === "/markets") {
      return Response.json([]);
    }

    if (url.pathname === "/public-search") {
      return Response.json({
        events: [
          {
            id: "dota-event",
            slug: "dota-event",
            title: "Dota 2 tournament",
            category: "Sports",
            active: true,
            closed: false,
            archived: false,
            restricted: false,
            volume: 250000,
            volume24hr: 50000,
            liquidity: 15000,
            tags: [{ slug: "esports", label: "Esports" }],
            markets: [
              marketFixture({
                id: "dota-final",
                question: "Will Team Spirit win the Dota 2 final?",
                category: "Sports",
                volumeNum: 250000,
              }),
            ],
          },
          {
            id: "apple-event",
            slug: "apple-event",
            title: "Apple product line",
            category: "Tech",
            active: true,
            closed: false,
            archived: false,
            restricted: false,
            volume: 500000,
            volume24hr: 10000,
            liquidity: 5000,
            tags: [],
            markets: [
              marketFixture({
                id: "apple-tech",
                question: "Will Apple release a new product line before 2027?",
                description: "Apple may release a gaming device or another technology product line.",
                category: undefined,
                volumeNum: 500000,
              }),
            ],
          },
        ],
      });
    }

    return Response.json([]);
  };
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets?topic=esports",
    });
    const body = JSON.parse(response.body) as {
      data: Array<{ id: string; category: string; topics: string[] }>;
      meta: { total: number };
    };

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      body.data.map((market) => market.id),
      ["dota-final"],
    );
    assert.equal(body.data[0]?.category, "sports");
    assert.equal(body.data[0]?.topics.includes("esports"), true);
    assert.equal(body.meta.total, 1);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/markets treats topic=all as no-op", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json([
      marketFixture({ id: "crypto", category: "Crypto" }),
      marketFixture({
        id: "sports",
        question: "Will the NBA finals go to game 7?",
        description: "A basketball market.",
        category: "Sports",
      }),
    ]);
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets?topic=all",
    });
    const body = JSON.parse(response.body) as { meta: { total: number } };

    assert.equal(response.statusCode, 200);
    assert.equal(body.meta.total, 2);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/markets search uses market-specific event titles", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/events" || url.pathname === "/markets") {
      return Response.json([]);
    }

    if (url.pathname === "/public-search") {
      return Response.json({
        events: [
          {
            id: "bitcoin-range-event",
            title: "When will Bitcoin hit $150k?",
            tags: [{ slug: "crypto", label: "Crypto" }],
            markets: [
              marketFixture({
                id: "bitcoin-sept",
                question: "Will Bitcoin hit $150k by September 30?",
                category: undefined,
              }),
              marketFixture({
                id: "bitcoin-dec",
                question: "Will Bitcoin hit $150k by December 31?",
                category: undefined,
              }),
            ],
          },
        ],
      });
    }

    return Response.json([]);
  };
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets?search=bitcoin&sort=relevance",
    });
    const body = JSON.parse(response.body) as {
      data: Array<{ title: string }>;
    };

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      body.data.map((market) => market.title),
      ["Will Bitcoin hit $150k by September 30?", "Will Bitcoin hit $150k by December 31?"],
    );
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/markets returns diverse event-backed discovery", async () => {
  const originalFetch = globalThis.fetch;
  const events = [
    {
      id: "politics-series",
      title: "Republican Presidential Nominee 2028",
      active: true,
      closed: false,
      volume24hr: 100000,
      tags: [{ slug: "politics", label: "Politics" }],
      markets: Array.from({ length: 5 }).map((_, index) =>
        marketFixture({
          id: `politics-${index}`,
          question: `Will Candidate ${index} win 2028?`,
          category: undefined,
          volumeNum: 900000 - index,
          volume24hr: 90000 - index,
        }),
      ),
    },
    {
      id: "sports-event",
      title: "Sports finals",
      active: true,
      closed: false,
      volume24hr: 80000,
      tags: [{ slug: "sports", label: "Sports" }],
      markets: [
        marketFixture({ id: "sports", question: "Will the NBA finals go seven games?", category: undefined }),
        marketFixture({ id: "sports-2", question: "Will the NBA finals end in six?", category: undefined }),
      ],
    },
    {
      id: "crypto-event",
      title: "Bitcoin daily markets",
      active: true,
      closed: false,
      volume24hr: 70000,
      tags: [{ slug: "crypto", label: "Crypto" }],
      markets: [
        marketFixture({ id: "crypto", question: "Will Bitcoin hit $150k?", category: undefined }),
        marketFixture({ id: "crypto-2", question: "Will Bitcoin hit $200k?", category: undefined }),
      ],
    },
    {
      id: "finance-event",
      title: "Fed decision",
      active: true,
      closed: false,
      volume24hr: 60000,
      tags: [{ slug: "fed", label: "Fed" }],
      markets: [
        marketFixture({ id: "finance", question: "Will the Fed cut rates?", category: undefined }),
        marketFixture({ id: "finance-2", question: "Will the Fed hold rates?", category: undefined }),
      ],
    },
  ];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/events") {
      return Response.json(events);
    }
    if (url.pathname === "/public-search") {
      return Response.json({ events: [] });
    }
    return Response.json([]);
  };
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets?limit=6&sort=trending&status=live",
    });
    const body = JSON.parse(response.body) as {
      data: Array<{ id: string; title: string; topics: string[]; question?: string }>;
    };
    const repeatedSeriesCount = body.data.filter((market) =>
      market.title.startsWith("Will Candidate"),
    ).length;
    const questionCardCount = body.data.filter((market) => /^will\b/i.test(market.title)).length;
    const topics = new Set(body.data.flatMap((market) => market.topics));

    assert.equal(response.statusCode, 200);
    assert.equal(repeatedSeriesCount, 0);
    assert.equal(questionCardCount <= 2, true);
    assert.equal(body.data[0]?.title, "Republican Presidential Nominee 2028");
    assert.equal(topics.has("sports"), true);
    assert.equal(topics.has("crypto"), true);
    assert.equal(topics.has("finance"), true);
    assert.equal(body.data.some((market) => market.question !== undefined), false);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/markets/:id returns detail shape with prices, related markets, and history", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname.startsWith("/markets/")) {
      return Response.json(marketFixture({ id: "detail" }));
    }

    return Response.json([
      marketFixture({ id: "detail" }),
      marketFixture({
        id: "related",
        question: "Will Bitcoin ETFs see inflows?",
        category: "Crypto",
      }),
    ]);
  };

  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets/detail",
    });
    const body = JSON.parse(response.body) as {
      data: Record<string, unknown>;
      meta: Record<string, unknown>;
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.id, "detail");
    assert.ok(body.data.prices);
    assert.ok(body.data.dates);
    assert.ok(body.data.history);
    assert.equal(Array.isArray(body.data.related_markets), true);
    assert.equal(body.meta.sourceStatus, "fresh");
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/markets/:id/snapshots/collect stores real history for detail", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname.startsWith("/markets/snapshot-detail")) {
      return Response.json(
        marketFixture({
          id: "snapshot-detail",
          outcomePrices: JSON.stringify(["0.66", "0.34"]),
          volumeNum: 250000,
          liquidityNum: 60000,
        }),
      );
    }

    return Response.json([]);
  };
  const app = buildApp(testConfig());

  try {
    const collect = await app.inject({
      method: "POST",
      url: "/api/markets/snapshot-detail/snapshots/collect",
    });
    const detail = await app.inject({
      method: "GET",
      url: "/api/markets/snapshot-detail",
    });
    const body = JSON.parse(detail.body) as {
      data: {
        history: {
          is_synthetic: boolean;
          snapshots: Array<{ id: string }>;
          price_history: Array<{ yes: number | null }>;
        };
      };
    };

    assert.equal(collect.statusCode, 200);
    assert.equal(detail.statusCode, 200);
    assert.equal(body.data.history.is_synthetic, false);
    assert.equal(body.data.history.snapshots.length, 1);
    assert.equal(body.data.history.price_history[0]?.yes, 0.66);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/markets rejects invalid query with a controlled error", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets?sort=unknown",
    });
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "INVALID_QUERY");
    assert.match(body.error.message, /sort/);
  } finally {
    await app.close();
  }
});

test("GET /api/markets rejects malformed numeric filters with a controlled error", async () => {
  const app = buildApp(testConfig());
  const cases = [
    ["limit", "/api/markets?limit=abc"],
    ["offset", "/api/markets?offset=abc"],
    ["min_volume", "/api/markets?min_volume=abc"],
    ["max_volume", "/api/markets?max_volume=abc"],
  ] as const;

  try {
    for (const [field, url] of cases) {
      const response = await app.inject({
        method: "GET",
        url,
      });
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };

      assert.equal(response.statusCode, 400);
      assert.equal(body.error.code, "INVALID_QUERY");
      assert.match(body.error.message, new RegExp(field));
    }
  } finally {
    await app.close();
  }
});

test("GET /api/markets/:id returns controlled upstream unavailable error without cache", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("upstream down", { status: 503 });
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets/missing-cache",
    });
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };

    assert.equal(response.statusCode, 503);
    assert.equal(body.error.code, "UPSTREAM_UNAVAILABLE");
    assert.match(body.error.message, /no stale cache/i);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/markets returns controlled upstream unavailable error without stale cache", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("upstream down", { status: 503 });
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/markets?limit=5",
    });
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };

    assert.equal(response.statusCode, 503);
    assert.equal(body.error.code, "UPSTREAM_UNAVAILABLE");
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/health returns a simple non-secret health payload", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });
    const body = JSON.parse(response.body) as {
      data: { ok: boolean; service: string; mode: string; database: string; sessionSecret?: string };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.ok, true);
    assert.equal(body.data.service, "arabic-prediction-market-api");
    assert.equal(body.data.mode, "local");
    assert.equal(body.data.database, "disabled");
    assert.equal(body.data.sessionSecret, undefined);
  } finally {
    await app.close();
  }
});

test("GET /api/ready reports DB/config/market readiness without exposing secrets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json([
      marketFixture({
        id: "ready-market",
        question: "Will readiness checks see market data?",
      }),
    ]);
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/ready",
    });
    const body = JSON.parse(response.body) as {
      data: {
        ok: boolean;
        mode: string;
        checks: Record<string, { status: string; message?: string }>;
        walletDepositWebhookSecret?: string;
      };
    };

    assert.equal(response.statusCode, 503);
    assert.equal(body.data.ok, false);
    assert.equal(body.data.mode, "local");
    assert.equal(body.data.checks.database.status, "failed");
    assert.equal(body.data.checks.marketData.status, "ok");
    assert.equal(body.data.checks.configuration.status, "ok");
    assert.equal(body.data.walletDepositWebhookSecret, undefined);
    assert.doesNotMatch(response.body, /test-local-webhook-secret/);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/ready fails configuration when webhook secret is missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([marketFixture({ id: "ready-market" })]);
  const app = buildApp(testConfig({ walletDepositWebhookSecret: null }));

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/ready",
    });
    const body = JSON.parse(response.body) as {
      data: { checks: Record<string, { status: string; message?: string }> };
    };

    assert.equal(response.statusCode, 503);
    assert.equal(body.data.checks.configuration.status, "failed");
    assert.match(body.data.checks.configuration.message ?? "", /WALLET_DEPOSIT_WEBHOOK_SECRET/);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/auth/register creates a user and HttpOnly session", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "new@example.com",
        password: "password123",
        displayName: "New Trader",
      },
    });
    const body = JSON.parse(response.body) as {
      data: { user: { email: string; displayName: string; passwordHash?: string } };
    };
    const setCookie = getSetCookie(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.user.email, "new@example.com");
    assert.equal(body.data.user.displayName, "New Trader");
    assert.equal(body.data.user.passwordHash, undefined);
    assert.match(setCookie ?? "", /HttpOnly/);
    assert.match(setCookie ?? "", /SameSite=Lax/);
  } finally {
    await app.close();
  }
});

test("state-changing auth routes require a valid CSRF token when protection is enabled", async () => {
  const app = buildApp(testConfig({ csrfProtectionEnabled: true }));

  try {
    const blocked = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "csrf-blocked@example.com",
        password: "password12345",
        displayName: "CSRF Blocked",
      },
    });
    const blockedBody = JSON.parse(blocked.body) as { error: { code: string } };

    assert.equal(blocked.statusCode, 403);
    assert.equal(blockedBody.error.code, "CSRF_TOKEN_INVALID");

    const csrf = await app.inject({
      method: "GET",
      url: "/api/auth/csrf",
    });
    const csrfBody = JSON.parse(csrf.body) as { data: { csrfToken: string } };
    const cookie = getCookieHeader(csrf);
    const allowed = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: {
        cookie,
        "x-csrf-token": csrfBody.data.csrfToken,
      },
      payload: {
        email: "csrf-allowed@example.com",
        password: "password12345",
        displayName: "CSRF Allowed",
      },
    });

    assert.equal(allowed.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("state-changing auth routes reject mismatched CSRF tokens", async () => {
  const app = buildApp(testConfig({ csrfProtectionEnabled: true }));

  try {
    const csrf = await app.inject({
      method: "GET",
      url: "/api/auth/csrf",
    });
    const cookie = getCookieHeader(csrf);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: {
        cookie,
        "x-csrf-token": "not-the-cookie-token",
      },
      payload: {
        email: "csrf-mismatch@example.com",
        password: "password12345",
        displayName: "CSRF Mismatch",
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 403);
    assert.equal(body.error.code, "CSRF_TOKEN_INVALID");
  } finally {
    await app.close();
  }
});

test("POST /api/auth/register rejects duplicate email", async () => {
  const app = buildApp(testConfig());

  try {
    const payload = {
      email: "duplicate@example.com",
      password: "password123",
    };
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload,
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload,
    });
    const body = JSON.parse(secondResponse.body) as { error: { code: string } };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 409);
    assert.equal(body.error.code, "EMAIL_ALREADY_REGISTERED");
  } finally {
    await app.close();
  }
});

test("POST /api/auth/register rate limits by IP and endpoint", async () => {
  const app = buildApp(testConfig({ authRateLimitMax: 2, authRateLimitWindowMs: 60_000 }));

  try {
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "rate-register-1@example.com",
        password: "password123",
      },
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "rate-register-2@example.com",
        password: "password123",
      },
    });
    const thirdResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "rate-register-3@example.com",
        password: "password123",
      },
    });
    const body = JSON.parse(thirdResponse.body) as { error: { code: string; message: string } };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(thirdResponse.statusCode, 429);
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.equal(body.error.message, "Too many attempts. Try again later.");
  } finally {
    await app.close();
  }
});

test("POST /api/auth/login creates a session for valid credentials", async () => {
  const app = buildApp(testConfig());

  try {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "login@example.com",
        password: "password123",
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "LOGIN@example.com",
        password: "password123",
      },
    });
    const body = JSON.parse(response.body) as { data: { user: { email: string } } };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.user.email, "login@example.com");
    assert.match(getSetCookie(response) ?? "", /mp_session=/);
  } finally {
    await app.close();
  }
});

test("POST /api/auth/login rejects invalid password", async () => {
  const app = buildApp(testConfig());

  try {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "invalid-password@example.com",
        password: "password123",
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "invalid-password@example.com",
        password: "wrongpassword123",
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 401);
    assert.equal(body.error.code, "INVALID_CREDENTIALS");
  } finally {
    await app.close();
  }
});

test("POST /api/auth/login rate limits by IP, endpoint, and email", async () => {
  const app = buildApp(testConfig({ authRateLimitMax: 2, authRateLimitWindowMs: 60_000 }));

  try {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "rate-login@example.com",
        password: "password123",
      },
    });

    const payload = {
      email: "rate-login@example.com",
      password: "wrongpassword123",
    };
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload,
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload,
    });
    const thirdResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload,
    });
    const body = JSON.parse(thirdResponse.body) as { error: { code: string; message: string } };

    assert.equal(firstResponse.statusCode, 401);
    assert.equal(secondResponse.statusCode, 401);
    assert.equal(thirdResponse.statusCode, 429);
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.equal(body.error.message, "Too many attempts. Try again later.");
  } finally {
    await app.close();
  }
});

test("POST /api/auth/login allows a normal request before the limit", async () => {
  const app = buildApp(testConfig({ authRateLimitMax: 1, authRateLimitWindowMs: 60_000 }));

  try {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "rate-login-success@example.com",
        password: "password123",
      },
    });

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "rate-login-success@example.com",
        password: "password123",
      },
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "rate-login-success@example.com",
        password: "password123",
      },
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 429);
  } finally {
    await app.close();
  }
});

test("GET /api/auth/me rejects requests without a session", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 401);
    assert.equal(body.error.code, "UNAUTHENTICATED");
  } finally {
    await app.close();
  }
});

test("GET /api/auth/me returns the current user with a session", async () => {
  const app = buildApp(testConfig());

  try {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "me@example.com",
        password: "password123",
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: getCookieHeader(registerResponse),
      },
    });
    const body = JSON.parse(response.body) as { data: { user: { email: string } } };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.user.email, "me@example.com");
  } finally {
    await app.close();
  }
});

test("admin endpoints return 403 for an authenticated non-admin user", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "plain-user@example.com");
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 403);
    assert.equal(body.error.code, "ADMIN_FORBIDDEN");
  } finally {
    await app.close();
  }
});

test("admin core lets configured admins list users", async () => {
  const app = buildApp(testConfig({ adminEmails: ["admin@example.com"] }));

  try {
    const adminCookie = await registerForTrading(app, "admin@example.com");
    await registerForTrading(app, "listed-user@example.com");
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: adminCookie },
    });
    const body = JSON.parse(response.body) as {
      data: {
        users: Array<{ email: string; role: string }>;
        summary: Record<string, number>;
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.users.some((user) => user.email === "admin@example.com"), true);
    assert.equal(
      body.data.users.find((user) => user.email === "admin@example.com")?.role,
      "super_admin",
    );
    assert.equal(body.data.summary.super_admin, 1);
  } finally {
    await app.close();
  }
});

test("admin role matrix gates support, compliance, and finance actions", async () => {
  const app = buildApp(
    testConfig({
      supportEmails: ["support@example.com"],
      complianceAdminEmails: ["compliance-role@example.com"],
      financeAdminEmails: ["finance-role@example.com"],
    }),
  );

  try {
    const supportCookie = await registerForTrading(app, "support@example.com");
    const complianceCookie = await registerForTrading(app, "compliance-role@example.com");
    const financeCookie = await registerForTrading(app, "finance-role@example.com");

    const supportUsers = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: supportCookie },
    });
    const supportUsersBody = JSON.parse(supportUsers.body) as {
      data: { users: Array<{ email: string; role: string }> };
    };

    assert.equal(supportUsers.statusCode, 200);
    assert.equal(
      supportUsersBody.data.users.find((user) => user.email === "support@example.com")?.role,
      "support",
    );

    const supportWithdrawals = await app.inject({
      method: "GET",
      url: "/api/admin/wallet-withdrawals",
      headers: { cookie: supportCookie },
    });
    assert.equal(supportWithdrawals.statusCode, 403);

    const financeWithdrawals = await app.inject({
      method: "GET",
      url: "/api/admin/wallet-withdrawals",
      headers: { cookie: financeCookie },
    });
    assert.equal(financeWithdrawals.statusCode, 200);

    const financeHide = await app.inject({
      method: "POST",
      url: "/api/admin/markets/matrix-market/hide",
      headers: { cookie: financeCookie },
      payload: { reason: "manual_review" },
    });
    assert.equal(financeHide.statusCode, 403);

    const complianceHide = await app.inject({
      method: "POST",
      url: "/api/admin/markets/matrix-market/hide",
      headers: { cookie: complianceCookie },
      payload: { reason: "manual_review" },
    });
    assert.equal(complianceHide.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("POST /api/auth/logout clears the session cookie", async () => {
  const app = buildApp(testConfig());

  try {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "logout@example.com",
        password: "password123",
      },
    });
    const cookie = getCookieHeader(registerResponse);
    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie,
      },
    });
    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie,
      },
    });

    assert.equal(logoutResponse.statusCode, 200);
    assert.match(getSetCookie(logoutResponse) ?? "", /Max-Age=0/);
    assert.equal(meResponse.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("compliance endpoints require authentication", async () => {
  const app = buildApp(testConfig());

  try {
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/compliance/me" }),
      app.inject({
        method: "PATCH",
        url: "/api/compliance/me",
        payload: { countryCode: "US" },
      }),
      app.inject({
        method: "POST",
        url: "/api/compliance/accept-terms",
        payload: {
          termsVersion: "terms-2026.04",
          privacyVersion: "privacy-2026.04",
          riskDisclosureVersion: "risk-2026.04",
        },
      }),
      app.inject({ method: "GET", url: "/api/compliance/eligibility" }),
    ]);

    for (const response of responses) {
      const body = JSON.parse(response.body) as { error: { code: string } };

      assert.equal(response.statusCode, 401);
      assert.equal(body.error.code, "UNAUTHENTICATED");
    }
  } finally {
    await app.close();
  }
});

test("PATCH /api/compliance/me updates the authenticated user's self-declared profile", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "compliance-profile@example.com");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/compliance/me",
      headers: { cookie },
      payload: {
        countryCode: "us",
        dateOfBirth: "1990-04-28",
      },
    });
    const body = JSON.parse(response.body) as {
      data: {
        profile: {
          countryCode: string;
          dateOfBirth: string;
          kycStatus: string;
          amlStatus: string;
          riskLevel: string;
          verificationProvider: string;
        };
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.profile.countryCode, "US");
    assert.equal(body.data.profile.dateOfBirth, "1990-04-28");
    assert.equal(body.data.profile.kycStatus, "not_started");
    assert.equal(body.data.profile.amlStatus, "clear");
    assert.equal(body.data.profile.riskLevel, "low");
    assert.equal(body.data.profile.verificationProvider, "self_declared");
  } finally {
    await app.close();
  }
});

test("PATCH /api/compliance/me rejects frontend KYC approval and junk fields", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "compliance-junk@example.com");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/compliance/me",
      headers: { cookie },
      payload: {
        countryCode: "US",
        dateOfBirth: "1990-04-28",
        kycStatus: "approved",
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "INVALID_COMPLIANCE_PROFILE");
    assert.equal(body.error.message, "Unsupported field: kycStatus.");
  } finally {
    await app.close();
  }
});

test("POST /api/compliance/accept-terms records legal consent versions", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "compliance-terms@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/compliance/accept-terms",
      headers: { cookie },
      payload: {
        termsVersion: "terms-2026.04",
        privacyVersion: "privacy-2026.04",
        riskDisclosureVersion: "risk-2026.04",
      },
    });
    const body = JSON.parse(response.body) as {
      data: {
        legalConsents: Array<{ consentType: string; version: string }>;
        acceptedVersions: Record<string, string>;
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.legalConsents.length, 3);
    assert.equal(body.data.acceptedVersions.terms, "terms-2026.04");
    assert.equal(body.data.acceptedVersions.privacy, "privacy-2026.04");
    assert.equal(body.data.acceptedVersions.risk_disclosure, "risk-2026.04");
  } finally {
    await app.close();
  }
});

test("GET /api/compliance/eligibility blocks trading eligibility for a new user without compliance data", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "compliance-new-user@example.com");
    const response = await app.inject({
      method: "GET",
      url: "/api/compliance/eligibility",
      headers: { cookie },
    });
    const body = JSON.parse(response.body) as {
      data: {
        canTradeMock: boolean;
        canTradeLocal: boolean;
        canUseRealMoney: boolean;
        reasons: string[];
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.canTradeMock, false);
    assert.equal(body.data.canTradeLocal, false);
    assert.equal(body.data.canUseRealMoney, false);
    assert.ok(body.data.reasons.includes("DATE_OF_BIRTH_REQUIRED_FOR_COMPLIANCE"));
    assert.ok(body.data.reasons.includes("COUNTRY_REQUIRED_FOR_COMPLIANCE"));
    assert.ok(body.data.reasons.includes("LEGAL_CONSENTS_REQUIRED"));
    assert.ok(body.data.reasons.includes("TRANSFERS_UNAVAILABLE"));
  } finally {
    await app.close();
  }
});

test("GET /api/compliance/eligibility returns age and country reasons", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "compliance-eligibility@example.com");
    await app.inject({
      method: "PATCH",
      url: "/api/compliance/me",
      headers: { cookie },
      payload: {
        countryCode: "IR",
        dateOfBirth: "2010-01-01",
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/compliance/eligibility",
      headers: { cookie },
    });
    const body = JSON.parse(response.body) as {
      data: {
        canTradeMock: boolean;
        canTradeLocal: boolean;
        canUseRealMoney: boolean;
        reasons: string[];
        complianceMode: string;
        verificationProvider: string;
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.canTradeMock, false);
    assert.equal(body.data.canTradeLocal, false);
    assert.equal(body.data.canUseRealMoney, false);
    assert.equal(body.data.complianceMode, "trading_restricted");
    assert.equal(body.data.verificationProvider, "self_declared");
    assert.ok(body.data.reasons.includes("AGE_UNDER_18"));
    assert.ok(body.data.reasons.includes("BLOCKED_COUNTRY"));
    assert.ok(body.data.reasons.includes("TRANSFERS_UNAVAILABLE"));
  } finally {
    await app.close();
  }
});

function installTradingFetchStub(overrides = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname.startsWith("/markets/")) {
      return Response.json(marketFixture({ id: "trade-market", ...overrides }));
    }

    return Response.json([marketFixture({ id: "related-market" })]);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function registerForTrading(app: ReturnType<typeof buildApp>, email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "password123",
      displayName: "Trading Tester",
    },
  });

  assert.equal(response.statusCode, 200);
  return getCookieHeader(response);
}

test("POST /api/trading/quote returns a backend quote without mutating portfolio", async () => {
  const restoreFetch = installTradingFetchStub();
  const app = buildApp(testConfig());

  try {
    await app.inject({
      method: "POST",
      url: "/api/portfolio/reset",
    });
    const quoteResponse = await app.inject({
      method: "POST",
      url: "/api/trading/quote",
      payload: {
        marketId: "trade-market",
        side: "yes",
        action: "buy",
        amount: 61,
      },
    });
    const portfolioResponse = await app.inject({
      method: "GET",
      url: "/api/trading/positions",
    });
    const quoteBody = JSON.parse(quoteResponse.body) as {
      data: { price: number; shares: number; estimatedCost: number };
    };
    const portfolioBody = JSON.parse(portfolioResponse.body) as {
      data: { wallet: { balance: number }; trades: unknown[] };
    };

    assert.equal(quoteResponse.statusCode, 200);
    assert.equal(quoteBody.data.price, 0.61);
    assert.equal(quoteBody.data.shares, 100);
    assert.equal(quoteBody.data.estimatedCost, 61);
    assert.equal(portfolioBody.data.wallet.balance, 10000);
    assert.equal(portfolioBody.data.trades.length, 0);
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("POST /api/trading/orders buys shares and updates backend portfolio", async () => {
  const restoreFetch = installTradingFetchStub();
  const app = buildApp(testConfig());

  try {
    await app.inject({
      method: "POST",
      url: "/api/portfolio/reset",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/trading/orders",
      payload: {
        marketId: "trade-market",
        side: "yes",
        action: "buy",
        amount: 61,
      },
    });
    const body = JSON.parse(response.body) as {
      data: {
        trade: { action: string; shares: number };
        portfolio: {
          wallet: { balance: number };
          positions: Array<{ yesShares: number; totalCost: number }>;
          trades: unknown[];
        };
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.trade.action, "buy");
    assert.equal(body.data.trade.shares, 100);
    assert.equal(body.data.portfolio.wallet.balance, 9939);
    assert.equal(body.data.portfolio.positions[0]?.yesShares, 100);
    assert.equal(body.data.portfolio.positions[0]?.totalCost, 61);
    assert.equal(body.data.portfolio.trades.length, 1);
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("POST /api/trading/orders rejects buys with insufficient balance", async () => {
  const restoreFetch = installTradingFetchStub();
  const app = buildApp(testConfig());

  try {
    await app.inject({
      method: "POST",
      url: "/api/portfolio/reset",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/trading/orders",
      payload: {
        marketId: "trade-market",
        side: "yes",
        action: "buy",
        amount: 10001,
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "INSUFFICIENT_BALANCE");
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("POST /api/trading/orders sells shares and reduces the position", async () => {
  const restoreFetch = installTradingFetchStub();
  const app = buildApp(testConfig());

  try {
    await app.inject({
      method: "POST",
      url: "/api/portfolio/reset",
    });
    await app.inject({
      method: "POST",
      url: "/api/trading/orders",
      payload: {
        marketId: "trade-market",
        side: "yes",
        action: "buy",
        amount: 61,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/trading/orders",
      payload: {
        marketId: "trade-market",
        side: "yes",
        action: "sell",
        shares: 40,
      },
    });
    const body = JSON.parse(response.body) as {
      data: {
        trade: { action: string; amount: number; realizedPnl: number };
        portfolio: {
          wallet: { balance: number };
          positions: Array<{ yesShares: number; totalCost: number }>;
        };
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.trade.action, "sell");
    assert.equal(body.data.trade.amount, 24.4);
    assert.equal(body.data.trade.realizedPnl, 0);
    assert.equal(body.data.portfolio.wallet.balance, 9963.4);
    assert.equal(body.data.portfolio.positions[0]?.yesShares, 60);
    assert.equal(body.data.portfolio.positions[0]?.totalCost, 36.6);
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("POST /api/trading/orders rejects sells with insufficient shares", async () => {
  const restoreFetch = installTradingFetchStub();
  const app = buildApp(testConfig());

  try {
    await app.inject({
      method: "POST",
      url: "/api/portfolio/reset",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/trading/orders",
      payload: {
        marketId: "trade-market",
        side: "yes",
        action: "sell",
        shares: 1,
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "INSUFFICIENT_SHARES");
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("POST /api/trading/orders idempotency key prevents duplicate buys", async () => {
  const restoreFetch = installTradingFetchStub();
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "idempotent@example.com");
    const order = {
      method: "POST" as const,
      url: "/api/trading/orders",
      headers: {
        cookie,
        "Idempotency-Key": "same-buy-key",
      },
      payload: {
        marketId: "trade-market",
        side: "yes",
        action: "buy",
        amount: 61,
      },
    };
    const firstResponse = await app.inject(order);
    const secondResponse = await app.inject(order);
    const firstBody = JSON.parse(firstResponse.body) as {
      data: { trade: { id: string }; portfolio: { wallet: { balance: number }; trades: unknown[] } };
    };
    const secondBody = JSON.parse(secondResponse.body) as {
      data: {
        idempotent: boolean;
        trade: { id: string };
        portfolio: { wallet: { balance: number }; trades: unknown[] };
      };
    };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(secondBody.data.idempotent, true);
    assert.equal(secondBody.data.trade.id, firstBody.data.trade.id);
    assert.equal(secondBody.data.portfolio.wallet.balance, 9939);
    assert.equal(secondBody.data.portfolio.trades.length, 1);
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("GET /api/trading/trades returns user-scoped trade history", async () => {
  const restoreFetch = installTradingFetchStub();
  const app = buildApp(testConfig());

  try {
    const firstCookie = await registerForTrading(app, "first-trader@example.com");
    const secondCookie = await registerForTrading(app, "second-trader@example.com");

    await app.inject({
      method: "POST",
      url: "/api/trading/orders",
      headers: { cookie: firstCookie },
      payload: {
        marketId: "trade-market",
        side: "yes",
        action: "buy",
        amount: 61,
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/trading/orders",
      headers: { cookie: secondCookie },
      payload: {
        marketId: "trade-market",
        side: "no",
        action: "buy",
        amount: 39,
      },
    });

    const firstHistory = await app.inject({
      method: "GET",
      url: "/api/trading/trades",
      headers: { cookie: firstCookie },
    });
    const secondHistory = await app.inject({
      method: "GET",
      url: "/api/trading/trades",
      headers: { cookie: secondCookie },
    });
    const firstBody = JSON.parse(firstHistory.body) as { data: Array<{ userId: string; side: string }> };
    const secondBody = JSON.parse(secondHistory.body) as { data: Array<{ userId: string; side: string }> };

    assert.equal(firstBody.data.length, 1);
    assert.equal(secondBody.data.length, 1);
    assert.equal(firstBody.data[0]?.side, "yes");
    assert.equal(secondBody.data[0]?.side, "no");
    assert.notEqual(firstBody.data[0]?.userId, secondBody.data[0]?.userId);
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("guest trading flow still works without auth", async () => {
  const restoreFetch = installTradingFetchStub();
  const app = buildApp(testConfig());

  try {
    await app.inject({
      method: "POST",
      url: "/api/portfolio/reset",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/trading/orders",
      payload: {
        marketId: "trade-market",
        side: "yes",
        action: "buy",
        amount: 61,
      },
    });
    const body = JSON.parse(response.body) as {
      data: { portfolio: { user: { id: string }; trades: unknown[] } };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.portfolio.user.id, "local-user");
    assert.equal(body.data.portfolio.trades.length, 1);
  } finally {
    await app.close();
    restoreFetch();
  }
});

test("POST /api/ledger/credits requires authentication", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/ledger/credits",
      headers: {
        "Idempotency-Key": "ledger-guest-credit",
      },
      payload: {
        amount: 25,
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 401);
    assert.equal(body.error.code, "UNAUTHENTICATED");
  } finally {
    await app.close();
  }
});

test("POST /api/ledger/credits credits local ledger balance with idempotency", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "ledger-credit@example.com");
    const request = {
      method: "POST" as const,
      url: "/api/ledger/credits",
      headers: {
        cookie,
        "Idempotency-Key": "ledger-credit-1",
      },
      payload: {
        amount: 125,
      },
    };
    const firstResponse = await app.inject(request);
    const secondResponse = await app.inject(request);
    const balanceResponse = await app.inject({
      method: "GET",
      url: "/api/ledger/balance",
      headers: { cookie },
    });
    const firstBody = JSON.parse(firstResponse.body) as {
      data: {
        complianceMode: string;
        entry: { id: string; entryType: string; reason: string };
        balance: { availableBalance: number };
      };
    };
    const secondBody = JSON.parse(secondResponse.body) as {
      data: { entry: { id: string }; balance: { availableBalance: number }; idempotent: boolean };
    };
    const balanceBody = JSON.parse(balanceResponse.body) as {
      data: { mode: string; balance: { availableBalance: number; totalCredited: number } };
    };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(firstBody.data.complianceMode, "ledger_restricted");
    assert.equal(firstBody.data.entry.entryType, "credit");
    assert.equal(firstBody.data.entry.reason, "ledger_credit_local");
    assert.equal(firstBody.data.balance.availableBalance, 125);
    assert.equal(secondBody.data.idempotent, true);
    assert.equal(secondBody.data.entry.id, firstBody.data.entry.id);
    assert.equal(secondBody.data.balance.availableBalance, 125);
    assert.equal(balanceBody.data.mode, "local_ledger");
    assert.equal(balanceBody.data.balance.availableBalance, 125);
    assert.equal(balanceBody.data.balance.totalCredited, 125);
  } finally {
    await app.close();
  }
});

test("POST /api/ledger/credits rejects same idempotency key with different payload", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "ledger-credit-mismatch@example.com");
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/ledger/credits",
      headers: {
        cookie,
        "Idempotency-Key": "ledger-credit-mismatch",
      },
      payload: {
        amount: 125,
      },
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/ledger/credits",
      headers: {
        cookie,
        "Idempotency-Key": "ledger-credit-mismatch",
      },
      payload: {
        amount: 126,
      },
    });
    const balanceResponse = await app.inject({
      method: "GET",
      url: "/api/ledger/balance",
      headers: { cookie },
    });
    const secondBody = JSON.parse(secondResponse.body) as {
      error: { code: string; message: string };
    };
    const balanceBody = JSON.parse(balanceResponse.body) as {
      data: { balance: { availableBalance: number; totalCredited: number } };
    };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 409);
    assert.equal(secondBody.error.code, "IDEMPOTENCY_KEY_REUSE_MISMATCH");
    assert.match(secondBody.error.message, /different ledger entry/);
    assert.equal(balanceBody.data.balance.availableBalance, 125);
    assert.equal(balanceBody.data.balance.totalCredited, 125);
  } finally {
    await app.close();
  }
});

test("POST /api/ledger/credits rejects missing idempotency key", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "ledger-missing-key@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/ledger/credits",
      headers: { cookie },
      payload: {
        amount: 25,
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
  } finally {
    await app.close();
  }
});

test("GET /api/ledger/entries returns only the authenticated user's local ledger entries", async () => {
  const app = buildApp(testConfig());

  try {
    const firstCookie = await registerForTrading(app, "ledger-first@example.com");
    const secondCookie = await registerForTrading(app, "ledger-second@example.com");

    await app.inject({
      method: "POST",
      url: "/api/ledger/credits",
      headers: {
        cookie: firstCookie,
        "Idempotency-Key": "ledger-first-credit",
      },
      payload: { amount: 50 },
    });
    await app.inject({
      method: "POST",
      url: "/api/ledger/credits",
      headers: {
        cookie: secondCookie,
        "Idempotency-Key": "ledger-second-credit",
      },
      payload: { amount: 30 },
    });

    const firstEntries = await app.inject({
      method: "GET",
      url: "/api/ledger/entries",
      headers: { cookie: firstCookie },
    });
    const secondEntries = await app.inject({
      method: "GET",
      url: "/api/ledger/entries",
      headers: { cookie: secondCookie },
    });
    const firstBody = JSON.parse(firstEntries.body) as {
      data: { entries: Array<{ userId: string; amount: number }> };
    };
    const secondBody = JSON.parse(secondEntries.body) as {
      data: { entries: Array<{ userId: string; amount: number }> };
    };

    assert.equal(firstEntries.statusCode, 200);
    assert.equal(secondEntries.statusCode, 200);
    assert.equal(firstBody.data.entries.length, 1);
    assert.equal(secondBody.data.entries.length, 1);
    assert.equal(firstBody.data.entries[0]?.amount, 50);
    assert.equal(secondBody.data.entries[0]?.amount, 30);
    assert.notEqual(firstBody.data.entries[0]?.userId, secondBody.data.entries[0]?.userId);
  } finally {
    await app.close();
  }
});

const VALID_TRON_ADDRESS = "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK";

test("wallet endpoints require authentication", async () => {
  const app = buildApp(testConfig());

  try {
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/wallets/me" }),
      app.inject({
        method: "POST",
        url: "/api/wallets/deposit-intents",
        payload: { expectedAmount: 25 },
      }),
      app.inject({
        method: "POST",
        url: "/api/wallets/withdrawal-requests",
        headers: { "Idempotency-Key": "wallet-auth-required" },
        payload: {
          destinationAddress: VALID_TRON_ADDRESS,
          amount: 25,
          manualReview: true,
        },
      }),
      app.inject({ method: "GET", url: "/api/wallets/deposits" }),
      app.inject({ method: "GET", url: "/api/wallets/withdrawal-requests" }),
    ]);

    for (const response of responses) {
      const body = JSON.parse(response.body) as { error: { code: string } };

      assert.equal(response.statusCode, 401);
      assert.equal(body.error.code, "UNAUTHENTICATED");
    }
  } finally {
    await app.close();
  }
});

test("GET /api/wallets/me creates and reuses a wallet", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "wallet-me@example.com");
    const firstResponse = await app.inject({
      method: "GET",
      url: "/api/wallets/me",
      headers: { cookie },
    });
    const secondResponse = await app.inject({
      method: "GET",
      url: "/api/wallets/me",
      headers: { cookie },
    });
    const firstBody = JSON.parse(firstResponse.body) as {
      data: { mode: string; warning: string; created: boolean; wallet: { id: string; address: string } };
    };
    const secondBody = JSON.parse(secondResponse.body) as {
      data: { created: boolean; wallet: { id: string; address: string } };
    };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(firstBody.data.mode, "wallet_review_only");
    assert.match(firstBody.data.warning, /Transfers are not available yet./);
    assert.equal(firstBody.data.created, true);
    assert.equal(secondBody.data.created, false);
    assert.equal(secondBody.data.wallet.id, firstBody.data.wallet.id);
    assert.match(firstBody.data.wallet.address, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/deposit-intents creates a deposit intent", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "wallet-deposit@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/wallets/deposit-intents",
      headers: { cookie },
      payload: {
        expectedAmount: 42,
        reference: "local-ref",
      },
    });
    const body = JSON.parse(response.body) as {
      data: {
        mode: string;
        warning: string;
        depositIntent: {
          expectedAmount: number;
          status: string;
          address: string;
          reference: string;
        };
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.mode, "wallet_review_only");
    assert.match(body.data.warning, /Transfers are not available yet./);
    assert.equal(body.data.depositIntent.expectedAmount, 42);
    assert.equal(body.data.depositIntent.status, "waiting");
    assert.equal(body.data.depositIntent.reference, "local-ref");
    assert.match(body.data.depositIntent.address, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/withdrawal-requests creates and lists a blocked withdrawal request", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "wallet-withdrawal@example.com");
    const request = {
      method: "POST" as const,
      url: "/api/wallets/withdrawal-requests",
      headers: {
        cookie,
        "Idempotency-Key": "withdrawal-api-key",
      },
      payload: {
        asset: "USDT",
        network: "TRON",
        destinationAddress: VALID_TRON_ADDRESS,
        amount: 15,
        manualReview: true,
      },
    };
    const firstResponse = await app.inject(request);
    const secondResponse = await app.inject(request);
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/wallets/withdrawal-requests",
      headers: { cookie },
    });
    const firstBody = JSON.parse(firstResponse.body) as {
      data: {
        mode: string;
        warning: string;
        idempotent: boolean;
        compliance: { realTransferBlocked: boolean; reason: string; canUseRealMoney: boolean };
        withdrawalRequest: { id: string; status: string; realTransferBlocked: boolean };
      };
    };
    const secondBody = JSON.parse(secondResponse.body) as {
      data: { idempotent: boolean; withdrawalRequest: { id: string } };
    };
    const listBody = JSON.parse(listResponse.body) as {
      data: { mode: string; warning: string; withdrawalRequests: Array<{ id: string }> };
    };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(listResponse.statusCode, 200);
    assert.equal(firstBody.data.mode, "wallet_review_only");
    assert.match(firstBody.data.warning, /Transfers are not available yet./);
    assert.equal(firstBody.data.idempotent, false);
    assert.equal(firstBody.data.withdrawalRequest.status, "pending_review");
    assert.equal(firstBody.data.withdrawalRequest.realTransferBlocked, true);
    assert.equal(firstBody.data.compliance.canUseRealMoney, false);
    assert.equal(firstBody.data.compliance.realTransferBlocked, true);
    assert.equal(firstBody.data.compliance.reason, "TRANSFERS_UNAVAILABLE");
    assert.equal(secondBody.data.idempotent, true);
    assert.equal(secondBody.data.withdrawalRequest.id, firstBody.data.withdrawalRequest.id);
    assert.equal(listBody.data.mode, "wallet_review_only");
    assert.match(listBody.data.warning, /Transfers are not available yet./);
    assert.equal(listBody.data.withdrawalRequests.length, 1);
  } finally {
    await app.close();
  }
});

test("admin withdrawal reject blocks real transfer and does not move ledger", async () => {
  const app = buildApp(testConfig({ adminEmails: ["finance-admin@example.com"] }));

  try {
    const userCookie = await registerForTrading(app, "wallet-review-user@example.com");
    const adminCookie = await registerForTrading(app, "finance-admin@example.com");
    await app.inject({
      method: "POST",
      url: "/api/ledger/credits",
      headers: {
        cookie: userCookie,
        "Idempotency-Key": "admin-review-ledger-credit",
      },
      payload: { amount: 50 },
    });
    const withdrawalResponse = await app.inject({
      method: "POST",
      url: "/api/wallets/withdrawal-requests",
      headers: {
        cookie: userCookie,
        "Idempotency-Key": "admin-review-withdrawal",
      },
      payload: {
        destinationAddress: VALID_TRON_ADDRESS,
        amount: 15,
        manualReview: true,
      },
    });
    const withdrawalBody = JSON.parse(withdrawalResponse.body) as {
      data: { withdrawalRequest: { id: string } };
    };
    const beforeBalance = await app.inject({
      method: "GET",
      url: "/api/ledger/balance",
      headers: { cookie: userCookie },
    });
    const rejectResponse = await app.inject({
      method: "POST",
      url: `/api/admin/wallet-withdrawals/${withdrawalBody.data.withdrawalRequest.id}/reject`,
      headers: { cookie: adminCookie },
    });
    const afterBalance = await app.inject({
      method: "GET",
      url: "/api/ledger/balance",
      headers: { cookie: userCookie },
    });
    const rejectBody = JSON.parse(rejectResponse.body) as {
      data: {
        mode: string;
        realTransferBlocked: boolean;
        ledgerMutationBlocked: boolean;
        withdrawalRequest: { status: string; realTransferBlocked: boolean };
      };
    };
    const beforeBody = JSON.parse(beforeBalance.body) as {
      data: { balance: { availableBalance: number; totalDebited: number } };
    };
    const afterBody = JSON.parse(afterBalance.body) as {
      data: { balance: { availableBalance: number; totalDebited: number } };
    };

    assert.equal(rejectResponse.statusCode, 200);
    assert.equal(rejectBody.data.mode, "wallet_review_only");
    assert.equal(rejectBody.data.realTransferBlocked, true);
    assert.equal(rejectBody.data.ledgerMutationBlocked, true);
    assert.equal(rejectBody.data.withdrawalRequest.status, "rejected");
    assert.equal(rejectBody.data.withdrawalRequest.realTransferBlocked, true);
    assert.equal(beforeBody.data.balance.availableBalance, 50);
    assert.equal(afterBody.data.balance.availableBalance, 50);
    assert.equal(afterBody.data.balance.totalDebited, 0);
  } finally {
    await app.close();
  }
});

test("admin market hide and unhide work and write audit events", async () => {
  const app = buildApp(testConfig({ adminEmails: ["compliance-admin@example.com"] }));

  try {
    const adminCookie = await registerForTrading(app, "compliance-admin@example.com");
    const hideResponse = await app.inject({
      method: "POST",
      url: "/api/admin/markets/market-to-hide/hide",
      headers: { cookie: adminCookie },
      payload: {
        reason: "legal_risk",
      },
    });
    const auditAfterHide = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs",
      headers: { cookie: adminCookie },
    });
    const unhideResponse = await app.inject({
      method: "POST",
      url: "/api/admin/markets/market-to-hide/unhide",
      headers: { cookie: adminCookie },
    });
    const auditAfterUnhide = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs",
      headers: { cookie: adminCookie },
    });
    const hideBody = JSON.parse(hideResponse.body) as {
      data: {
        mode: string;
        rule: { marketId: string; reason: string; active: boolean };
        hiddenMarkets: Array<{ marketId: string }>;
      };
    };
    const unhideBody = JSON.parse(unhideResponse.body) as {
      data: { rule: { active: boolean } | null; hiddenMarkets: Array<{ marketId: string }> };
    };
    const hideAuditBody = JSON.parse(auditAfterHide.body) as {
      data: { auditLogs: Array<{ eventType: string }>; hiddenMarkets: Array<{ marketId: string }> };
    };
    const unhideAuditBody = JSON.parse(auditAfterUnhide.body) as {
      data: { auditLogs: Array<{ eventType: string }> };
    };

    assert.equal(hideResponse.statusCode, 200);
    assert.equal(hideBody.data.mode, "wallet_review_only");
    assert.equal(hideBody.data.rule.marketId, "market-to-hide");
    assert.equal(hideBody.data.rule.reason, "legal_risk");
    assert.equal(hideBody.data.rule.active, true);
    assert.equal(hideBody.data.hiddenMarkets.length, 1);
    assert.equal(hideAuditBody.data.hiddenMarkets[0]?.marketId, "market-to-hide");
    assert.equal(
      hideAuditBody.data.auditLogs.some((event) => event.eventType === "admin.market_hide"),
      true,
    );
    assert.equal(unhideResponse.statusCode, 200);
    assert.equal(unhideBody.data.rule?.active, false);
    assert.equal(unhideBody.data.hiddenMarkets.length, 0);
    assert.equal(
      unhideAuditBody.data.auditLogs.some((event) => event.eventType === "admin.market_unhide"),
      true,
    );
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/withdrawal-requests rejects mismatched idempotency reuse", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "wallet-withdrawal-mismatch@example.com");
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/wallets/withdrawal-requests",
      headers: {
        cookie,
        "Idempotency-Key": "withdrawal-api-mismatch-key",
      },
      payload: {
        destinationAddress: VALID_TRON_ADDRESS,
        amount: 15,
        manualReview: true,
      },
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/wallets/withdrawal-requests",
      headers: {
        cookie,
        "Idempotency-Key": "withdrawal-api-mismatch-key",
      },
      payload: {
        destinationAddress: VALID_TRON_ADDRESS,
        amount: 16,
        manualReview: true,
      },
    });
    const body = JSON.parse(secondResponse.body) as { error: { code: string; message: string } };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 409);
    assert.equal(body.error.code, "IDEMPOTENCY_KEY_REUSE_MISMATCH");
    assert.match(body.error.message, /different withdrawal request/);
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/withdrawal-requests rejects frontend approved status", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "wallet-approved-status@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/wallets/withdrawal-requests",
      headers: {
        cookie,
        "Idempotency-Key": "withdrawal-approved-status",
      },
      payload: {
        destinationAddress: VALID_TRON_ADDRESS,
        amount: 15,
        manualReview: true,
        status: "approved",
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "INVALID_WITHDRAWAL_STATUS");
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/webhooks/deposits credits confirmed USDT/TRON deposits idempotently", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "wallet-webhook-ledger@example.com");
    const walletResponse = await app.inject({
      method: "GET",
      url: "/api/wallets/me",
      headers: { cookie },
    });
    const walletBody = JSON.parse(walletResponse.body) as {
      data: { wallet: { address: string } };
    };
    const beforeResponse = await app.inject({
      method: "GET",
      url: "/api/ledger/balance",
      headers: { cookie },
    });
    const payload = {
      txHash: "deposit-webhook-api-1",
      logIndex: "0",
      provider: "internal_wallet",
      recipientAddress: walletBody.data.wallet.address,
      amount: 100,
      asset: "USDT",
      network: "TRON",
      confirmations: 2,
    };
    const webhookResponse = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload,
    });
    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload,
    });
    const afterResponse = await app.inject({
      method: "GET",
      url: "/api/ledger/balance",
      headers: { cookie },
    });
    const depositsResponse = await app.inject({
      method: "GET",
      url: "/api/wallets/deposits",
      headers: { cookie },
    });
    const webhookBody = JSON.parse(webhookResponse.body) as {
      data: {
        mode: string;
        warning: string;
        idempotent: boolean;
        depositEvent: { status: string; amount: number; rawPayload?: unknown };
        ledgerCredit: { idempotent: boolean };
      };
    };
    const duplicateBody = JSON.parse(duplicateResponse.body) as {
      data: { idempotent: boolean; depositEvent: { id: string }; ledgerCredit: null };
    };
    const beforeBody = JSON.parse(beforeResponse.body) as {
      data: { balance: { availableBalance: number } };
    };
    const afterBody = JSON.parse(afterResponse.body) as {
      data: { balance: { availableBalance: number } };
    };
    const depositsBody = JSON.parse(depositsResponse.body) as {
      data: {
        depositEvents: Array<{ status: string; amount: number; rawPayload?: unknown }>;
      };
    };

    assert.equal(webhookResponse.statusCode, 200);
    assert.equal(duplicateResponse.statusCode, 200);
    assert.equal(webhookBody.data.mode, "wallet_review_only");
    assert.match(webhookBody.data.warning, /Transfers are not available yet./);
    assert.equal(webhookBody.data.idempotent, false);
    assert.equal(webhookBody.data.depositEvent.status, "credited");
    assert.equal(webhookBody.data.depositEvent.amount, 100);
    assert.equal(webhookBody.data.depositEvent.rawPayload, undefined);
    assert.equal(webhookBody.data.ledgerCredit.idempotent, false);
    assert.equal(duplicateBody.data.idempotent, true);
    assert.equal(duplicateBody.data.ledgerCredit, null);
    assert.equal(beforeBody.data.balance.availableBalance, 0);
    assert.equal(afterBody.data.balance.availableBalance, 100);
    assert.equal(depositsBody.data.depositEvents.length, 1);
    assert.equal(depositsBody.data.depositEvents[0]?.status, "credited");
    assert.equal(depositsBody.data.depositEvents[0]?.rawPayload, undefined);
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/webhooks/deposits saves unknown wallet deposits as rejected", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload: {
        txHash: "deposit-unknown-wallet",
        logIndex: "0",
        provider: "internal_wallet",
        recipientAddress: VALID_TRON_ADDRESS,
        amount: 50,
        asset: "USDT",
        network: "TRON",
        confirmations: 2,
      },
    });
    const body = JSON.parse(response.body) as {
      data: {
        depositEvent: { status: string; rejectionReason: string; walletId: null; userId: null };
        ledgerCredit: null;
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.depositEvent.status, "rejected");
    assert.equal(body.data.depositEvent.rejectionReason, "WALLET_NOT_FOUND");
    assert.equal(body.data.depositEvent.walletId, null);
    assert.equal(body.data.depositEvent.userId, null);
    assert.equal(body.data.ledgerCredit, null);
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/webhooks/deposits rejects tx hash without log index or provider event id", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload: {
        txHash: "deposit-missing-event-key",
        provider: "internal_wallet",
        recipientAddress: VALID_TRON_ADDRESS,
        amount: 50,
        asset: "USDT",
        network: "TRON",
        confirmations: 2,
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "INVALID_WEBHOOK_EVENT");
    assert.match(body.error.message, /logIndex or unique provider eventId/);
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/webhooks/deposits rejects same tx/log with mismatched payload", async () => {
  const app = buildApp(testConfig({ adminEmails: ["deposit-conflict-admin@example.com"] }));

  try {
    const cookie = await registerForTrading(app, "wallet-webhook-conflict@example.com");
    const adminCookie = await registerForTrading(app, "deposit-conflict-admin@example.com");
    const walletResponse = await app.inject({
      method: "GET",
      url: "/api/wallets/me",
      headers: { cookie },
    });
    const walletBody = JSON.parse(walletResponse.body) as {
      data: { wallet: { address: string } };
    };
    const payload = {
      txHash: "deposit-conflict",
      logIndex: "0",
      provider: "internal_wallet",
      recipientAddress: walletBody.data.wallet.address,
      amount: 100,
      asset: "USDT",
      network: "TRON",
      confirmations: 2,
      payload: {
        providerEventId: "provider-event-original",
      },
    };
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload,
    });
    const conflictResponse = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload: {
        ...payload,
        amount: 101,
      },
    });
    const balanceResponse = await app.inject({
      method: "GET",
      url: "/api/ledger/balance",
      headers: { cookie },
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs",
      headers: { cookie: adminCookie },
    });
    const conflictBody = JSON.parse(conflictResponse.body) as {
      data: {
        conflict: boolean;
        depositEvent: { status: string; rejectionReason: string; amount: number };
        ledgerCredit: null;
        creditBlockedReason: string;
      };
      error: { code: string };
    };
    const balanceBody = JSON.parse(balanceResponse.body) as {
      data: { balance: { availableBalance: number } };
    };
    const auditBody = JSON.parse(auditResponse.body) as {
      data: { auditLogs: Array<{ eventType: string; metadata: { rejectionReason?: string } }> };
    };

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(conflictResponse.statusCode, 409);
    assert.equal(conflictBody.error.code, "DEPOSIT_EVENT_FINGERPRINT_MISMATCH");
    assert.equal(conflictBody.data.conflict, true);
    assert.equal(conflictBody.data.depositEvent.status, "manual_review");
    assert.equal(conflictBody.data.depositEvent.amount, 100);
    assert.equal(conflictBody.data.depositEvent.rejectionReason, "IDEMPOTENCY_PAYLOAD_MISMATCH");
    assert.equal(conflictBody.data.ledgerCredit, null);
    assert.equal(conflictBody.data.creditBlockedReason, "IDEMPOTENCY_PAYLOAD_MISMATCH");
    assert.equal(balanceBody.data.balance.availableBalance, 100);
    assert.equal(
      auditBody.data.auditLogs.some(
        (event) =>
          event.eventType === "wallet.deposit_rejected" &&
          event.metadata.rejectionReason === "IDEMPOTENCY_PAYLOAD_MISMATCH",
      ),
      true,
    );
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/webhooks/deposits does not credit blocked compliance users", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "wallet-webhook-blocked@example.com");
    await app.inject({
      method: "PATCH",
      url: "/api/compliance/me",
      headers: { cookie },
      payload: {
        countryCode: "IR",
        dateOfBirth: "1990-01-01",
      },
    });
    const walletResponse = await app.inject({
      method: "GET",
      url: "/api/wallets/me",
      headers: { cookie },
    });
    const walletBody = JSON.parse(walletResponse.body) as {
      data: { wallet: { address: string } };
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload: {
        txHash: "deposit-blocked-user",
        logIndex: "0",
        provider: "internal_wallet",
        recipientAddress: walletBody.data.wallet.address,
        amount: 75,
        asset: "USDT",
        network: "TRON",
        confirmations: 2,
      },
    });
    const balanceResponse = await app.inject({
      method: "GET",
      url: "/api/ledger/balance",
      headers: { cookie },
    });
    const body = JSON.parse(response.body) as {
      data: {
        depositEvent: { status: string; amount: number };
        creditBlockedReason: string;
        ledgerCredit: null;
      };
    };
    const balanceBody = JSON.parse(balanceResponse.body) as {
      data: { balance: { availableBalance: number } };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.depositEvent.status, "confirmed");
    assert.equal(body.data.depositEvent.amount, 75);
    assert.equal(body.data.creditBlockedReason, "COMPLIANCE_BLOCKED");
    assert.equal(body.data.ledgerCredit, null);
    assert.equal(balanceBody.data.balance.availableBalance, 0);
  } finally {
    await app.close();
  }
});

test("admin audit logs include deposit status events", async () => {
  const app = buildApp(testConfig({ adminEmails: ["deposit-audit-admin@example.com"] }));

  try {
    const userCookie = await registerForTrading(app, "wallet-webhook-audit-user@example.com");
    const adminCookie = await registerForTrading(app, "deposit-audit-admin@example.com");
    const walletResponse = await app.inject({
      method: "GET",
      url: "/api/wallets/me",
      headers: { cookie: userCookie },
    });
    const walletBody = JSON.parse(walletResponse.body) as {
      data: { wallet: { address: string } };
    };
    await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload: {
        txHash: "deposit-audit-log",
        logIndex: "0",
        provider: "internal_wallet",
        recipientAddress: walletBody.data.wallet.address,
        amount: 25,
        asset: "USDT",
        network: "TRON",
        confirmations: 2,
      },
    });
    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs",
      headers: { cookie: adminCookie },
    });
    const auditBody = JSON.parse(auditResponse.body) as {
      data: { auditLogs: Array<{ eventType: string; metadata: { status?: string } }> };
    };

    assert.equal(auditResponse.statusCode, 200);
    assert.equal(
      auditBody.data.auditLogs.some(
        (event) =>
          event.eventType === "wallet.deposit_credited" && event.metadata.status === "credited",
      ),
      true,
    );
  } finally {
    await app.close();
  }
});

test("POST /api/wallets/webhooks/deposits requires the configured local secret", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      payload: {
        eventId: "local-webhook-missing-secret",
        provider: "internal_wallet",
        eventType: "local.deposit_detected",
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 401);
    assert.equal(body.error.code, "MOCK_WEBHOOK_SECRET_REQUIRED");
  } finally {
    await app.close();
  }
});
