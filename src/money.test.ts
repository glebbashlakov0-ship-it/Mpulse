import assert from "node:assert/strict";
import test from "node:test";
import {
  addCoins,
  calculateFee,
  coinMicros,
  coinMicrosToUsdt,
  formatAtomic,
  isQuoteStale,
  parseCoins,
  parseStoredDecimalToAtomic,
  parseUsdRate,
  parseUsdt,
  subtractCoins,
  usdtToCoinMicros,
} from "./money.js";

test("Coin decimal parsing and formatting preserve six decimals", () => {
  assert.equal(parseCoins("125.470001"), 125_470_001n);
  assert.equal(formatAtomic(parseCoins("1"), 6, 2), "1.00");
  assert.equal(formatAtomic(parseCoins("0.500000"), 6, 2), "0.50");
  assert.throws(() => parseCoins("1.0000001"), /at most 6/);
  assert.throws(() => parseCoins("-1"), /negative/);
});

test("stored decimals accept database scale padding without losing precision", () => {
  assert.equal(parseStoredDecimalToAtomic("10.0000000000", 6), 10_000_000n);
  assert.equal(parseStoredDecimalToAtomic("0.1234560000", 6), 123_456n);
  assert.throws(
    () => parseStoredDecimalToAtomic("0.1234560001", 6),
    /at most 6/,
  );
});

test("USDT atomic conversion and rate conversion use integer arithmetic", () => {
  const usdt = parseUsdt("125.600000");
  const rate = parseUsdRate("0.998965000");
  assert.equal(usdtToCoinMicros(usdt, rate), 125_470_004n);
  assert.equal(coinMicrosToUsdt(coinMicros(125_470_004n), rate), 125_600_000n);
});

test("Coin arithmetic rejects negative balances", () => {
  assert.equal(addCoins(coinMicros(2n), coinMicros(3n)), 5n);
  assert.equal(subtractCoins(coinMicros(3n), coinMicros(2n)), 1n);
  assert.throws(() => subtractCoins(coinMicros(2n), coinMicros(3n)), /negative/);
});

test("fees use explicit half/up rounding and minimum", () => {
  assert.equal(calculateFee(10_001n, 25n, 0n), 26n);
  assert.equal(calculateFee(100n, 1n, 5n), 5n);
});

test("quote expiration is deterministic", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");
  assert.equal(isQuoteStale("2026-07-25T11:59:31.000Z", 30, now), false);
  assert.equal(isQuoteStale("2026-07-25T11:59:29.000Z", 30, now), true);
  assert.equal(isQuoteStale("invalid", 30, now), true);
});
