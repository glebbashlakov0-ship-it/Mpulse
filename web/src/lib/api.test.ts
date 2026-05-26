import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptLegalAcknowledgements,
  createLedgerCreditApi,
  createDepositIntent,
  createTradingQuoteApi,
  createWithdrawalRequest,
  loadCurrentUser,
  loadComplianceEligibility,
  loadLedgerEntries,
  revokeAllAuthSessions,
  updateComplianceProfile,
} from "./api";

type FetchCall = {
  input: string;
  init: RequestInit | undefined;
};

function getHeader(init: RequestInit | undefined, name: string) {
  const headers = init?.headers;

  if (headers instanceof Headers) {
    return headers.get(name);
  }

  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null;
  }

  return headers?.[name as keyof typeof headers] ?? null;
}

async function withLocalFetch<T>(
  handler: (input: string, init: RequestInit | undefined) => Response,
  run: (calls: FetchCall[]) => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/csrf") {
      return Response.json({ data: { csrfToken: "test-csrf-token" } });
    }

    calls.push({ input: url, init });
    return handler(url, init);
  }) as typeof fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("wallet api helpers", () => {
  it("creates backend trading quotes without an idempotency header", async () => {
    await withLocalFetch(
      () =>
        Response.json({
          data: {
            id: "quote-1",
            marketId: "market-1",
            marketTitle: "Will this test pass?",
            side: "yes",
            action: "buy",
            price: 0.5,
            currentOdds: 0.5,
            shares: 122,
            amount: 61,
            stakeAmount: 61,
            platformFee: 1.22,
            fee: 1.22,
            estimatedCost: 61,
            estimatedProceeds: 0,
            estimatedPayout: 59.78,
            estimatedProfit: -1.22,
            availableCash: 10000,
            balanceAfterBet: 9939,
            availableShares: 0,
            poolBefore: 0,
            poolAfter: 61,
            outcomePoolBefore: 0,
            outcomePoolAfter: 61,
            priceImpact: 0.5,
            nextOdds: 1,
            status: "quoted",
            createdAt: "2026-05-20T12:00:00.000Z",
          },
        }),
      async (calls) => {
        const quote = await createTradingQuoteApi({
          marketId: "market-1",
          side: "yes",
          action: "buy",
          amount: 61,
        });
        const call = calls[0];
        const body = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;

        assert.equal(call?.input, "/api/trading/quote");
        assert.equal(call?.init?.method, "POST");
        assert.equal(getHeader(call?.init, "Idempotency-Key"), null);
        assert.equal(body.marketId, "market-1");
        assert.equal(body.side, "yes");
        assert.equal(body.action, "buy");
        assert.equal(body.amount, 61);
        assert.equal(quote.estimatedPayout, 59.78);
        assert.equal(quote.balanceAfterBet, 9939);
      },
    );
  });

  it("creates TRON withdrawal requests with an idempotency header", async () => {
    await withLocalFetch(
      () =>
        Response.json({
          data: {
            mode: "wallet_review_only",
            warning: "Wallet requests are reviewed before processing.",
            idempotent: false,
            compliance: {
              canUseRealMoney: false,
              realTransferBlocked: true,
              reason: "TRANSFERS_UNAVAILABLE",
            },
            withdrawalRequest: {
              id: "withdrawal-1",
              userId: "user-1",
              asset: "USDT",
              network: "TRON",
              destinationAddress: "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK",
              amount: 15,
              status: "pending_review",
              idempotencyKey: "withdrawal-test-key",
              provider: "internal_wallet",
              realTransferBlocked: true,
              blockReason: "TRANSFERS_UNAVAILABLE",
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
            },
          },
        }),
      async (calls) => {
        await createWithdrawalRequest({
          amount: 15,
          destinationAddress: "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK",
          idempotencyKey: "withdrawal-test-key",
        });

        const call = calls[0];
        const body = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;

        assert.equal(call?.input, "/api/wallets/withdrawal-requests");
        assert.equal(call?.init?.method, "POST");
        assert.equal(getHeader(call?.init, "Idempotency-Key"), "withdrawal-test-key");
        assert.equal(body.asset, "USDT");
        assert.equal(body.network, "TRON");
        assert.equal(body.manualReview, true);
        assert.equal(body.destinationAddress, "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK");
      },
    );
  });

  it("creates ledger credits with backend idempotency expectations", async () => {
    await withLocalFetch(
      () =>
        Response.json({
          data: {
            mode: "ledger",
            complianceMode: "ledger_restricted",
            idempotent: false,
            entry: {
              id: "entry-1",
              userId: "user-1",
              walletId: null,
              asset: "USDT",
              entryType: "credit",
              amount: 1000,
              reason: "ledger_credit",
              referenceType: "ledger_credit",
              referenceId: "ledger-credit-test-key",
              idempotencyKey: "ledger-credit-test-key",
              metadata: {},
              createdAt: "2026-05-06T00:00:00.000Z",
            },
            balance: {
              userId: "user-1",
              walletId: null,
              asset: "USDT",
              availableBalance: 1000,
              totalCredited: 1000,
              totalDebited: 0,
              totalHeld: 0,
              totalReleased: 0,
            },
          },
        }),
      async (calls) => {
        await createLedgerCreditApi(1000, "ledger-credit-test-key");

        const call = calls[0];
        const body = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;

        assert.equal(call?.input, "/api/ledger/credits");
        assert.equal(call?.init?.method, "POST");
        assert.equal(getHeader(call?.init, "Idempotency-Key"), "ledger-credit-test-key");
        assert.equal(body.amount, 1000);
        assert.deepEqual(body.metadata, { source: "wallet_page" });
      },
    );
  });

  it("uses typed helpers for deposit instructions and ledger pagination", async () => {
    await withLocalFetch(
      (input) => {
        if (input.startsWith("/api/ledger/entries")) {
          return Response.json({ data: { mode: "ledger", entries: [] } });
        }

        return Response.json({
          data: {
            mode: "wallet_review_only",
            warning: "Wallet requests are reviewed before processing.",
            walletCreated: false,
            wallet: {
              id: "wallet-1",
              userId: "user-1",
              asset: "USDT",
              network: "TRON",
              address: "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK",
              status: "active",
              provider: "internal_wallet",
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
            },
            depositIntent: {
              id: "intent-1",
              userId: "user-1",
              walletId: "wallet-1",
              asset: "USDT",
              network: "TRON",
              address: "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK",
              expectedAmount: 25,
              status: "waiting",
              memo: null,
              reference: "test",
              expiresAt: "2026-05-06T00:30:00.000Z",
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
            },
          },
        });
      },
      async (calls) => {
        await createDepositIntent({ expectedAmount: 25, reference: "test" });
        await loadLedgerEntries(25);

        const depositBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;

        assert.equal(calls[0]?.input, "/api/wallets/deposit-intents");
        assert.equal(depositBody.expectedAmount, 25);
        assert.equal(depositBody.reference, "test");
        assert.equal(calls[1]?.input, "/api/ledger/entries?asset=USDT&limit=25");
      },
    );
  });

  it("uses typed helpers for compliance profile and eligibility", async () => {
    await withLocalFetch(
      (input) => {
        if (input === "/api/compliance/eligibility") {
          return Response.json({
            data: {
              profile: {
                userId: "user-1",
                countryCode: "US",
                dateOfBirth: "1990-01-01",
                kycStatus: "not_started",
                amlStatus: "clear",
                riskLevel: "low",
                verificationProvider: "self_declared",
                createdAt: "2026-05-06T00:00:00.000Z",
                updatedAt: "2026-05-06T00:00:00.000Z",
              },
              legalConsents: [],
              acceptedVersions: {
                terms: "1.0.0",
                privacy: "1.0.0",
                risk_disclosure: "1.0.0",
              },
              canTradeMock: true,
              canTradeLocal: true,
              canUseRealMoney: false,
              reasons: ["TRANSFERS_UNAVAILABLE"],
              age: 36,
              complianceMode: "trading_restricted",
              verificationProvider: "self_declared",
            },
          });
        }

        return Response.json({
          data: {
            profile: {
              userId: "user-1",
              countryCode: "US",
              dateOfBirth: "1990-01-01",
              kycStatus: "not_started",
              amlStatus: "clear",
              riskLevel: "low",
              verificationProvider: "self_declared",
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
            },
            legalConsents: [],
            acceptedVersions: {
              terms: "1.0.0",
              privacy: "1.0.0",
              risk_disclosure: "1.0.0",
            },
          },
        });
      },
      async (calls) => {
        await updateComplianceProfile({ countryCode: "US", dateOfBirth: "1990-01-01" });
        await acceptLegalAcknowledgements();
        const eligibility = await loadComplianceEligibility();

        assert.equal(calls[0]?.input, "/api/compliance/me");
        assert.equal(calls[0]?.init?.method, "PATCH");
        assert.equal(calls[1]?.input, "/api/compliance/accept-terms");
        assert.equal(calls[1]?.init?.method, "POST");
        assert.equal(calls[2]?.input, "/api/compliance/eligibility");
        assert.equal(eligibility.canTradeMock, true);
        assert.equal(eligibility.canTradeLocal, true);
      },
    );
  });
});

describe("auth api helpers", () => {
  it("loads the current user so shared auth state can leave loading", async () => {
    await withLocalFetch(
      () =>
        Response.json({
          data: {
            user: {
              id: "user-1",
              email: "trader@example.com",
              displayName: "Market Trader",
              role: "user",
              emailVerified: false,
              twoFactorEnabled: false,
              settings: {},
              createdAt: "2026-05-07T00:00:00.000Z",
              updatedAt: "2026-05-07T00:00:00.000Z",
            },
          },
        }),
      async (calls) => {
        const user = await loadCurrentUser();

        assert.equal(calls[0]?.input, "/api/auth/session");
        assert.equal(calls[0]?.init?.credentials, "same-origin");
        assert.equal(user?.email, "trader@example.com");
      },
    );
  });

  it("logs out all devices through the session management API", async () => {
    await withLocalFetch(
      () => Response.json({ data: { ok: true } }),
      async (calls) => {
        await revokeAllAuthSessions();

        const call = calls[0];
        assert.equal(call?.input, "/api/auth/sessions/revoke-all");
        assert.equal(call?.init?.method, "POST");
        assert.equal(getHeader(call?.init, "X-CSRF-Token"), "test-csrf-token");
      },
    );
  });
});
