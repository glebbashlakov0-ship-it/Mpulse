import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { buildApp, hasValidCronAuthorization } from "./server.js";
import { marketFixture, testConfig } from "./testUtils.js";

test("money outbox cron authorization fails closed and matches the exact bearer token", () => {
  const secret = "test-cron-secret-with-at-least-32-characters";
  assert.equal(hasValidCronAuthorization(undefined, secret), false);
  assert.equal(hasValidCronAuthorization(`Bearer ${secret}`, null), false);
  assert.equal(hasValidCronAuthorization(`Bearer wrong-${secret}`, secret), false);
  assert.equal(hasValidCronAuthorization(`Bearer ${secret}`, secret), true);
});

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

function createTestFireblocksWebhookSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyId = "server-fireblocks-webhook-key";
  const publicJwk = publicKey.export({ format: "jwk" });
  const jwks = {
    keys: [
      {
        kty: publicJwk.kty ?? "RSA",
        n: publicJwk.n,
        e: publicJwk.e,
        kid: keyId,
        alg: "RS512",
        use: "sig",
      },
    ],
  };

  return {
    jwks,
    signBody(body: string) {
      const encodedHeader = base64UrlJson({ alg: "RS512", kid: keyId, typ: "JWT" });
      const signingInput = `${encodedHeader}.${base64Url(Buffer.from(body, "utf8"))}`;
      const signature = sign("RSA-SHA512", Buffer.from(signingInput), privateKey);
      return `${encodedHeader}..${base64Url(signature)}`;
    },
  };
}

function base64UrlJson(value: unknown) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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

test("buildApp fails fast instead of using memory fallback in production without DATABASE_URL", () => {
  assert.throws(
    () =>
      buildApp(
        testConfig({
          nodeEnv: "production",
          databaseUrl: null,
          sessionCookieSecure: true,
          corsAllowedOrigins: ["https://market.example"],
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

test("market activity comments can be posted and listed", async () => {
  const app = buildApp(testConfig());

  try {
    const emptyResponse = await app.inject({
      method: "GET",
      url: "/api/markets/comment-market/activity",
    });
    const emptyBody = JSON.parse(emptyResponse.body) as {
      data: { comments: unknown[]; topHolders: unknown[]; positions: unknown[]; activity: unknown[] };
    };

    assert.equal(emptyResponse.statusCode, 200);
    assert.deepEqual(emptyBody.data.comments, []);
    assert.deepEqual(emptyBody.data.activity, []);

    const postResponse = await app.inject({
      method: "POST",
      url: "/api/markets/comment-market/comments",
      payload: {
        body: "This market finally has a real comment thread.",
        positionLabel: "Yes",
      },
    });
    const postBody = JSON.parse(postResponse.body) as {
      data: {
        comments: Array<{ body: string; displayName: string; positionLabel: string | null }>;
        activity: Array<{ type: string; body?: string }>;
      };
    };

    assert.equal(postResponse.statusCode, 200);
    assert.equal(postBody.data.comments.length, 1);
    assert.equal(postBody.data.comments[0]?.body, "This market finally has a real comment thread.");
    assert.equal(postBody.data.comments[0]?.displayName, "Guest Trader");
    assert.equal(postBody.data.comments[0]?.positionLabel, "Yes");
    assert.equal(postBody.data.activity[0]?.type, "comment");

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/markets/comment-market/activity",
    });
    const listBody = JSON.parse(listResponse.body) as {
      data: { comments: Array<{ body: string }>; activity: Array<{ type: string }> };
    };

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listBody.data.comments.length, 1);
    assert.equal(listBody.data.comments[0]?.body, "This market finally has a real comment thread.");
    assert.equal(listBody.data.activity[0]?.type, "comment");
  } finally {
    await app.close();
  }
});

test("market comments validate empty payloads", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "comment-validator@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/api/markets/comment-market/comments",
      headers: { cookie },
      payload: { body: "   " },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "INVALID_COMMENT");
  } finally {
    await app.close();
  }
});

test("market activity routes list and publish comments", async () => {
  const app = buildApp(testConfig());

  try {
    const emptyResponse = await app.inject({
      method: "GET",
      url: "/api/markets/demo-market/activity",
    });
    const emptyBody = JSON.parse(emptyResponse.body) as {
      data: { comments: unknown[]; topHolders: unknown[]; positions: unknown[]; activity: unknown[] };
    };

    assert.equal(emptyResponse.statusCode, 200);
    assert.deepEqual(emptyBody.data.comments, []);
    assert.deepEqual(emptyBody.data.topHolders, []);
    assert.deepEqual(emptyBody.data.positions, []);
    assert.deepEqual(emptyBody.data.activity, []);

    const cookie = await registerForTrading(app, "demo-commenter@example.com");
    const postResponse = await app.inject({
      method: "POST",
      url: "/api/markets/demo-market/comments",
      headers: { cookie },
      payload: {
        body: "This market finally has a working comments tab.",
        positionLabel: "Demo Yes",
      },
    });
    const postBody = JSON.parse(postResponse.body) as {
      data: {
        comments: Array<{ body: string; displayName: string; positionLabel: string | null }>;
        activity: Array<{ type: string; body?: string }>;
      };
    };

    assert.equal(postResponse.statusCode, 200);
    assert.equal(postBody.data.comments.length, 1);
    assert.equal(postBody.data.comments[0]?.body, "This market finally has a working comments tab.");
    assert.equal(postBody.data.comments[0]?.displayName, "Trading Tester");
    assert.equal(postBody.data.comments[0]?.positionLabel, "Demo Yes");
    assert.equal(postBody.data.activity[0]?.type, "comment");
    assert.equal(postBody.data.activity[0]?.body, "This market finally has a working comments tab.");

    const invalidResponse = await app.inject({
      method: "POST",
      url: "/api/markets/demo-market/comments",
      headers: { cookie },
      payload: { body: "" },
    });

    assert.equal(invalidResponse.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("GET /api/markets filters by topic on the backend", async () => {
  const originalFetch = globalThis.fetch;
  const markets = [
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
    ];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/events") {
      return Response.json([
        {
          id: "crypto-event",
          title: "Crypto markets",
          active: true,
          closed: false,
          archived: false,
          restricted: false,
          volume: 500000,
          volume24hr: 50000,
          liquidity: 10000,
          tags: [{ slug: "crypto", label: "Crypto" }],
          markets,
        },
      ]);
    }

    if (url.pathname === "/public-search") {
      return Response.json({ events: [] });
    }

    return Response.json(markets);
  };
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

    if (url.pathname === "/events") {
      return Response.json([]);
    }

    if (url.pathname === "/public-search") {
      return Response.json({
        events: [
          {
            id: "esports-search",
            title: "Search results",
            active: true,
            closed: false,
            archived: false,
            restricted: false,
            volume: 100000,
            volume24hr: 10000,
            liquidity: 10000,
            tags: [],
            markets: [
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
            ],
          },
        ],
      });
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

test("GET /api/markets search uses market-specific event titles without a canonical slug", async () => {
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
    assert.equal(body.data.history.price_history[0]?.yes, 0.5);
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

test("state-changing admin money routes require admin CSRF token when protection is enabled", async () => {
  const app = buildApp(testConfig({ csrfProtectionEnabled: true }));

  try {
    const csrf = await app.inject({
      method: "GET",
      url: "/api/admin/csrf",
    });
    const csrfBody = JSON.parse(csrf.body) as { data: { csrfToken: string } };
    const csrfCookie = getCookieHeader(csrf);
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/login",
      headers: {
        cookie: csrfCookie,
        "x-csrf-token": csrfBody.data.csrfToken,
      },
      payload: {
        username: "admin",
        password: "admin",
      },
    });
    const adminCookie = getCookieHeader(login);
    const blocked = await app.inject({
      method: "POST",
      url: "/api/admin/markets/csrf-market/resolve",
      headers: {
        cookie: adminCookie,
        "Idempotency-Key": "csrf-admin-settlement",
      },
      payload: { winningSide: "yes" },
    });
    const blockedBody = JSON.parse(blocked.body) as { error: { code: string } };

    assert.equal(login.statusCode, 200);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blockedBody.error.code, "CSRF_TOKEN_INVALID");
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

test("GET /api/auth/session returns null user without a session", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });
    const body = JSON.parse(response.body) as { data: { user: null } };

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.user, null);
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

test("admin endpoints ignore public user sessions", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "plain-user@example.com");
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 401);
    assert.equal(body.error.code, "ADMIN_PANEL_UNAUTHENTICATED");
  } finally {
    await app.close();
  }
});

test("standalone admin login lists public users without using email roles", async () => {
  const app = buildApp(testConfig());

  try {
    const adminCookie = await loginAdmin(app);
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
    assert.equal(body.data.users.some((user) => user.email === "listed-user@example.com"), true);
    assert.equal(
      body.data.users.find((user) => user.email === "listed-user@example.com")?.role,
      "user",
    );
    assert.equal(body.data.summary.user, 1);
  } finally {
    await app.close();
  }
});

test("standalone admin login keeps moderation available while Coin finance requires DB", async () => {
  const app = buildApp(testConfig());

  try {
    const adminCookie = await loginAdmin(app);

    const users = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: adminCookie },
    });
    assert.equal(users.statusCode, 200);

    const withdrawals = await app.inject({
      method: "GET",
      url: "/api/admin/wallet-withdrawals",
      headers: { cookie: adminCookie },
    });
    const withdrawalsBody = JSON.parse(withdrawals.body) as { error: { code: string } };
    assert.equal(withdrawals.statusCode, 503);
    assert.equal(withdrawalsBody.error.code, "COIN_WALLET_DATABASE_REQUIRED");

    const hide = await app.inject({
      method: "POST",
      url: "/api/admin/markets/matrix-market/hide",
      headers: { cookie: adminCookie },
      payload: { reason: "manual_review" },
    });
    assert.equal(hide.statusCode, 200);
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

test("PATCH /api/compliance/me rejects frontend-owned compliance statuses and junk fields", async () => {
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
        accountStatus: "approved",
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };

    assert.equal(response.statusCode, 400);
    assert.equal(body.error.code, "INVALID_COMPLIANCE_PROFILE");
    assert.equal(body.error.message, "Unsupported field: accountStatus.");
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

test("DB-disabled Coin trading routes fail closed and portfolio reset remains retired", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "coin-trading-db-required@example.com");
    const unavailableResponses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/trading/quote",
        headers: { cookie },
        payload: {
          marketId: "trade-market",
          side: "yes",
          action: "buy",
          amountCoinMicros: "1000000",
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/trading/orders",
        headers: { cookie, "Idempotency-Key": "coin-trading-db-required" },
        payload: {
          marketId: "trade-market",
          side: "yes",
          action: "buy",
          amountCoinMicros: "1000000",
        },
      }),
      app.inject({ method: "GET", url: "/api/portfolio", headers: { cookie } }),
      app.inject({ method: "GET", url: "/api/trading/positions", headers: { cookie } }),
      app.inject({ method: "GET", url: "/api/trading/trades", headers: { cookie } }),
    ]);

    for (const response of unavailableResponses) {
      const body = JSON.parse(response.body) as { error: { code: string } };
      assert.equal(response.statusCode, 503);
      assert.equal(body.error.code, "COIN_LEDGER_UNAVAILABLE");
    }

    const resetResponse = await app.inject({
      method: "POST",
      url: "/api/portfolio/reset",
      headers: { cookie },
    });
    const resetBody = JSON.parse(resetResponse.body) as { error: { code: string } };

    assert.equal(resetResponse.statusCode, 410);
    assert.equal(resetBody.error.code, "PORTFOLIO_RESET_DISABLED");
  } finally {
    await app.close();
  }
});

test("legacy ledger API routes remain retired", async () => {
  const app = buildApp(testConfig({ ledgerCreditApiEnabled: true }));

  try {
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/ledger/balance" }),
      app.inject({ method: "GET", url: "/api/ledger/entries" }),
      app.inject({
        method: "POST",
        url: "/api/ledger/credits",
        headers: { "Idempotency-Key": "retired-ledger-credit" },
        payload: { amount: 25 },
      }),
    ]);

    for (const response of responses) {
      assert.equal(response.statusCode, 404);
    }
  } finally {
    await app.close();
  }
});

test("DB-disabled Coin settlement routes fail closed", async () => {
  const app = buildApp(testConfig());

  try {
    const adminCookie = await loginAdmin(app);
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/admin/markets/trade-market/resolve",
        headers: { cookie: adminCookie, "Idempotency-Key": "coin-resolve-db-required" },
        payload: { winningSide: "yes" },
      }),
      app.inject({
        method: "POST",
        url: "/api/admin/markets/trade-market/cancel",
        headers: { cookie: adminCookie, "Idempotency-Key": "coin-cancel-db-required" },
      }),
    ]);

    for (const response of responses) {
      const body = JSON.parse(response.body) as { error: { code: string } };
      assert.equal(response.statusCode, 503);
      assert.equal(body.error.code, "COIN_SETTLEMENT_DATABASE_REQUIRED");
    }
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

test("DB-disabled Coin wallet routes fail closed for authenticated users", async () => {
  const app = buildApp(testConfig());

  try {
    const cookie = await registerForTrading(app, "coin-wallet-db-required@example.com");
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/api/wallets/me", headers: { cookie } }),
      app.inject({
        method: "POST",
        url: "/api/wallets/deposit-intents",
        headers: { cookie },
        payload: { expectedUsdtAtomic: "25000000" },
      }),
      app.inject({
        method: "POST",
        url: "/api/wallets/withdrawal-quotes",
        headers: { cookie, "Idempotency-Key": "coin-withdrawal-quote-db-required" },
        payload: {
          destinationAddress: VALID_TRON_ADDRESS,
          coinAmountMicros: "25000000",
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/wallets/withdrawal-requests",
        headers: { cookie, "Idempotency-Key": "coin-withdrawal-db-required" },
        payload: { quoteId: "missing-without-database" },
      }),
      app.inject({ method: "GET", url: "/api/wallets/deposits", headers: { cookie } }),
      app.inject({
        method: "GET",
        url: "/api/wallets/withdrawal-requests",
        headers: { cookie },
      }),
    ]);

    for (const response of responses) {
      const body = JSON.parse(response.body) as { error: { code: string } };
      assert.equal(response.statusCode, 503);
      assert.equal(body.error.code, "COIN_WALLET_DATABASE_REQUIRED");
    }
  } finally {
    await app.close();
  }
});

test("admin market hide and unhide work and write audit events", async () => {
  const app = buildApp(testConfig());

  try {
    const adminCookie = await loginAdmin(app);
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

test("unsigned legacy deposit webhook remains retired", async () => {
  const app = buildApp(testConfig());

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload: {
        txHash: "legacy-deposit-retired",
        logIndex: "0",
        provider: "internal_wallet",
        recipientAddress: VALID_TRON_ADDRESS,
        amount: 50,
        asset: "USDT",
        network: "TRON",
        confirmations: 2,
      },
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 410);
    assert.equal(body.error.code, "LEGACY_DEPOSIT_WEBHOOK_RETIRED");
  } finally {
    await app.close();
  }
});

test("signed Fireblocks deposits bypass browser CSRF and require the PostgreSQL Coin ledger", async () => {
  const signer = createTestFireblocksWebhookSigner();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => signer.jwks,
  })) as unknown as typeof fetch;
  const app = buildApp(
    testConfig({
      realMoneyDepositProvider: "Fireblocks",
      walletDepositWebhookEnabled: true,
      csrfProtectionEnabled: true,
    }),
  );

  try {
    const payload = {
      eventType: "TRANSACTION_STATUS_UPDATED",
      data: {
        id: "fireblocks-provider-tx-db-required",
        status: "COMPLETED",
        txHash: "fireblocks-route-tx-db-required",
        assetId: "TRX_USDT_S2UZ",
        destinationAddress: VALID_TRON_ADDRESS,
        amountInfo: {
          amount: "42.5",
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const response = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "content-type": "application/json",
        "Fireblocks-Webhook-Signature": signer.signBody(rawBody),
      },
      payload: rawBody,
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 503);
    assert.equal(body.error.code, "COIN_WALLET_DATABASE_REQUIRED");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("Fireblocks deposit webhook still rejects missing JWS when browser CSRF is enabled", async () => {
  const app = buildApp(
    testConfig({
      realMoneyDepositProvider: "Fireblocks",
      walletDepositWebhookEnabled: true,
      csrfProtectionEnabled: true,
    }),
  );

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/wallets/webhooks/deposits",
      headers: {
        "content-type": "application/json",
        "X-Deposit-Webhook-Secret": "test-local-webhook-secret",
      },
      payload: JSON.stringify({
        eventType: "TRANSACTION_STATUS_UPDATED",
        data: {
          id: "fireblocks-missing-signature",
          status: "COMPLETED",
        },
      }),
    });
    const body = JSON.parse(response.body) as { error: { code: string } };

    assert.equal(response.statusCode, 401);
    assert.equal(body.error.code, "SIGNATURE_REQUIRED");
  } finally {
    await app.close();
  }
});
