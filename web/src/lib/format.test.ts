import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCents,
  formatPercent,
  formatShares,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
} from "./format";

describe("format helpers", () => {
  it("formats USDT values consistently", () => {
    assert.equal(formatUsdt(10000), "10,000.00 USDT");
    assert.equal(formatSignedUsdt(12.5), "+12.50 USDT");
    assert.equal(formatSignedUsdt(-12.5), "-12.50 USDT");
  });

  it("formats probabilities and cents", () => {
    assert.equal(formatPercent(0.594), "59%");
    assert.equal(formatPercent(null), "--");
    assert.equal(formatSignedPercent(0.1234), "+12.34%");
    assert.equal(formatCents(0.004), "1¢");
    assert.equal(formatCents(null), "--");
  });

  it("formats shares with compact precision", () => {
    assert.equal(formatShares(169.491525), "169.49");
  });
});
