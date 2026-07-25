import assert from "node:assert/strict";
import test from "node:test";
import {
  ExchangeRateError,
  createCoinbaseExchangeRateProvider,
  validateUsdQuote,
} from "./exchangeRates.js";
import { usdtAtomic } from "./money.js";

test("Coinbase provider parses string rates without JavaScript number money math", async () => {
  const provider = createCoinbaseExchangeRateProvider({
    ttlSeconds: 30,
    requestTimeoutMs: 1_000,
    now: () => new Date("2026-07-25T12:00:00.000Z"),
    fetch: async () =>
      new Response(
        JSON.stringify({
          data: {
            currency: "USDT",
            rates: { USD: "0.9987654326" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  const quote = await provider.getUsdQuote({
    asset: "USDT",
    network: "TRON",
    amountUsdtAtomic: usdtAtomic(25_000_000n),
    purpose: "deposit_final",
  });

  assert.equal(quote.usdRateNanos, 998_765_433n);
  assert.equal(quote.rateDecimal, "0.998765433");
  assert.equal(quote.source, "coinbase-data-api");
  assert.equal(quote.kind, "final");
  assert.equal(quote.expiresAt, "2026-07-25T12:00:30.000Z");
});

test("Coinbase provider rejects malformed responses and stale expiry", async () => {
  const provider = createCoinbaseExchangeRateProvider({
    ttlSeconds: 30,
    requestTimeoutMs: 1_000,
    fetch: async () =>
      new Response(JSON.stringify({ data: { currency: "BTC", rates: { USD: "1" } } }), {
        status: 200,
      }),
  });

  await assert.rejects(
    provider.getUsdQuote({
      asset: "USDT",
      network: "TRON",
      amountUsdtAtomic: usdtAtomic(1n),
      purpose: "withdrawal_indicative",
    }),
    (error: unknown) =>
      error instanceof ExchangeRateError && error.code === "RATE_RESPONSE_INVALID",
  );

  assert.throws(
    () =>
      validateUsdQuote(
        {
          asset: "USDT",
          network: "TRON",
          amountUsdtAtomic: usdtAtomic(1n),
          usdRateNanos: 1_000_000_000n as never,
          rateDecimal: "1",
          source: "test",
          quotedAt: "2026-07-25T12:00:00.000Z",
          expiresAt: "2026-07-25T12:00:30.000Z",
          kind: "final",
          purpose: "deposit_final",
        },
        { ttlSeconds: 30, now: new Date("2026-07-25T12:00:30.000Z") },
      ),
    (error: unknown) => error instanceof ExchangeRateError && error.code === "RATE_STALE",
  );
});
