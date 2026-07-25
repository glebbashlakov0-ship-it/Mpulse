import type { Portfolio, PortfolioSummary, TradingMode } from "./types";

export const LOCAL_SIMULATED_TRADING_MODE: TradingMode = {
  mode: "local_simulated",
  warning: "Coin trading remains local and review-only. No external funds are moved.",
  realMoneyEnabled: false,
  simulated: true,
  localSimulationEnabled: true,
  localSimulationBlockReason: null,
  balance: {
    asset: "COIN",
    initialCoinMicros: "0",
    simulatedCreditEnabled: false,
  },
  orders: {
    simulatedExecutionEnabled: true,
    realExecutionEnabled: false,
    blockReason: null,
  },
};

export function createInitialPortfolio(): Portfolio {
  const now = new Date().toISOString();
  const summary: PortfolioSummary = {
    availableCoinMicros: "0",
    reservedCoinMicros: "0",
    totalCoinMicros: "0",
    positionValueCoinMicros: "0",
    investedCoinMicros: "0",
    equityCoinMicros: "0",
    unrealizedPnlCoinMicros: "0",
    realizedPnlCoinMicros: "0",
    pnlCoinMicros: "0",
    pnlPercent: "0",
    openPositions: 0,
  };

  return {
    tradingMode: LOCAL_SIMULATED_TRADING_MODE,
    user: {
      id: "local-user",
      displayName: "Pulse Trader",
      createdAt: now,
    },
    wallet: {
      userId: "local-user",
      asset: "COIN",
      availableCoinMicros: "0",
      reservedCoinMicros: "0",
      totalCoinMicros: "0",
      initialCoinMicros: "0",
      updatedAt: now,
    },
    trades: [],
    positions: [],
    summary,
  };
}
