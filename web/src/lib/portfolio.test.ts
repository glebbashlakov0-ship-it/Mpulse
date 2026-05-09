import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInitialPortfolio } from "./portfolio";

describe("portfolio", () => {
  it("creates a safe empty local portfolio", () => {
    const portfolio = createInitialPortfolio();

    assert.equal(portfolio.wallet.balance, 10000);
    assert.equal(portfolio.wallet.asset, "USDT");
    assert.equal(portfolio.wallet.network, "TRON");
    assert.equal(portfolio.positions.length, 0);
    assert.equal(portfolio.trades.length, 0);
    assert.equal(portfolio.summary.equity, 10000);
  });
});
