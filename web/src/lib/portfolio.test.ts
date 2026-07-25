import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInitialPortfolio } from "./portfolio";

describe("portfolio", () => {
  it("creates a safe empty local portfolio", () => {
    const portfolio = createInitialPortfolio();

    assert.equal(portfolio.wallet.availableCoinMicros, "0");
    assert.equal(portfolio.wallet.reservedCoinMicros, "0");
    assert.equal(portfolio.tradingMode.mode, "local_simulated");
    assert.equal(portfolio.tradingMode.realMoneyEnabled, false);
    assert.equal(portfolio.tradingMode.simulated, true);
    assert.equal(portfolio.tradingMode.localSimulationEnabled, true);
    assert.equal(portfolio.tradingMode.balance.simulatedCreditEnabled, false);
    assert.equal(portfolio.tradingMode.orders.simulatedExecutionEnabled, true);
    assert.equal(portfolio.wallet.asset, "COIN");
    assert.equal(portfolio.positions.length, 0);
    assert.equal(portfolio.trades.length, 0);
    assert.equal(portfolio.summary.equityCoinMicros, "0");
  });
});
