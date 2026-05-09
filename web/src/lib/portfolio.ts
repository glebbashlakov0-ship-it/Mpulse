import { INITIAL_MOCK_BALANCE } from "./constants";
import type { Portfolio, PortfolioSummary } from "./types";

export function createInitialPortfolio(): Portfolio {
  const now = new Date().toISOString();
  const summary: PortfolioSummary = {
    cash: INITIAL_MOCK_BALANCE,
    positionValue: 0,
    invested: 0,
    equity: INITIAL_MOCK_BALANCE,
    pnl: 0,
    pnlPercent: 0,
    openPositions: 0,
  };

  return {
    user: {
      id: "local-user",
      displayName: "Local Trader",
      createdAt: now,
    },
    wallet: {
      id: "local-user:wallet-usdt-tron",
      userId: "local-user",
      asset: "USDT",
      network: "TRON",
      balance: INITIAL_MOCK_BALANCE,
      initialBalance: INITIAL_MOCK_BALANCE,
      updatedAt: now,
    },
    trades: [],
    positions: [],
    summary,
  };
}
