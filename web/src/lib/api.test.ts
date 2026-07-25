import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptLegalAcknowledgements,
  createDepositIntent,
  createTradingQuoteApi,
  createWithdrawalQuote,
  createWithdrawalRequest,
  loadCoinBalance,
  loadCoinLedger,
  loadCurrentUser,
  loadComplianceEligibility,
  loadAdminMoneyDepositDetail,
  loadPlatformActivity,
  loadSupportedMoneyAssets,
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
  it("loads public activity as Coin micros without a USDT balance shape", async () => {
    await withLocalFetch(
      () =>
        Response.json({
          data: {
            activity: [
              {
                id: "activity-1",
                type: "trade",
                displayName: "Ma***",
                amountCoinMicros: "12500000",
                currency: "COIN",
                marketTitle: "Will this test pass?",
                createdAt: "2026-05-20T12:00:00.000Z",
                relativeTime: "just now",
              },
            ],
          },
        }),
      async (calls) => {
        const payload = await loadPlatformActivity(10);

        assert.equal(calls[0]?.input, "/api/platform/activity?limit=10");
        assert.equal(payload.activity[0]?.amountCoinMicros, "12500000");
        assert.equal(payload.activity[0]?.currency, "COIN");
      },
    );
  });

  it("loads immutable admin deposit evidence from the detail endpoint", async () => {
    await withLocalFetch(
      () =>
        Response.json({
          data: {
            deposit: {
              id: "deposit/one",
              provider: "fireblocks",
              providerEventId: "event-1",
              providerTransactionId: "provider-tx-1",
              blockchainTxHash: "0xabc",
              eventIndex: "7",
              network: "TRON",
              tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
              destinationAddress: "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK",
              depositIntentId: "intent-1",
              userId: "user-1",
              grossUsdtAtomic: "10000000",
              networkFeeUsdtAtomic: "100000",
              providerFeeUsdtAtomic: "50000",
              netUsdtAtomic: "9850000",
              rateSnapshotId: "rate-1",
              usdValueMicros: "9850000",
              creditedCoinMicros: "9850000",
              ledgerEntryId: "ledger-1",
              reversalLedgerEntryId: null,
              requiredConfirmations: "20",
              actualConfirmations: "20",
              status: "credited",
              manualReviewReason: null,
              detectedAt: "2026-05-06T00:00:00.000Z",
              confirmedAt: "2026-05-06T00:01:00.000Z",
              creditedAt: "2026-05-06T00:01:01.000Z",
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:01:01.000Z",
            },
            providerEvent: {
              id: "provider-record-1",
              provider: "fireblocks",
              providerEventId: "event-1",
              eventType: "TRANSACTION_STATUS_UPDATED",
              providerTransactionId: "provider-tx-1",
              payload: { id: "event-1" },
              payloadHash: "sha256-evidence",
              receivedAt: "2026-05-06T00:00:00.000Z",
            },
            rateSnapshot: {
              id: "rate-1",
              asset: "USDT",
              network: "TRON",
              quoteCurrency: "USD",
              rateNanos: "1000000000",
              rateDecimal: "1",
              source: "coinbase",
              kind: "final",
              purpose: "deposit_final",
              quotedAt: "2026-05-06T00:01:00.000Z",
              expiresAt: "2026-05-06T00:02:00.000Z",
              providerReference: null,
              createdAt: "2026-05-06T00:01:00.000Z",
            },
            ledgerEntry: { id: "ledger-1" },
            reversalLedgerEntry: null,
          },
        }),
      async (calls) => {
        const detail = await loadAdminMoneyDepositDetail("deposit/one");

        assert.equal(calls[0]?.input, "/api/admin/money/deposits/deposit%2Fone");
        assert.equal(calls[0]?.init?.credentials, "same-origin");
        assert.equal(detail.providerEvent?.payloadHash, "sha256-evidence");
        assert.equal(detail.rateSnapshot?.purpose, "deposit_final");
        assert.equal(detail.ledgerEntry?.id, "ledger-1");
      },
    );
  });

  it("creates backend trading quotes without an idempotency header", async () => {
    await withLocalFetch(
      () =>
        Response.json({
          data: {
            tradingMode: {
              mode: "local_simulated",
              warning: "Coin trading is review-only.",
              realMoneyEnabled: false,
              simulated: true,
              localSimulationEnabled: true,
              localSimulationBlockReason: null,
              balance: {
                asset: "COIN",
                initialCoinMicros: "10000000000",
                simulatedCreditEnabled: false,
              },
              orders: {
                simulatedExecutionEnabled: true,
                realExecutionEnabled: false,
                blockReason: null,
              },
            },
            id: "quote-1",
            marketId: "market-1",
            marketTitle: "Will this test pass?",
            side: "yes",
            action: "buy",
            price: "0.5",
            currentOdds: "0.5",
            shares: "122",
            amountCoinMicros: "61000000",
            stakeCoinMicros: "61000000",
            feeCoinMicros: "1220000",
            estimatedCostCoinMicros: "61000000",
            estimatedProceedsCoinMicros: "0",
            estimatedPayoutCoinMicros: "59780000",
            estimatedProfitCoinMicros: "-1220000",
            availableCoinMicros: "10000000000",
            balanceAfterCoinMicros: "9939000000",
            availableShares: "0",
            poolBeforeCoinMicros: "0",
            poolAfterCoinMicros: "61000000",
            outcomePoolBeforeCoinMicros: "0",
            outcomePoolAfterCoinMicros: "61000000",
            priceImpact: "0.5",
            nextOdds: "1",
            status: "quoted",
            createdAt: "2026-05-20T12:00:00.000Z",
          },
        }),
      async (calls) => {
        const quote = await createTradingQuoteApi({
          marketId: "market-1",
          side: "yes",
          action: "buy",
          amountCoinMicros: "61000000",
        });
        const call = calls[0];
        const body = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;

        assert.equal(call?.input, "/api/trading/quote");
        assert.equal(call?.init?.method, "POST");
        assert.equal(getHeader(call?.init, "Idempotency-Key"), null);
        assert.equal(body.marketId, "market-1");
        assert.equal(body.side, "yes");
        assert.equal(body.action, "buy");
        assert.equal(body.amountCoinMicros, "61000000");
        assert.equal(body.amount, undefined);
        assert.equal(quote.tradingMode.mode, "local_simulated");
        assert.equal(quote.tradingMode.realMoneyEnabled, false);
        assert.equal(quote.estimatedPayoutCoinMicros, "59780000");
        assert.equal(quote.balanceAfterCoinMicros, "9939000000");
      },
    );
  });

  it("creates withdrawal quotes and confirms requests with string money", async () => {
    await withLocalFetch(
      (input) =>
        Response.json(input.endsWith("/withdrawal-quotes") ? {
          data: {
            quote: {
              id: "quote-1",
              coinToDebitMicros: "15000000",
              grossUsdtAtomic: "14990000",
              estimatedUsdtAtomic: "14790000",
              networkFeeUsdtAtomic: "100000",
              providerFeeUsdtAtomic: "100000",
              rateSnapshot: {
                rateNanos: "1000667111",
                rateDecimal: "1.000667111",
                source: "test",
                quotedAt: "2026-05-06T00:00:00.000Z",
                expiresAt: "2026-05-06T00:01:00.000Z",
              },
              status: "open",
              expiresAt: "2026-05-06T00:01:00.000Z",
            },
          },
        } : {
          data: {
            idempotent: false,
            balance: {
              userId: "user-1",
              availableCoinMicros: "85000000",
              reservedCoinMicros: "15000000",
              totalCoinMicros: "100000000",
            },
            withdrawalRequest: {
              id: "withdrawal-1",
              userId: "user-1",
              asset: "USDT",
              network: "TRON",
              destinationAddress: "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK",
              withdrawalQuoteId: "quote-1",
              coinReservedMicros: "15000000",
              coinDebitedMicros: null,
              estimatedUsdtAtomic: "14790000",
              finalUsdtAtomic: null,
              networkFeeUsdtAtomic: "100000",
              providerFeeUsdtAtomic: "100000",
              status: "pending_review",
              idempotencyKey: "withdrawal-test-key",
              provider: "internal_wallet",
              fireblocksReference: null,
              realTransferBlocked: true,
              blockReason: "TRANSFERS_UNAVAILABLE",
              metadata: {},
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
            },
          },
        }),
      async (calls) => {
        const quote = await createWithdrawalQuote({
          coinAmountMicros: "15000000",
          destinationAddress: "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK",
          idempotencyKey: "withdrawal-quote-test-key",
        });
        await createWithdrawalRequest({
          quoteId: quote.quote.id,
          idempotencyKey: "withdrawal-test-key",
        });

        const quoteCall = calls[0];
        const quoteBody = JSON.parse(String(quoteCall?.init?.body)) as Record<string, unknown>;
        const requestCall = calls[1];
        const requestBody = JSON.parse(String(requestCall?.init?.body)) as Record<string, unknown>;

        assert.equal(quoteCall?.input, "/api/wallets/withdrawal-quotes");
        assert.equal(quoteBody.coinAmountMicros, "15000000");
        assert.equal(getHeader(quoteCall?.init, "Idempotency-Key"), "withdrawal-quote-test-key");
        assert.equal(requestCall?.input, "/api/wallets/withdrawal-requests");
        assert.equal(getHeader(requestCall?.init, "Idempotency-Key"), "withdrawal-test-key");
        assert.equal(requestBody.quoteId, "quote-1");
        assert.equal(requestBody.amount, undefined);
      },
    );
  });

  it("uses Coin endpoints and string micros for deposits and balances", async () => {
    await withLocalFetch(
      (input) => {
        if (input.startsWith("/api/coins/ledger")) {
          return Response.json({ data: { entries: [] } });
        }
        if (input === "/api/coins/balance") {
          return Response.json({
            data: {
              userId: "user-1",
              availableCoinMicros: "25000000",
              reservedCoinMicros: "0",
              totalCoinMicros: "25000000",
            },
          });
        }
        if (input === "/api/money/supported-assets") {
          return Response.json({
            data: {
              internalCurrency: {
                code: "COIN",
                name: "Coins",
                microsPerCoin: "1000000",
                usdParity: "1",
                blockchainAsset: false,
              },
              settlementAssets: [
                {
                  asset: "USDT",
                  network: "TRON",
                  rail: "TRC-20",
                  decimals: 6,
                  depositEnabled: false,
                  withdrawalEnabled: false,
                  reviewOnly: true,
                },
              ],
            },
          });
        }

        return Response.json({
          data: {
            depositIntent: {
              id: "intent-1",
              userId: "user-1",
              asset: "USDT",
              network: "TRON",
              address: "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK",
              expectedUsdtAtomic: "25000000",
              status: "waiting",
              expiresAt: "2026-05-06T00:30:00.000Z",
              createdAt: "2026-05-06T00:00:00.000Z",
            },
            instructions: {
              rail: "TRC-20",
              tokenContract: "TXYZ",
              address: "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK",
              requiredConfirmations: "20",
              doNotSubmitTransactionHash: true,
            },
            reviewOnly: true,
          },
        });
      },
      async (calls) => {
        await createDepositIntent({ expectedUsdtAtomic: "25000000", memo: "test" });
        await loadCoinLedger(25);
        const balance = await loadCoinBalance();
        const assets = await loadSupportedMoneyAssets();

        const depositBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;

        assert.equal(calls[0]?.input, "/api/wallets/deposit-intents");
        assert.equal(depositBody.expectedUsdtAtomic, "25000000");
        assert.equal(depositBody.memo, "test");
        assert.equal(depositBody.expectedAmount, undefined);
        assert.equal(calls[1]?.input, "/api/coins/ledger?limit=25");
        assert.equal(balance.availableCoinMicros, "25000000");
        assert.equal(assets.settlementAssets[0]?.depositEnabled, false);
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
