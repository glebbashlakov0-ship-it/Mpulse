import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { AuditService } from "../audit.js";
import type { AuthContext, AuthService } from "../auth.js";
import type { ComplianceService } from "../compliance.js";
import type { MarketDataService } from "../marketDataService.js";
import type { PortfolioRepository } from "../portfolioRepository.js";
import type { CoinLedgerPort } from "../trading.js";
import { testConfig } from "../testUtils.js";
import { registerTradingRoutes } from "./tradingRoutes.js";

test("compatibility trade POST enforces the same eligibility gate as orders", async () => {
  const app = Fastify();
  const now = new Date().toISOString();
  const authContext: AuthContext = {
    user: {
      id: "restricted-user",
      email: "restricted@example.com",
      emailVerified: true,
      displayName: "Restricted User",
      role: "user",
      settings: {
        language: "en",
        currency: "COIN",
        country: null,
        emailNotifications: false,
        marketNotifications: false,
      },
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: "restricted-session",
      userId: "restricted-user",
      tokenHash: "test-token-hash",
      createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastSeenAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
  const auditEvents: Array<{ eventType: string; metadata?: Record<string, unknown> }> = [];
  const audit = {
    record: async (event: { eventType: string; metadata?: Record<string, unknown> }) => {
      auditEvents.push(event);
    },
  } as AuditService;
  const compliance = {
    getEligibility: async () => ({
      canTradeLocal: false,
      canUseRealMoney: false,
      reasons: ["ACCOUNT_RESTRICTED"],
    }),
  } as unknown as ComplianceService;

  app.addHook("preHandler", async (request) => {
    (request as typeof request & { auth: AuthContext }).auth = authContext;
  });
  registerTradingRoutes(
    app,
    {} as AuthService,
    testConfig(),
    audit,
    {} as MarketDataService,
    {} as CoinLedgerPort,
    {} as PortfolioRepository,
    compliance,
  );

  try {
    const payload = {
      marketId: "restricted-market",
      side: "yes",
      amountCoinMicros: "1000000",
    };
    const [ordersResponse, compatibilityResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/trading/orders",
        headers: { "Idempotency-Key": "restricted-order" },
        payload: { ...payload, action: "buy" },
      }),
      app.inject({
        method: "POST",
        url: "/api/trading/trades",
        headers: { "Idempotency-Key": "restricted-compatibility-trade" },
        payload,
      }),
    ]);
    const ordersBody = JSON.parse(ordersResponse.body) as {
      error: { code: string; reasons: string[] };
    };
    const compatibilityBody = JSON.parse(compatibilityResponse.body) as {
      error: { code: string; reasons: string[] };
    };

    assert.equal(ordersResponse.statusCode, 403);
    assert.equal(compatibilityResponse.statusCode, 403);
    assert.equal(ordersBody.error.code, "TRADING_ACCOUNT_RESTRICTED");
    assert.deepEqual(compatibilityBody.error, ordersBody.error);
    assert.equal(auditEvents.length, 2);
    assert.equal(
      auditEvents.every(
        (event) =>
          event.eventType === "trading.rejected" &&
          event.metadata?.reason === "TRADING_ACCOUNT_RESTRICTED",
      ),
      true,
    );
  } finally {
    await app.close();
  }
});
