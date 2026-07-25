import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addCoinMicros,
  compareCoinMicros,
  formatAssetAmount,
  formatCoinMicros,
  formatCoins,
  formatChartPercent,
  formatCents,
  formatOutcomePercent,
  formatPercent,
  formatShares,
  formatSignedCoinMicros,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
  formatUsdReference,
  parseAssetInputToAtomic,
  parseCoinInputToMicros,
  parseSignedCoinInputToMicros,
} from "./format";

it("formats singular and plural Coins centrally", () => {
  assert.equal(formatCoins(1), "1.00 Coin");
  assert.equal(formatCoins(2), "2.00 Coins");
  assert.equal(formatCoins("0.000001"), "0.000001 Coins");
  assert.equal(formatCoinMicros("125470000"), "125.47 Coins");
  assert.equal(formatCoinMicros("1000000"), "1.00 Coin");
  assert.equal(
    formatCoinMicros("9007199254740993000000"),
    "9,007,199,254,740,993.00 Coins",
  );
  assert.equal(formatCoinMicros("-1000000"), "-1.00 Coin");
  assert.equal(formatCoinMicros("not-money"), "-- Coins");
  assert.equal(formatSignedCoinMicros("2500000"), "+2.50 Coins");
  assert.equal(formatSignedCoinMicros("-2500000"), "−2.50 Coins");
});

describe("format helpers", () => {
  it("parses Coin input without floating-point arithmetic", () => {
    assert.equal(parseCoinInputToMicros("12.345678"), "12345678");
    assert.equal(parseCoinInputToMicros("0.000001"), "1");
    assert.equal(parseCoinInputToMicros("0"), null);
    assert.equal(parseCoinInputToMicros("1.0000001"), null);
    assert.equal(parseCoinInputToMicros("1e3"), null);
    assert.equal(parseSignedCoinInputToMicros("-2.5"), "-2500000");
    assert.equal(parseSignedCoinInputToMicros("+2.5"), "2500000");
    assert.equal(parseAssetInputToAtomic("12.345678"), "12345678");
    assert.equal(parseAssetInputToAtomic("12.3456789"), null);
    assert.equal(compareCoinMicros("9007199254740993000000", "2"), 1);
    assert.equal(addCoinMicros("9007199254740993000000", "7"), "9007199254740993000007");
  });

  it("formats external assets and USD references separately from Coins", () => {
    assert.equal(formatAssetAmount("1234567", "USDT", { atomic: true }), "1.234567 USDT");
    assert.equal(formatAssetAmount("12.500000", "USDT"), "12.5 USDT");
    assert.equal(formatUsdReference("1034.5"), "1,034.50 USD");
  });

  it("formats USDT values consistently", () => {
    assert.equal(formatUsdt(10000), "10,000.00 USDT");
    assert.equal(formatSignedUsdt(12.5), "+12.50 USDT");
    assert.equal(formatSignedUsdt(-12.5), "-12.50 USDT");
  });

  it("formats outcome probabilities with enough precision for grouped totals", () => {
    assert.equal(formatOutcomePercent(0.72), "72%");
    assert.equal(formatOutcomePercent(0.125), "12.5%");
    assert.equal(formatOutcomePercent(0.03125), "3.1%");
    assert.equal(formatOutcomePercent(0.0066), "<1%");
    assert.equal(formatOutcomePercent(0), "0%");
    assert.equal(formatOutcomePercent(null), "--");

    assert.equal(formatPercent(0.594), "59.4%");
    assert.equal(formatPercent(0.03125), "3.1%");
    assert.equal(formatPercent(0.0066), "<1%");
    assert.equal(formatPercent(0), "0%");
    assert.equal(formatPercent(null), "--");
  });

  it("formats chart probabilities with Polymarket-style precision", () => {
    assert.equal(formatChartPercent(0.72), "72%");
    assert.equal(formatChartPercent(0.025), "2.5%");
    assert.equal(formatChartPercent(0.0066), "<1%");
    assert.equal(formatChartPercent(0), "0%");
    assert.equal(formatChartPercent(null), "--");
  });

  it("formats cents and signed percentages", () => {
    assert.equal(formatSignedPercent(0.1234), "+12.34%");
    assert.equal(formatCents(0.004), "1¢");
    assert.equal(formatCents(null), "--");
  });

  it("formats shares with compact precision", () => {
    assert.equal(formatShares(169.491525), "169.49");
  });
});
