import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent } from "./audit.js";
import type { NormalizedMarketDetail } from "./types.js";
import type {
  CoinBalance,
  CoinLedgerEntry,
  PostCoinEntryInput,
  PostgresCoinLedgerRepository,
} from "./coins.js";
import {
  calculateFee,
  coinMicros,
  formatAtomic,
  multiplyDivide,
  parseDecimalToAtomic,
  parseStoredDecimalToAtomic,
} from "./money.js";
import {
  CLOB_PRICE_DECIMALS,
  CLOB_SHARE_DECIMALS,
  clobDecimalToSdkNumber,
  clobSdkNumberToDecimal,
  coinMicrosToClobQuoteAmount,
  normalizeClobPrice,
  normalizeClobShares,
} from "./polymarketClient.js";
import type { CreateLedgerEntryInput, LedgerService } from "./ledger.js";
import {
  buildRealMoneyInfrastructure,
  REAL_MONEY_INFRASTRUCTURE_STATUS_VERIFIED,
  type RealMoneyInfrastructure,
} from "./moneyMovement.js";
import {
  buildRealMoneyLaunchApprovalCapabilities,
  type RealMoneyLaunchApprovalCapabilities,
} from "./realMoneyLaunchApproval.js";
import type {
  RealMoneyExecutionOrderResult,
  RealMoneyExecutionVenueRuntime,
} from "./realMoneyAdapterRuntime.js";
import type { VerifiedRealMoneyProviderAdapterRegistry } from "./realMoneyProviderAdapters.js";
import type {
  CoinTradeOrderRecord,
  FinalizeCoinTradeOrderInput,
  PortfolioRepository,
  PortfolioResetLedgerAdjustment,
  PositionDeleteRecord,
  PositionRecord,
  PositionWriteRecord,
  TradeRecord,
  TradeWriteRecord,
} from "./portfolioRepository.js";
import { PortfolioRepositoryError } from "./portfolioRepository.js";
import type { SettlementPayoutRecord } from "./settlement.js";
import { calculatePlatformFee, roundMoney } from "./tradingEconomics.js";

export const INITIAL_MOCK_BALANCE = 10_000;
export const TRADING_MODE_LOCAL_SIMULATED = "local_simulated" as const;
export const TRADING_MODE_REAL_MONEY = "real_money" as const;
export const TRADING_MODE_WARNING =
  "Trading uses the Coin ledger with simulated local execution; no external order is submitted.";
export const TRADING_MODE_REAL_MONEY_WARNING =
  "Trading is in real-money mode; local simulated balances and order fills are disabled.";
export const LOCAL_SIMULATED_TRADING_DISABLED_REASON =
  "LOCAL_SIMULATED_TRADING_DISABLED" as const;
export const LOCAL_SIMULATED_TRADING_PRODUCTION_DISABLED_REASON =
  "LOCAL_SIMULATED_TRADING_PRODUCTION_DISABLED" as const;
export const LOCAL_SIMULATED_TRADING_APP_MODE_DISABLED_REASON =
  "LOCAL_SIMULATED_TRADING_APP_MODE_DISABLED" as const;
export const REAL_TRADING_EXECUTION_HANDLER_REQUIRED_REASON =
  "REAL_TRADING_EXECUTION_HANDLER_REQUIRED" as const;

export type LocalSimulatedTradingBlockReason =
  | typeof LOCAL_SIMULATED_TRADING_DISABLED_REASON
  | typeof LOCAL_SIMULATED_TRADING_PRODUCTION_DISABLED_REASON
  | typeof LOCAL_SIMULATED_TRADING_APP_MODE_DISABLED_REASON;

export type RealTradingBlockReason =
  typeof REAL_TRADING_EXECUTION_HANDLER_REQUIRED_REASON;

export type TradingMode = {
  mode: typeof TRADING_MODE_LOCAL_SIMULATED | typeof TRADING_MODE_REAL_MONEY;
  warning: typeof TRADING_MODE_WARNING | typeof TRADING_MODE_REAL_MONEY_WARNING;
  realMoneyEnabled: boolean;
  simulated: boolean;
  localSimulationEnabled: boolean;
  localSimulationBlockReason: LocalSimulatedTradingBlockReason | null;
  balance: {
    asset: "COIN";
    initialCoinMicros: string;
    simulatedCreditEnabled: boolean;
  };
  orders: {
    simulatedExecutionEnabled: boolean;
    realExecutionEnabled: boolean;
    blockReason: LocalSimulatedTradingBlockReason | RealTradingBlockReason | null;
  };
  realMoneyInfrastructure: RealMoneyInfrastructure;
  launchApproval: RealMoneyLaunchApprovalCapabilities;
};

export type TradingModeReadinessBlockerCode =
  | "TRADING_MODE_SIMULATED_BALANCES"
  | "TRADING_MODE_SIMULATED_BALANCES_DISABLED"
  | "TRADING_EXECUTION_UNAVAILABLE"
  | "TRADING_EXECUTION_SIMULATED"
  | "TRADING_EXECUTION_HANDLER_REQUIRED";

export type TradingModeReadinessBlocker = {
  source: "trading";
  code: TradingModeReadinessBlockerCode;
  message: string;
};

type TradingModeConfig = {
  appMode?: string;
  nodeEnv?: string;
  productionDeployment?: boolean;
  coinInternalTradingEnabled?: boolean;
  localSimulatedTradingEnabled?: boolean;
  realMoneyCustodyProvider?: string | null;
  realMoneyDepositProvider?: string | null;
  realMoneyWithdrawalProvider?: string | null;
  realMoneyExecutionProvider?: string | null;
  realMoneyReconciliationProvider?: string | null;
  realMoneyAccountRiskProvider?: string | null;
  realMoneySanctionsProvider?: string | null;
  realMoneyLedgerSettlementReconciliationConfigured?: boolean;
  realMoneyOperationsMonitoringConfigured?: boolean;
  verifiedRealMoneyProviderAdapters?: VerifiedRealMoneyProviderAdapterRegistry;
  realMoneyLaunchApprovalRef?: string | null;
  realMoneyLaunchApprovalArtifactApproved?: boolean | null;
};

function createLocalSimulatedTradingMode(
  blockReason: LocalSimulatedTradingBlockReason | null,
  realMoneyInfrastructure: RealMoneyInfrastructure,
  launchApproval: RealMoneyLaunchApprovalCapabilities,
): TradingMode {
  const localSimulationEnabled = blockReason === null;

  return {
    mode: TRADING_MODE_LOCAL_SIMULATED,
    warning: TRADING_MODE_WARNING,
    realMoneyEnabled: false,
    simulated: true,
    localSimulationEnabled,
    localSimulationBlockReason: blockReason,
    balance: {
      asset: "COIN",
      initialCoinMicros: "0",
      simulatedCreditEnabled: false,
    },
    orders: {
      simulatedExecutionEnabled: localSimulationEnabled,
      realExecutionEnabled: false,
      blockReason,
    },
    realMoneyInfrastructure,
    launchApproval,
  };
}

function createRealMoneyTradingMode(
  realMoneyInfrastructure: RealMoneyInfrastructure,
  launchApproval: RealMoneyLaunchApprovalCapabilities,
): TradingMode {
  return {
    mode: TRADING_MODE_REAL_MONEY,
    warning: TRADING_MODE_REAL_MONEY_WARNING,
    realMoneyEnabled: true,
    simulated: false,
    localSimulationEnabled: false,
    localSimulationBlockReason: LOCAL_SIMULATED_TRADING_APP_MODE_DISABLED_REASON,
    balance: {
      asset: "COIN",
      initialCoinMicros: "0",
      simulatedCreditEnabled: false,
    },
    orders: {
      simulatedExecutionEnabled: false,
      realExecutionEnabled: true,
      blockReason: null,
    },
    realMoneyInfrastructure,
    launchApproval,
  };
}

const UNAPPROVED_REAL_MONEY_LAUNCH =
  buildRealMoneyLaunchApprovalCapabilities({});

export const LOCAL_SIMULATED_TRADING_MODE = createLocalSimulatedTradingMode(
  null,
  buildRealMoneyInfrastructure(),
  UNAPPROVED_REAL_MONEY_LAUNCH,
);

export type TradeSide = "yes" | "no";
export type TradeAction = "buy" | "sell";

export type LocalUser = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type Trade = {
  id: string;
  userId: string;
  walletId: string;
  marketId: string;
  marketTitle: string;
  side: TradeSide;
  action: TradeAction;
  amount: number;
  stakeAmount?: number;
  platformFee?: number;
  price: number;
  shares: number;
  realizedPnl: number | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type LocalPosition = {
  id: string;
  userId: string;
  marketId: string;
  marketTitle: string;
  yesShares: number;
  noShares: number;
  yesCost: number;
  noCost: number;
  totalCost: number;
  lastYesPrice: number | null;
  lastNoPrice: number | null;
  currentValue: number;
  pnl: number;
  lastTradeAt: string;
};

export type PortfolioSummary = {
  cash: number;
  heldBalance: number;
  positionValue: number;
  invested: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  pnl: number;
  pnlPercent: number;
  openPositions: number;
};

export type SettlementHistoryItem = {
  id: string;
  marketId: string | null;
  settlementId: string | null;
  side: TradeSide | null;
  originalStake: number;
  payout: number;
  profit: number;
  kind: string | null;
  createdAt: string;
};

export type PortfolioResponse = {
  tradingMode: TradingMode;
  user: LocalUser;
  wallet: { balance: number };
  positions: LocalPosition[];
  trades: Trade[];
  settlements: SettlementHistoryItem[];
  summary: PortfolioSummary;
};

export type CoinTradingPosition = {
  id: string;
  userId: string;
  marketId: string;
  marketTitle: string;
  yesShares: string;
  noShares: string;
  yesCostCoinMicros: string;
  noCostCoinMicros: string;
  totalCostCoinMicros: string;
  averagePrice: string;
  currentPrice: string;
  lastYesPrice: string | null;
  lastNoPrice: string | null;
  currentValueCoinMicros: string;
  pnlCoinMicros: string;
  lastTradeAt: string;
};

export type CoinTrade = {
  id: string;
  executionOrderId: string | null;
  userId: string;
  marketId: string;
  marketTitle: string;
  side: TradeSide;
  action: TradeAction;
  amountCoinMicros: string;
  stakeCoinMicros: string;
  feeCoinMicros: string;
  price: string;
  shares: string;
  realizedPnlCoinMicros: string | null;
  status: "filled" | "partially_filled";
  providerOrderId: string | null;
  providerTradeId: string | null;
  idempotencyKey: string;
  createdAt: string;
};

export type CoinSettlementHistoryItem = {
  id: string;
  marketId: string | null;
  settlementId: string | null;
  side: TradeSide | null;
  originalStakeCoinMicros: string;
  payoutCoinMicros: string;
  profitCoinMicros: string;
  kind: string | null;
  createdAt: string;
};

export type CoinPortfolioSummary = {
  availableCoinMicros: string;
  reservedCoinMicros: string;
  totalCoinMicros: string;
  positionValueCoinMicros: string;
  investedCoinMicros: string;
  equityCoinMicros: string;
  unrealizedPnlCoinMicros: string;
  realizedPnlCoinMicros: string;
  pnlCoinMicros: string;
  pnlPercent: string | null;
  openPositions: number;
};

export type CoinPortfolioResponse = {
  tradingMode: TradingMode;
  user: LocalUser;
  wallet: {
    availableCoinMicros: string;
    reservedCoinMicros: string;
    totalCoinMicros: string;
  };
  positions: CoinTradingPosition[];
  trades: CoinTrade[];
  settlements: CoinSettlementHistoryItem[];
  summary: CoinPortfolioSummary;
};

export type CoinTradingQuote = {
  tradingMode: TradingMode;
  id: string;
  marketId: string;
  marketTitle: string;
  side: TradeSide;
  action: TradeAction;
  price: string;
  shares: string;
  amountCoinMicros: string;
  stakeCoinMicros: string;
  feeCoinMicros: string;
  estimatedCostCoinMicros: string;
  estimatedProceedsCoinMicros: string;
  estimatedPayoutCoinMicros: string;
  estimatedProfitCoinMicros: string;
  availableCoinMicros: string;
  balanceAfterCoinMicros: string;
  availableShares: string;
  status: "quoted";
  createdAt: string;
};

export type CoinTradingQuoteInput = {
  market: NormalizedMarketDetail;
  side: TradeSide;
  action: TradeAction;
  amountCoinMicros?: string;
  shares?: string;
  userId: string;
  tradingMode: TradingMode;
  coinLedger: CoinLedgerPort;
  portfolioRepository: PortfolioRepository;
  settlementRepository?: SettlementHistoryRepository;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type CoinTradingOrderInput = CoinTradingQuoteInput & {
  idempotencyKey: string;
  realExecutionRuntime?: RealMoneyExecutionVenueRuntime | null;
  audit?: {
    sessionId?: string | null;
    metadata?: Record<string, unknown>;
  } | null;
};

export type CoinTradingOrderSuccess = {
  ok: true;
  quote: CoinTradingQuote;
  trade: CoinTrade;
  portfolio: CoinPortfolioResponse;
  idempotent: boolean;
  orderStatus: CoinTradeOrderRecord["status"];
};

export type CoinLedgerPort = Pick<
  PostgresCoinLedgerRepository,
  "getBalance" | "listEntries" | "postEntry"
>;

export type PortfolioMarketResolver = (
  marketId: string,
) => Promise<NormalizedMarketDetail | null | undefined>;

type PlaceTradeInput = {
  market: NormalizedMarketDetail;
  side: TradeSide;
  amount: number;
  userId?: string;
  tradingMode?: TradingMode;
  ledger: LedgerService;
  portfolioRepository?: PortfolioRepository;
};

export type TradingQuoteInput = {
  market: NormalizedMarketDetail;
  side: TradeSide;
  action: TradeAction;
  amount?: number;
  shares?: number;
  userId?: string;
  tradingMode?: TradingMode;
  ledger: LedgerService;
  portfolioRepository?: PortfolioRepository;
  settlementRepository?: SettlementHistoryRepository;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type TradingOrderInput = TradingQuoteInput & {
  idempotencyKey?: string | null;
  requireAtomicTradeCommits?: boolean;
  realExecutionRuntime?: RealMoneyExecutionVenueRuntime | null;
  audit?: {
    sessionId?: string | null;
    metadata?: Record<string, unknown>;
  } | null;
};

export type TradingQuote = {
  tradingMode: TradingMode;
  id: string;
  marketId: string;
  marketTitle: string;
  side: TradeSide;
  action: TradeAction;
  price: number;
  currentOdds: number;
  shares: number;
  amount: number;
  stakeAmount: number;
  platformFee: number;
  fee: number;
  estimatedCost: number;
  estimatedProceeds: number;
  estimatedPayout: number;
  estimatedProfit: number;
  availableCash: number;
  balanceAfterBet: number;
  availableShares: number;
  poolBefore: number;
  poolAfter: number;
  outcomePoolBefore: number;
  outcomePoolAfter: number;
  priceImpact: number;
  nextOdds: number;
  status: "quoted";
  createdAt: string;
};

type TradingErrorCode =
  | "TRADING_UNAVAILABLE"
  | "MARKET_NOT_TRADABLE"
  | "MARKET_CLOSED"
  | "PRICE_UNAVAILABLE"
  | "TRADING_EXECUTION_ADAPTER_UNAVAILABLE"
  | "TRADING_EXECUTION_REJECTED"
  | "INVALID_AMOUNT"
  | "ORDER_AMOUNT_OUT_OF_RANGE"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_SHARES"
  | "TRADE_ATOMIC_COMMIT_REQUIRED"
  | "INVALID_CREATED_AT"
  | "COIN_LEDGER_UNAVAILABLE"
  | "INVALID_COIN_AMOUNT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "EXECUTION_RECONCILIATION_REQUIRED"
  | "TRADING_ORDER_STATE_CONFLICT";

type TradingError = {
  ok: false;
  code: TradingErrorCode;
  message: string;
};

export class TradingPolicyError extends Error {
  readonly code: "TRADING_UNAVAILABLE";
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "TradingPolicyError";
    this.code = "TRADING_UNAVAILABLE";
  }
}

class CoinExecutionReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoinExecutionReconciliationError";
  }
}

type TradingOrderSuccess = {
  ok: true;
  quote: TradingQuote;
  trade: Trade;
  portfolio: PortfolioResponse;
  idempotent: boolean;
  internal?: {
    tradeAuditCommitted: boolean;
  };
};

type SettlementHistoryRepository = {
  listPayoutsByUserId?(userId: string, limit?: number): Promise<SettlementPayoutRecord[]>;
};

const DEMO_USER_ID = "local-user";
const MIN_ORDER_AMOUNT = 1;
const MAX_ORDER_AMOUNT = 100_000;

export function buildTradingMode(config: TradingModeConfig = {}): TradingMode {
  const realMoneyInfrastructure = buildRealMoneyInfrastructure(config);
  const launchApproval = buildRealMoneyLaunchApprovalCapabilities(config);

  if (
    isRealMoneyTradingRuntimeEnabled(
      config,
      realMoneyInfrastructure,
      launchApproval,
    )
  ) {
    return createRealMoneyTradingMode(realMoneyInfrastructure, launchApproval);
  }

  return createLocalSimulatedTradingMode(
    getLocalSimulatedTradingBlockReason(config),
    realMoneyInfrastructure,
    launchApproval,
  );
}

export function getTradingMode(config: TradingModeConfig = {}) {
  return buildTradingMode(config);
}

function getLocalSimulatedTradingBlockReason(
  config: TradingModeConfig,
): LocalSimulatedTradingBlockReason | null {
  if (
    config.coinInternalTradingEnabled === false ||
    config.localSimulatedTradingEnabled === false
  ) {
    return LOCAL_SIMULATED_TRADING_DISABLED_REASON;
  }

  if (
    (config.productionDeployment || config.nodeEnv === "production") &&
    config.coinInternalTradingEnabled !== true
  ) {
    return LOCAL_SIMULATED_TRADING_PRODUCTION_DISABLED_REASON;
  }

  if (config.appMode && config.appMode !== "local") {
    return LOCAL_SIMULATED_TRADING_APP_MODE_DISABLED_REASON;
  }

  return null;
}

function isRealMoneyTradingRuntimeEnabled(
  config: TradingModeConfig,
  infrastructure: RealMoneyInfrastructure,
  launchApproval: RealMoneyLaunchApprovalCapabilities,
) {
  return (
    config.appMode === TRADING_MODE_REAL_MONEY &&
    config.nodeEnv === "production" &&
    config.productionDeployment === true &&
    infrastructure.status === REAL_MONEY_INFRASTRUCTURE_STATUS_VERIFIED &&
    launchApproval.approved
  );
}

function buildTradingUnavailableError(tradingMode: TradingMode): TradingError {
  const reason =
    tradingMode.localSimulationBlockReason ??
    tradingMode.orders.blockReason ??
    LOCAL_SIMULATED_TRADING_DISABLED_REASON;

  return {
    ok: false,
    code: "TRADING_UNAVAILABLE",
    message:
      reason === LOCAL_SIMULATED_TRADING_PRODUCTION_DISABLED_REASON
        ? "Local simulated trading is disabled in production."
        : "Trading is unavailable in this environment.",
  };
}

function assertLocalSimulatedTradingEnabled(tradingMode: TradingMode) {
  if (!tradingMode.localSimulationEnabled || !tradingMode.orders.simulatedExecutionEnabled) {
    throw new TradingPolicyError(buildTradingUnavailableError(tradingMode).message);
  }
}

export function getTradingModeReadinessBlockers(
  tradingMode: TradingMode = LOCAL_SIMULATED_TRADING_MODE,
) {
  return getTradingModeReadinessBlockerDetails(tradingMode).map(
    (blocker) => blocker.message,
  );
}

export function getTradingModeReadinessBlockerDetails(
  tradingMode: TradingMode = LOCAL_SIMULATED_TRADING_MODE,
): TradingModeReadinessBlocker[] {
  const blockers: TradingModeReadinessBlocker[] = [];

  if (!tradingMode.realMoneyEnabled) {
    blockers.push({
      source: "trading",
      code: tradingMode.balance.simulatedCreditEnabled
        ? "TRADING_MODE_SIMULATED_BALANCES"
        : "TRADING_MODE_SIMULATED_BALANCES_DISABLED",
      message: tradingMode.balance.simulatedCreditEnabled
        ? "Trading uses local simulated USDT balances instead of real funds."
        : "Trading has no real funds and local simulated balances are disabled by runtime policy.",
    });
  }
  if (!tradingMode.orders.realExecutionEnabled) {
    blockers.push({
      source: "trading",
      code:
        tradingMode.orders.blockReason === REAL_TRADING_EXECUTION_HANDLER_REQUIRED_REASON
          ? "TRADING_EXECUTION_HANDLER_REQUIRED"
          : tradingMode.orders.simulatedExecutionEnabled
            ? "TRADING_EXECUTION_SIMULATED"
            : "TRADING_EXECUTION_UNAVAILABLE",
      message:
        tradingMode.orders.blockReason === REAL_TRADING_EXECUTION_HANDLER_REQUIRED_REASON
          ? "Verified execution infrastructure exists, but order placement is not wired to a reviewed execution adapter."
          : tradingMode.orders.simulatedExecutionEnabled
            ? "Orders are filled by the local simulator; no exchange or custody settlement exists."
            : "No real execution venue is configured, and local simulated execution is disabled by runtime policy.",
    });
  }

  return blockers;
}

type PortfolioState = {
  user: LocalUser;
  positions: LocalPosition[];
  trades: Trade[];
  idempotencyResults: Map<string, TradingOrderSuccess>;
};

const portfoliosByUserId = new Map<string, PortfolioState>();

function getWalletId(userId: string) {
  return `${userId}:wallet-usdt-tron`;
}

function createInitialState(userId = DEMO_USER_ID): PortfolioState {
  const now = new Date().toISOString();

  return {
    user: {
      id: userId,
      displayName: "Pulse Trader",
      createdAt: now,
    },
    positions: [],
    trades: [],
    idempotencyResults: new Map(),
  };
}

function getState(userId = DEMO_USER_ID) {
  const existing = portfoliosByUserId.get(userId);
  if (existing) {
    return existing;
  }

  const state = createInitialState(userId);
  portfoliosByUserId.set(userId, state);
  return state;
}

async function getTradingState(
  userId: string,
  portfolioRepository?: PortfolioRepository,
): Promise<PortfolioState> {
  if (!portfolioRepository) {
    return getState(userId);
  }

  const [positionRows, tradeRows] = await Promise.all([
    portfolioRepository.getPositionsByUserId(userId),
    portfolioRepository.getTradesByUserId(userId, 200),
  ]);
  const positions = mergePositionRows(positionRows);
  const marketTitles = new Map(
    positions.map((position) => [position.marketId, position.marketTitle]),
  );

  return {
    user: createInitialState(userId).user,
    positions,
    trades: tradeRows.map((trade) => mapTradeRecord(trade, marketTitles.get(trade.marketId))),
    idempotencyResults: new Map(),
  };
}

async function ensureLocalBalance(userId: string, ledger: LedgerService) {
  const balance = await ledger.getBalance({
    userId,
    asset: "USDT",
    walletId: null,
  });

  if (balance.availableBalance !== 0 || balance.totalCredited !== 0) {
    return balance;
  }

  await ledger.createEntry({
    userId,
    walletId: null,
    asset: "USDT",
    entryType: "credit",
    amount: INITIAL_MOCK_BALANCE,
    reason: "Initial trading balance",
    referenceType: "local_init",
    referenceId: userId,
    idempotencyKey: `local-init:${userId}`,
    metadata: {
      initialBalance: INITIAL_MOCK_BALANCE,
    },
  });

  return ledger.getBalance({
    userId,
    asset: "USDT",
    walletId: null,
  });
}

async function getTradingBalance(
  userId: string,
  ledger: LedgerService,
  tradingMode: TradingMode,
) {
  if (tradingMode.balance.simulatedCreditEnabled) {
    return ensureLocalBalance(userId, ledger);
  }

  return ledger.getBalance({
    userId,
    asset: "USDT",
    walletId: null,
  });
}

function getOutcomePrice(market: NormalizedMarketDetail, side: TradeSide) {
  return (
    market.outcomes.find((outcome) => outcome.name.toLowerCase() === side)?.price ??
    market.prices[side] ??
    null
  );
}

function getPositionShares(position: LocalPosition) {
  return position.yesShares + position.noShares;
}

function getAveragePositionPrice(position: LocalPosition) {
  const shares = getPositionShares(position);

  return shares > 0 ? position.totalCost / shares : 0;
}

function getPositionValue(position: LocalPosition) {
  const fallbackPrice = getAveragePositionPrice(position);
  const yesPrice = position.lastYesPrice ?? fallbackPrice;
  const noPrice = position.lastNoPrice ?? fallbackPrice;

  return position.yesShares * yesPrice + position.noShares * noPrice;
}

function withComputedPosition(position: LocalPosition): LocalPosition {
  const totalCost = position.yesCost + position.noCost;
  const currentValue = getPositionValue({ ...position, totalCost });

  return {
    ...position,
    totalCost,
    currentValue,
    pnl: currentValue - totalCost,
  };
}

async function revaluePortfolioPositions(
  positions: LocalPosition[],
  marketResolver?: PortfolioMarketResolver,
) {
  if (!marketResolver || positions.length === 0) {
    return positions.map(withComputedPosition);
  }

  const marketIds = [...new Set(positions.map((position) => position.marketId))];
  const results = await Promise.allSettled(
    marketIds.map((marketId) => marketResolver(marketId)),
  );
  const markets = new Map<string, NormalizedMarketDetail>();

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const marketId = marketIds[index];

    if (result?.status === "fulfilled" && result.value && marketId) {
      markets.set(marketId, result.value);
    }
  }

  return positions.map((position) => {
    const market = markets.get(position.marketId);
    if (!market) {
      return withComputedPosition(position);
    }

    const yesPrice = getOutcomePrice(market, "yes");
    const noPrice = getOutcomePrice(market, "no");

    return withComputedPosition({
      ...position,
      marketTitle: market.title || position.marketTitle,
      lastYesPrice:
        yesPrice !== null && Number.isFinite(yesPrice) && yesPrice >= 0 && yesPrice <= 1
          ? yesPrice
          : position.lastYesPrice,
      lastNoPrice:
        noPrice !== null && Number.isFinite(noPrice) && noPrice >= 0 && noPrice <= 1
          ? noPrice
          : position.lastNoPrice,
    });
  });
}

function getSideShares(position: LocalPosition | undefined, side: TradeSide) {
  if (!position) {
    return 0;
  }

  return side === "yes" ? position.yesShares : position.noShares;
}

function getSideCost(position: LocalPosition, side: TradeSide) {
  return side === "yes" ? position.yesCost : position.noCost;
}

function isMarketTradable(market: NormalizedMarketDetail) {
  return (
    market.active &&
    !market.closed &&
    !market.archived &&
    market.dates.status !== "closed" &&
    market.dates.status !== "expired" &&
    !hasMarketCloseTimePassed(market)
  );
}

function hasMarketCloseTimePassed(market: NormalizedMarketDetail) {
  const endsAtMs = market.dates.ends_at_ms;

  return endsAtMs !== null && Number.isFinite(endsAtMs) && endsAtMs <= Date.now();
}

function normalizePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeCreatedAt(value: string | undefined) {
  if (value === undefined) {
    return new Date().toISOString();
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeTradeMetadata(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function buildPoolQuote({
  market,
  side,
  action,
  stakeAmount,
  currentOdds,
}: {
  market: NormalizedMarketDetail;
  side: TradeSide;
  action: TradeAction;
  stakeAmount: number;
  currentOdds: number;
}) {
  const poolBefore = Math.max(0, market.volume_detail?.liquidity ?? market.liquidity ?? 0);
  const outcomePoolBefore = poolBefore > 0 ? poolBefore * currentOdds : 0;
  const poolAfter =
    action === "buy"
      ? poolBefore + stakeAmount
      : Math.max(0, poolBefore - stakeAmount);
  const outcomePoolAfter =
    action === "buy"
      ? outcomePoolBefore + stakeAmount
      : Math.max(0, outcomePoolBefore - stakeAmount);
  const nextOdds =
    poolAfter > 0
      ? Math.min(1, Math.max(0, outcomePoolAfter / poolAfter))
      : currentOdds;
  const platformFee = calculatePlatformFee(poolAfter);
  const distributablePool = Math.max(0, poolAfter - platformFee);
  const estimatedPayout =
    action === "buy" && outcomePoolAfter > 0
      ? roundMoney((stakeAmount / outcomePoolAfter) * distributablePool)
      : action === "sell"
        ? roundMoney(stakeAmount)
        : 0;
  const estimatedProfit =
    action === "buy"
      ? roundMoney(estimatedPayout - stakeAmount)
      : 0;

  return {
    side,
    poolBefore: roundMoney(poolBefore),
    poolAfter: roundMoney(poolAfter),
    outcomePoolBefore: roundMoney(outcomePoolBefore),
    outcomePoolAfter: roundMoney(outcomePoolAfter),
    priceImpact: nextOdds - currentOdds,
    nextOdds,
    estimatedPayout,
    estimatedProfit,
  };
}

async function getPortfolioSummary(
  state: PortfolioState,
  ledger: LedgerService,
  userId: string,
  settlements: SettlementHistoryItem[],
): Promise<PortfolioSummary> {
  const positions = state.positions.map(withComputedPosition);
  const positionValue = positions.reduce(
    (total, position) => total + getPositionValue(position),
    0,
  );
  const invested = positions.reduce((total, position) => total + position.totalCost, 0);
  
  const balance = await ledger.getBalance({
    userId,
    asset: "USDT",
    walletId: null,
  });
  const cash = balance.availableBalance;
  const ledgerHeldBalance = Math.max(0, balance.totalHeld - balance.totalReleased);
  const heldBalance = roundMoney(ledgerHeldBalance + invested);
  const equity = cash + positionValue;
  const unrealizedPnl = positionValue - invested;
  const realizedPnl =
    state.trades.reduce((total, trade) => total + (trade.realizedPnl ?? 0), 0) +
    settlements.reduce((total, settlement) => total + settlement.profit, 0);
  const pnl = unrealizedPnl + realizedPnl;

  return {
    cash,
    heldBalance,
    positionValue,
    invested,
    equity,
    unrealizedPnl,
    realizedPnl,
    pnl,
    pnlPercent: invested > 0 ? pnl / invested : 0,
    openPositions: state.positions.length,
  };
}

export async function getPortfolio(
  userId = DEMO_USER_ID,
  ledger: LedgerService,
  portfolioRepository?: PortfolioRepository,
  settlementRepository?: SettlementHistoryRepository,
  tradingMode: TradingMode = LOCAL_SIMULATED_TRADING_MODE,
  marketResolver?: PortfolioMarketResolver,
): Promise<PortfolioResponse> {
  const state = await getTradingState(userId, portfolioRepository);
  const positions = await revaluePortfolioPositions(state.positions, marketResolver);
  const revaluedState = {
    ...state,
    positions,
  };
  const balance = await getTradingBalance(userId, ledger, tradingMode);
  const settlements = await getSettlementHistory(userId, ledger, settlementRepository);

  return {
    tradingMode,
    user: state.user,
    wallet: { balance: balance.availableBalance },
    positions,
    trades: state.trades,
    settlements,
    summary: await getPortfolioSummary(revaluedState, ledger, userId, settlements),
  };
}

export async function resetPortfolio(
  userId = DEMO_USER_ID,
  ledger: LedgerService,
  portfolioRepository?: PortfolioRepository,
  settlementRepository?: SettlementHistoryRepository,
  tradingMode: TradingMode = LOCAL_SIMULATED_TRADING_MODE,
): Promise<PortfolioResponse> {
  assertLocalSimulatedTradingEnabled(tradingMode);

  const ledgerAdjustment = buildPortfolioResetLedgerAdjustment(userId);

  if (portfolioRepository?.commitPortfolioReset) {
    await portfolioRepository.commitPortfolioReset({ userId, ledgerAdjustment });
    return getPortfolio(userId, ledger, portfolioRepository, settlementRepository, tradingMode);
  }

  portfoliosByUserId.set(userId, createInitialState(userId));
  await portfolioRepository?.clearUserPortfolio(userId);

  const balance = await ledger.getBalance({
    userId,
    asset: "USDT",
    walletId: null,
  });
  const ledgerEntry = buildPortfolioResetLedgerEntry(
    userId,
    ledgerAdjustment,
    balance.availableBalance,
  );

  if (ledgerEntry) {
    await ledger.createEntry(ledgerEntry);
  }

  return getPortfolio(userId, ledger, portfolioRepository, settlementRepository, tradingMode);
}

function buildPortfolioResetLedgerAdjustment(userId: string): PortfolioResetLedgerAdjustment {
  return {
    asset: "USDT",
    walletId: null,
    targetAvailableBalance: INITIAL_MOCK_BALANCE,
    reason: "Pulse Market portfolio reset",
    referenceType: "local_reset",
    referenceId: userId,
    idempotencyKey: `local-reset:${userId}:${Date.now()}`,
    metadata: {},
  };
}

function buildPortfolioResetLedgerEntry(
  userId: string,
  adjustment: PortfolioResetLedgerAdjustment,
  previousAvailableBalance: number,
): CreateLedgerEntryInput | null {
  const delta = roundMoney(adjustment.targetAvailableBalance - previousAvailableBalance);

  if (delta === 0) {
    return null;
  }

  return {
    userId,
    walletId: adjustment.walletId ?? null,
    asset: adjustment.asset ?? "USDT",
    entryType: delta > 0 ? "credit" : "debit",
    amount: Math.abs(delta),
    reason: adjustment.reason,
    referenceType: adjustment.referenceType,
    referenceId: adjustment.referenceId,
    idempotencyKey: adjustment.idempotencyKey,
    metadata: {
      ...adjustment.metadata,
      resetBalance: adjustment.targetAvailableBalance,
      previousBalance: previousAvailableBalance,
    },
  };
}

async function getSettlementHistory(
  userId: string,
  ledger: LedgerService,
  settlementRepository?: SettlementHistoryRepository,
) {
  const payoutRows = await settlementRepository?.listPayoutsByUserId?.(userId, 200);

  if (payoutRows) {
    return payoutRows.map((payout) => ({
      id: payout.id,
      marketId: payout.marketId,
      settlementId: payout.settlementId,
      side: payout.side,
      originalStake: payout.originalStake,
      payout: payout.payout,
      profit: payout.profit,
      kind: payout.kind,
      createdAt: payout.createdAt,
    }));
  }

  const entries = await ledger
    .listEntries({
      userId,
      asset: "USDT",
      walletId: null,
      limit: 200,
    })
    .catch(() => []);

  return entries
    .filter((entry) => entry.referenceType === "market_settlement")
    .map((entry) => {
      const metadata = entry.metadata;

      return {
        id: entry.id,
        marketId: typeof metadata.marketId === "string" ? metadata.marketId : null,
        settlementId:
          typeof metadata.settlementId === "string"
            ? metadata.settlementId
            : entry.referenceId,
        side: metadata.side === "yes" || metadata.side === "no" ? metadata.side : null,
        originalStake: toMetadataNumber(metadata.originalStake),
        payout: toMetadataNumber(metadata.payout) || entry.amount,
        profit: toMetadataNumber(metadata.profit),
        kind: typeof metadata.kind === "string" ? metadata.kind : null,
        createdAt: entry.createdAt,
      } satisfies SettlementHistoryItem;
    });
}

function toMetadataNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function createTradingQuote({
  market,
  side,
  action,
  amount,
  shares,
  userId = DEMO_USER_ID,
  tradingMode = LOCAL_SIMULATED_TRADING_MODE,
  ledger,
  portfolioRepository,
  createdAt,
}: TradingQuoteInput): Promise<{ ok: true; quote: TradingQuote } | TradingError> {
  const quoteCreatedAt = normalizeCreatedAt(createdAt);

  if (!quoteCreatedAt) {
    return {
      ok: false,
      code: "INVALID_CREATED_AT",
      message: "createdAt must be a valid ISO date string.",
    };
  }

  if (!tradingMode.orders.simulatedExecutionEnabled && !tradingMode.orders.realExecutionEnabled) {
    return buildTradingUnavailableError(tradingMode);
  }

  const state = await getTradingState(userId, portfolioRepository);

  if (hasMarketCloseTimePassed(market)) {
    return {
      ok: false,
      code: "MARKET_CLOSED",
      message: "This market is already closed for Pulse Market trading.",
    };
  }

  if (!isMarketTradable(market)) {
    return {
      ok: false,
      code: "MARKET_NOT_TRADABLE",
      message: "This market is not accepting Pulse Market trades.",
    };
  }

  const price = getOutcomePrice(market, side);

  if (price === null || price < 0 || (action === "sell" && price <= 0)) {
    return {
      ok: false as const,
      code: "PRICE_UNAVAILABLE",
      message: "Price is not available for this side yet.",
    };
  }

  const inputAmount = normalizePositiveNumber(amount);
  const inputShares = normalizePositiveNumber(shares);

  if (inputAmount === null && inputShares === null) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "Enter a valid USDT amount or share quantity.",
    };
  }

  const balance = await getTradingBalance(userId, ledger, tradingMode);
  const stakeAmount =
    action === "buy"
      ? inputShares !== null
        ? inputShares * price
        : inputAmount!
      : inputShares !== null
        ? inputShares * price
        : inputAmount!;

  if (stakeAmount < MIN_ORDER_AMOUNT || stakeAmount > MAX_ORDER_AMOUNT) {
    return {
      ok: false,
      code: "ORDER_AMOUNT_OUT_OF_RANGE",
      message: `Order amount must be between ${MIN_ORDER_AMOUNT} and ${MAX_ORDER_AMOUNT} USDT.`,
    };
  }

  const quoteShares = inputShares ?? (price > 0 ? stakeAmount / price : stakeAmount);
  const quoteAmount =
    action === "buy"
      ? inputAmount ?? stakeAmount
      : inputAmount ?? quoteShares * price;
  const platformFee = action === "buy" ? calculatePlatformFee(quoteAmount) : 0;
  const estimatedCost = action === "buy" ? quoteAmount : 0;
  const estimatedProceeds = action === "sell" ? quoteAmount : 0;
  const existingPosition = state.positions.find((position) => position.marketId === market.id);
  const availableShares = getSideShares(existingPosition, side);
  const poolQuote = buildPoolQuote({
    market,
    side,
    action,
    stakeAmount,
    currentOdds: price,
  });

  return {
    ok: true,
    quote: {
      tradingMode,
      id: randomUUID(),
      marketId: market.id,
      marketTitle: market.title,
      side,
      action,
      price,
      currentOdds: price,
      shares: quoteShares,
      amount: quoteAmount,
      stakeAmount,
      platformFee,
      fee: platformFee,
      estimatedCost,
      estimatedProceeds,
      estimatedPayout: poolQuote.estimatedPayout,
      estimatedProfit: poolQuote.estimatedProfit,
      availableCash: balance.availableBalance,
      balanceAfterBet:
        action === "buy"
          ? roundMoney(balance.availableBalance - estimatedCost)
          : roundMoney(balance.availableBalance + estimatedProceeds),
      availableShares,
      poolBefore: poolQuote.poolBefore,
      poolAfter: poolQuote.poolAfter,
      outcomePoolBefore: poolQuote.outcomePoolBefore,
      outcomePoolAfter: poolQuote.outcomePoolAfter,
      priceImpact: poolQuote.priceImpact,
      nextOdds: poolQuote.nextOdds,
      status: "quoted",
      createdAt: quoteCreatedAt,
    },
  };
}

export async function placeLocalOrder(
  input: TradingOrderInput,
): Promise<TradingOrderSuccess | TradingError> {
  const userId = input.userId ?? DEMO_USER_ID;
  const tradingMode = input.tradingMode ?? LOCAL_SIMULATED_TRADING_MODE;
  if (!tradingMode.localSimulationEnabled || !tradingMode.orders.simulatedExecutionEnabled) {
    return buildTradingUnavailableError(tradingMode);
  }

  const state = await getTradingState(userId, input.portfolioRepository);
  const normalizedIdempotencyKey =
    typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
      ? input.idempotencyKey.trim()
      : null;

  if (normalizedIdempotencyKey) {
    if (input.portfolioRepository) {
      const previousTrade = await input.portfolioRepository.findTradeByIdempotencyKey(
        userId,
        normalizedIdempotencyKey,
      );
      if (previousTrade) {
        const portfolio = await getPortfolio(
          userId,
          input.ledger,
          input.portfolioRepository,
          input.settlementRepository,
          tradingMode,
        );
        const trade = mapTradeRecord(previousTrade);
        return {
          ok: true,
          quote: quoteFromTrade(trade, tradingMode),
          trade,
          portfolio,
          idempotent: true,
        };
      }
    }

    const previous = state.idempotencyResults.get(normalizedIdempotencyKey);
    if (previous) {
      // Return fresh portfolio data for idempotent requests
      return {
        ...previous,
        portfolio: await getPortfolio(
          userId,
          input.ledger,
          input.portfolioRepository,
          input.settlementRepository,
          tradingMode,
        ),
        idempotent: true,
      };
    }
  }

  const quoteResult = await createTradingQuote({ ...input, userId, tradingMode });
  if (!quoteResult.ok) {
    return quoteResult;
  }

  const { quote } = quoteResult;
  
  const balance = await input.ledger.getBalance({
    userId,
    asset: "USDT",
    walletId: null,
  });

  if (quote.action === "buy" && quote.estimatedCost > balance.availableBalance) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      message: "Insufficient balance.",
    };
  }

  if (quote.action === "sell" && quote.shares > quote.availableShares) {
    return {
      ok: false,
      code: "INSUFFICIENT_SHARES",
      message: "Insufficient shares for this sale.",
    };
  }

  const now = quote.createdAt;
  const tradeMetadata = {
    publicActivity: false,
    ...normalizeTradeMetadata(input.metadata),
    tradingMode: tradingMode.mode,
    realMoneyEnabled: tradingMode.realMoneyEnabled,
    simulated: tradingMode.simulated,
    localSimulationEnabled: tradingMode.localSimulationEnabled,
    localSimulationBlockReason: tradingMode.localSimulationBlockReason,
  };
  const existingPosition = state.positions.find((position) => position.marketId === quote.marketId);
  const sideCost =
    existingPosition && quote.action === "sell" ? getSideCost(existingPosition, quote.side) : 0;
  const sideShares =
    existingPosition && quote.action === "sell" ? getSideShares(existingPosition, quote.side) : 0;
  const soldCostBasis =
    quote.action === "sell" && sideShares > 0 ? (sideCost / sideShares) * quote.shares : 0;
  const realizedPnl = quote.action === "sell" ? quote.estimatedProceeds - soldCostBasis : null;
  const trade: Trade = {
    id: randomUUID(),
    userId,
    walletId: getWalletId(userId),
    marketId: quote.marketId,
    marketTitle: quote.marketTitle,
    side: quote.side,
    action: quote.action,
    amount: quote.amount,
    stakeAmount: quote.stakeAmount,
    platformFee: quote.platformFee,
    price: quote.price,
    shares: quote.shares,
    realizedPnl,
    idempotencyKey: normalizedIdempotencyKey,
    metadata: tradeMetadata,
    createdAt: now,
  };

  const yesPrice =
    quote.side === "yes" ? quote.nextOdds : quote.side === "no" ? 1 - quote.nextOdds : getOutcomePrice(input.market, "yes");
  const noPrice =
    quote.side === "no" ? quote.nextOdds : quote.side === "yes" ? 1 - quote.nextOdds : getOutcomePrice(input.market, "no");
  const nextPositionBase: LocalPosition = existingPosition
    ? updateExistingPosition({
        position: existingPosition,
        quote,
        soldCostBasis,
        yesPrice,
        noPrice,
        now,
      })
    : {
        id: randomUUID(),
        userId,
        marketId: quote.marketId,
        marketTitle: quote.marketTitle,
        yesShares: quote.side === "yes" ? quote.shares : 0,
        noShares: quote.side === "no" ? quote.shares : 0,
        yesCost: quote.side === "yes" ? quote.estimatedCost : 0,
        noCost: quote.side === "no" ? quote.estimatedCost : 0,
        totalCost: quote.estimatedCost,
        lastYesPrice: yesPrice,
        lastNoPrice: noPrice,
        currentValue: quote.estimatedCost,
        pnl: 0,
        lastTradeAt: now,
      };
  const nextPosition = withComputedPosition(nextPositionBase);

  const ledgerIdempotencyKey = normalizedIdempotencyKey ?? `local-trade:${trade.id}`;
  const ledgerEntry = {
    userId,
    walletId: null,
    asset: "USDT",
    entryType: quote.action === "buy" ? "trade_debit" : "trade_credit",
    amount: quote.action === "buy" ? quote.estimatedCost : quote.estimatedProceeds,
    reason: `Pulse Market ${quote.action} trade: ${quote.shares} shares of ${quote.marketTitle} (${quote.side})`,
    referenceType: "local_trade",
    referenceId: trade.id,
    idempotencyKey: ledgerIdempotencyKey,
    metadata: {
      marketId: quote.marketId,
      marketTitle: quote.marketTitle,
      side: quote.side,
      action: quote.action,
      shares: quote.shares,
      price: quote.price,
      amount: quote.amount,
      stakeAmount: quote.stakeAmount,
      platformFee: quote.platformFee,
      ...tradeMetadata,
    },
    createdAt: now,
  } as const;
  const tradeWrite = toTradeWriteRecord(trade);
  const positionWrites = buildPositionWrites(nextPosition);
  const tradeAuditEvent = input.audit
    ? buildTradeAuditEvent({
        trade,
        quote,
        userId,
        sessionId: input.audit.sessionId,
        idempotencyKey: normalizedIdempotencyKey,
        createdAt: now,
        metadata: input.audit.metadata,
      })
    : null;
  let tradeAuditCommitted = false;

  if (input.portfolioRepository?.commitTrade) {
    const commit = await input.portfolioRepository.commitTrade({
      ledgerEntry,
      trade: tradeWrite,
      positions: positionWrites.positions,
      deletePositions: positionWrites.deletePositions,
      auditEvent: tradeAuditEvent,
    });
    tradeAuditCommitted = commit.audit?.committed ?? false;

    if (commit.ledger.idempotent) {
      const previousTrade = normalizedIdempotencyKey
        ? await input.portfolioRepository.findTradeByIdempotencyKey(
            userId,
            normalizedIdempotencyKey,
          )
        : null;

      if (previousTrade) {
        const trade = mapTradeRecord(previousTrade, quote.marketTitle);
        return {
          ok: true,
          quote: quoteFromTrade(trade, tradingMode),
          trade,
          portfolio: await getPortfolio(
            userId,
            input.ledger,
            input.portfolioRepository,
            input.settlementRepository,
            tradingMode,
          ),
          idempotent: true,
        };
      }

      throw new Error("Ledger idempotency key exists without matching trade state.");
    }
  } else {
    if (input.requireAtomicTradeCommits) {
      return {
        ok: false,
        code: "TRADE_ATOMIC_COMMIT_REQUIRED",
        message: "Trade execution requires an atomic ledger, trade, and position repository commit.",
      };
    }

    const ledger = await input.ledger.createEntry({
      ...ledgerEntry,
      auditEvent: tradeAuditEvent,
    });
    tradeAuditCommitted = ledger.audit?.committed ?? false;

    if (input.portfolioRepository) {
      await persistTradeState({
        repository: input.portfolioRepository,
        trade,
        position: nextPosition,
      });
    }
  }

  state.trades = [trade, ...state.trades].slice(0, 200);
  state.positions =
    getPositionShares(nextPosition) > 0
      ? [
          nextPosition,
          ...state.positions.filter((position) => position.marketId !== quote.marketId),
        ]
      : state.positions.filter((position) => position.marketId !== quote.marketId);

  const result: TradingOrderSuccess = {
    ok: true,
    quote,
    trade,
    portfolio: await getPortfolio(
      userId,
      input.ledger,
      input.portfolioRepository,
      input.settlementRepository,
      tradingMode,
    ),
    idempotent: false,
    internal: {
      tradeAuditCommitted,
    },
  };

  if (normalizedIdempotencyKey) {
    state.idempotencyResults.set(normalizedIdempotencyKey, result);
  }

  return result;
}

export async function placeTradingOrder(
  input: TradingOrderInput,
): Promise<TradingOrderSuccess | TradingError> {
  const tradingMode = input.tradingMode ?? LOCAL_SIMULATED_TRADING_MODE;
  return tradingMode.realMoneyEnabled
    ? placeRealMoneyOrder({ ...input, tradingMode })
    : placeLocalOrder({ ...input, tradingMode });
}

async function placeRealMoneyOrder(
  input: TradingOrderInput & { tradingMode: TradingMode },
): Promise<TradingOrderSuccess | TradingError> {
  const userId = input.userId ?? DEMO_USER_ID;
  const normalizedIdempotencyKey =
    typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
      ? input.idempotencyKey.trim()
      : null;

  if (
    !input.tradingMode.orders.realExecutionEnabled ||
    !input.tradingMode.launchApproval.approved
  ) {
    return buildTradingUnavailableError(input.tradingMode);
  }
  if (!input.realExecutionRuntime) {
    return {
      ok: false,
      code: "TRADING_EXECUTION_ADAPTER_UNAVAILABLE",
      message: "Verified real-money execution adapter is not available in this runtime.",
    };
  }
  if (!normalizedIdempotencyKey) {
    return {
      ok: false,
      code: "TRADING_EXECUTION_REJECTED",
      message: "Idempotency-Key is required for real-money order execution.",
    };
  }

  if (input.portfolioRepository) {
    const previousTrade = await input.portfolioRepository.findTradeByIdempotencyKey(
      userId,
      normalizedIdempotencyKey,
    );
    if (previousTrade) {
      const trade = mapTradeRecord(previousTrade);
      return {
        ok: true,
        quote: quoteFromTrade(trade, input.tradingMode),
        trade,
        portfolio: await getPortfolio(
          userId,
          input.ledger,
          input.portfolioRepository,
          input.settlementRepository,
          input.tradingMode,
        ),
        idempotent: true,
      };
    }
  }

  const quoteResult = await createTradingQuote({ ...input, userId });
  if (!quoteResult.ok) {
    return quoteResult;
  }
  const quote = quoteResult.quote;
  const balance = await input.ledger.getBalance({
    userId,
    asset: "USDT",
    walletId: null,
  });

  if (quote.action === "buy" && quote.estimatedCost > balance.availableBalance) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      message: "Insufficient balance.",
    };
  }
  if (quote.action === "sell" && quote.shares > quote.availableShares) {
    return {
      ok: false,
      code: "INSUFFICIENT_SHARES",
      message: "Insufficient shares for this sale.",
    };
  }

  const clobTokenId =
    input.market.outcomes.find((outcome) => outcome.name.toLowerCase() === quote.side)
      ?.clobTokenId ?? null;
  const execution = normalizeRealExecutionResult(
    await input.realExecutionRuntime.executeOrder({
      idempotencyKey: normalizedIdempotencyKey,
      userId,
      marketId: quote.marketId,
      marketTitle: quote.marketTitle,
      side: quote.side,
      action: quote.action,
      price: quote.price,
      amount: quote.amount,
      shares: quote.shares,
      clobTokenId,
      createdAt: quote.createdAt,
      metadata: normalizeTradeMetadata(input.metadata),
    }),
  );

  if (!execution) {
    return {
      ok: false,
      code: "TRADING_EXECUTION_REJECTED",
      message: "Real-money execution adapter did not return a filled order.",
    };
  }

  const state = await getTradingState(userId, input.portfolioRepository);
  const now = execution.settledAt ?? quote.createdAt;
  const executedAmount = roundMoney(execution.executedAmount);
  const executedPrice = execution.executedPrice;
  const platformFee = roundMoney(execution.feeAmount ?? quote.platformFee);
  const executedQuote: TradingQuote = {
    ...quote,
    price: executedPrice,
    currentOdds: executedPrice,
    shares: execution.executedShares,
    amount: executedAmount,
    stakeAmount: executedAmount,
    platformFee,
    fee: platformFee,
    estimatedCost: quote.action === "buy" ? executedAmount : 0,
    estimatedProceeds: quote.action === "sell" ? executedAmount : 0,
    balanceAfterBet:
      quote.action === "buy"
        ? roundMoney(balance.availableBalance - executedAmount - platformFee)
        : roundMoney(balance.availableBalance + executedAmount),
    nextOdds: executedPrice,
    createdAt: now,
  };
  const existingPosition = state.positions.find(
    (position) => position.marketId === executedQuote.marketId,
  );
  const sideCost =
    existingPosition && executedQuote.action === "sell"
      ? getSideCost(existingPosition, executedQuote.side)
      : 0;
  const sideShares =
    existingPosition && executedQuote.action === "sell"
      ? getSideShares(existingPosition, executedQuote.side)
      : 0;
  const soldCostBasis =
    executedQuote.action === "sell" && sideShares > 0
      ? (sideCost / sideShares) * executedQuote.shares
      : 0;
  const realizedPnl =
    executedQuote.action === "sell" ? executedQuote.estimatedProceeds - soldCostBasis : null;
  const yesPrice =
    executedQuote.side === "yes" ? executedPrice : getOutcomePrice(input.market, "yes");
  const noPrice =
    executedQuote.side === "no" ? executedPrice : getOutcomePrice(input.market, "no");
  const nextPositionBase: LocalPosition = existingPosition
    ? updateExistingPosition({
        position: existingPosition,
        quote: executedQuote,
        soldCostBasis,
        yesPrice,
        noPrice,
        now,
      })
    : {
        id: randomUUID(),
        userId,
        marketId: executedQuote.marketId,
        marketTitle: executedQuote.marketTitle,
        yesShares: executedQuote.side === "yes" ? executedQuote.shares : 0,
        noShares: executedQuote.side === "no" ? executedQuote.shares : 0,
        yesCost: executedQuote.side === "yes" ? executedQuote.estimatedCost : 0,
        noCost: executedQuote.side === "no" ? executedQuote.estimatedCost : 0,
        totalCost: executedQuote.estimatedCost,
        lastYesPrice: yesPrice,
        lastNoPrice: noPrice,
        currentValue: executedQuote.estimatedCost,
        pnl: 0,
        lastTradeAt: now,
      };
  const nextPosition = withComputedPosition(nextPositionBase);
  const tradeMetadata = {
    publicActivity: false,
    ...normalizeTradeMetadata(input.metadata),
    source: "real_execution",
    tradingMode: input.tradingMode.mode,
    realMoneyEnabled: true,
    simulated: false,
    executionAdapterId: input.realExecutionRuntime.adapterId,
    executionProvider: input.realExecutionRuntime.provider,
    providerOrderId: execution.providerOrderId,
    providerTradeId: execution.providerTradeId ?? null,
    rawExecution: normalizeJsonLike(execution.raw),
  };
  const trade: Trade = {
    id: randomUUID(),
    userId,
    walletId: getWalletId(userId),
    marketId: executedQuote.marketId,
    marketTitle: executedQuote.marketTitle,
    side: executedQuote.side,
    action: executedQuote.action,
    amount: executedQuote.amount,
    stakeAmount: executedQuote.stakeAmount,
    platformFee,
    price: executedQuote.price,
    shares: executedQuote.shares,
    realizedPnl,
    idempotencyKey: normalizedIdempotencyKey,
    metadata: tradeMetadata,
    createdAt: now,
  };
  const ledgerEntry: CreateLedgerEntryInput = {
    userId,
    walletId: null,
    asset: "USDT",
    entryType: executedQuote.action === "buy" ? "trade_debit" : "trade_credit",
    amount:
      executedQuote.action === "buy"
        ? roundMoney(executedQuote.estimatedCost + platformFee)
        : executedQuote.estimatedProceeds,
    reason: `Pulse Market real ${executedQuote.action} trade: ${executedQuote.shares} shares of ${executedQuote.marketTitle} (${executedQuote.side})`,
    referenceType: "real_trade",
    referenceId: trade.id,
    idempotencyKey: normalizedIdempotencyKey,
    metadata: {
      marketId: executedQuote.marketId,
      marketTitle: executedQuote.marketTitle,
      side: executedQuote.side,
      action: executedQuote.action,
      shares: executedQuote.shares,
      price: executedQuote.price,
      amount: executedQuote.amount,
      stakeAmount: executedQuote.stakeAmount,
      platformFee,
      ...tradeMetadata,
    },
    createdAt: now,
  };
  const positionWrites = buildPositionWrites(nextPosition);
  const tradeAuditEvent = input.audit
    ? buildTradeAuditEvent({
        trade,
        quote: executedQuote,
        userId,
        sessionId: input.audit.sessionId,
        idempotencyKey: normalizedIdempotencyKey,
        createdAt: now,
        metadata: input.audit.metadata,
      })
    : null;

  if (input.portfolioRepository?.commitTrade) {
    await input.portfolioRepository.commitTrade({
      ledgerEntry,
      trade: toTradeWriteRecord(trade),
      positions: positionWrites.positions,
      deletePositions: positionWrites.deletePositions,
      auditEvent: tradeAuditEvent,
    });
  } else {
    if (input.requireAtomicTradeCommits) {
      return {
        ok: false,
        code: "TRADE_ATOMIC_COMMIT_REQUIRED",
        message: "Real-money trade execution requires an atomic ledger, trade, and position repository commit.",
      };
    }
    await input.ledger.createEntry({
      ...ledgerEntry,
      auditEvent: tradeAuditEvent,
    });
    if (input.portfolioRepository) {
      await persistTradeState({
        repository: input.portfolioRepository,
        trade,
        position: nextPosition,
      });
    }
  }

  state.trades = [trade, ...state.trades].slice(0, 200);
  state.positions =
    getPositionShares(nextPosition) > 0
      ? [
          nextPosition,
          ...state.positions.filter((position) => position.marketId !== executedQuote.marketId),
        ]
      : state.positions.filter((position) => position.marketId !== executedQuote.marketId);

  return {
    ok: true,
    quote: executedQuote,
    trade,
    portfolio: await getPortfolio(
      userId,
      input.ledger,
      input.portfolioRepository,
      input.settlementRepository,
      input.tradingMode,
    ),
    idempotent: false,
  };
}

function normalizeRealExecutionResult(
  result: RealMoneyExecutionOrderResult,
): RealMoneyExecutionOrderResult | null {
  if (
    !result ||
    result.status !== "filled" ||
    typeof result.providerOrderId !== "string" ||
    !result.providerOrderId.trim() ||
    !isPositiveFinite(result.executedPrice) ||
    !isPositiveFinite(result.executedShares) ||
    !isPositiveFinite(result.executedAmount) ||
    (result.feeAmount !== undefined &&
      result.feeAmount !== null &&
      (!Number.isFinite(result.feeAmount) || result.feeAmount < 0))
  ) {
    return null;
  }

  return {
    ...result,
    providerOrderId: result.providerOrderId.trim(),
    providerTradeId: result.providerTradeId?.trim() || null,
  };
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeJsonLike(value: unknown) {
  if (value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value)) as unknown;
}

function buildTradeAuditEvent({
  trade,
  quote,
  userId,
  sessionId,
  idempotencyKey,
  createdAt,
  metadata,
}: {
  trade: Trade;
  quote: TradingQuote;
  userId: string;
  sessionId?: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): AuditEvent {
  return {
    id: randomUUID(),
    eventType: quote.tradingMode.realMoneyEnabled
      ? trade.action === "buy"
        ? "trading.buy_real"
        : "trading.sell_real"
      : trade.action === "buy"
        ? "trading.buy_local"
        : "trading.sell_local",
    userId,
    sessionId: sessionId ?? null,
    metadata: {
      marketId: trade.marketId,
      side: trade.side,
      amount: trade.amount,
      shares: trade.shares,
      price: trade.price,
      idempotencyKey,
      tradingMode: quote.tradingMode.mode,
      realMoneyEnabled: quote.tradingMode.realMoneyEnabled,
      ...metadata,
    },
    createdAt,
  };
}

export async function placeTrade({
  market,
  side,
  amount,
  userId = DEMO_USER_ID,
  ledger,
  portfolioRepository,
  tradingMode,
}: PlaceTradeInput) {
  return placeLocalOrder({
    market,
    side,
    action: "buy",
    amount,
    userId,
    ledger,
    portfolioRepository,
    tradingMode,
  });
}

function mergePositionRows(rows: PositionRecord[]): LocalPosition[] {
  const byMarket = new Map<string, LocalPosition>();

  for (const row of rows) {
    const existing =
      byMarket.get(row.marketId) ??
      ({
        id: randomUUID(),
        userId: row.userId,
        marketId: row.marketId,
        marketTitle: row.marketTitle,
        yesShares: 0,
        noShares: 0,
        yesCost: 0,
        noCost: 0,
        totalCost: 0,
        lastYesPrice: null,
        lastNoPrice: null,
        currentValue: 0,
        pnl: 0,
        lastTradeAt: row.updatedAt,
      } satisfies LocalPosition);

    if (row.side === "yes") {
      existing.yesShares = Number(row.shares);
      existing.yesCost = Number(row.totalCost);
      existing.lastYesPrice = row.lastPrice === null ? null : Number(row.lastPrice);
    } else {
      existing.noShares = Number(row.shares);
      existing.noCost = Number(row.totalCost);
      existing.lastNoPrice = row.lastPrice === null ? null : Number(row.lastPrice);
    }
    existing.lastTradeAt =
      Date.parse(row.updatedAt) > Date.parse(existing.lastTradeAt)
        ? row.updatedAt
        : existing.lastTradeAt;
    byMarket.set(row.marketId, withComputedPosition(existing));
  }

  return [...byMarket.values()];
}

function mapTradeRecord(row: TradeRecord, marketTitle?: string): Trade {
  const metadata = row.metadata ?? {};
  const storedMarketTitle =
    typeof metadata.marketTitle === "string" && metadata.marketTitle.trim()
      ? metadata.marketTitle.trim()
      : null;
  const stakeAmount =
    typeof metadata.stakeAmount === "number" && Number.isFinite(metadata.stakeAmount)
      ? metadata.stakeAmount
      : undefined;
  const platformFee =
    typeof metadata.platformFee === "number" && Number.isFinite(metadata.platformFee)
      ? metadata.platformFee
      : undefined;
  const realizedPnl =
    typeof metadata.realizedPnl === "number" && Number.isFinite(metadata.realizedPnl)
      ? metadata.realizedPnl
      : null;

  return {
    id: row.id,
    userId: row.userId,
    walletId: row.walletId ?? getWalletId(row.userId),
    marketId: row.marketId,
    marketTitle: marketTitle ?? storedMarketTitle ?? row.marketId,
    side: row.side,
    action: row.tradeType,
    amount: Number(row.amount),
    stakeAmount,
    platformFee,
    price: Number(row.price),
    shares: Number(row.shares),
    realizedPnl,
    idempotencyKey: row.idempotencyKey,
    metadata,
    createdAt: row.createdAt,
  };
}

function quoteFromTrade(
  trade: Trade,
  tradingMode: TradingMode = LOCAL_SIMULATED_TRADING_MODE,
): TradingQuote {
  const price = trade.price;
  const amount = trade.amount;
  const fee = trade.platformFee ?? 0;

  return {
    tradingMode,
    id: trade.id,
    marketId: trade.marketId,
    marketTitle: trade.marketTitle,
    side: trade.side,
    action: trade.action,
    price,
    currentOdds: price,
    shares: trade.shares,
    amount,
    stakeAmount: trade.stakeAmount ?? amount,
    platformFee: fee,
    fee,
    estimatedCost: trade.action === "buy" ? amount : 0,
    estimatedProceeds: trade.action === "sell" ? amount : 0,
    estimatedPayout: 0,
    estimatedProfit: 0,
    availableCash: 0,
    balanceAfterBet: 0,
    availableShares: 0,
    poolBefore: 0,
    poolAfter: 0,
    outcomePoolBefore: 0,
    outcomePoolAfter: 0,
    priceImpact: 0,
    nextOdds: price,
    status: "quoted",
    createdAt: trade.createdAt,
  };
}

async function persistTradeState({
  repository,
  trade,
  position,
}: {
  repository: PortfolioRepository;
  trade: Trade;
  position: LocalPosition;
}) {
  await repository.createTrade(toTradeWriteRecord(trade));

  const { positions, deletePositions } = buildPositionWrites(position);
  for (const position of positions) {
    await repository.upsertPosition(position);
  }
  for (const position of deletePositions) {
    await repository.deletePosition(position.userId, position.marketId, position.side);
  }
}

function toTradeWriteRecord(trade: Trade): TradeWriteRecord {
  const metadata: Record<string, unknown> = {
    ...trade.metadata,
    marketTitle: trade.marketTitle,
    realizedPnl: trade.realizedPnl,
  };

  if (typeof trade.stakeAmount === "number" && Number.isFinite(trade.stakeAmount)) {
    metadata.stakeAmount = trade.stakeAmount;
  }
  if (typeof trade.platformFee === "number" && Number.isFinite(trade.platformFee)) {
    metadata.platformFee = trade.platformFee;
  }

  return {
    id: trade.id,
    userId: trade.userId,
    walletId: null,
    marketId: trade.marketId,
    side: trade.side,
    tradeType: trade.action,
    amount: String(trade.amount),
    price: String(trade.price),
    shares: String(trade.shares),
    status: "filled",
    idempotencyKey: trade.idempotencyKey,
    metadata,
    createdAt: trade.createdAt,
  };
}

function buildPositionWrites(position: LocalPosition): {
  positions: PositionWriteRecord[];
  deletePositions: PositionDeleteRecord[];
} {
  const writes = (["yes", "no"] as const).map((side) => buildSidePositionWrite(position, side));

  return {
    positions: writes
      .filter((write): write is { kind: "upsert"; position: PositionWriteRecord } => write.kind === "upsert")
      .map((write) => write.position),
    deletePositions: writes
      .filter((write): write is { kind: "delete"; position: PositionDeleteRecord } => write.kind === "delete")
      .map((write) => write.position),
  };
}

function buildSidePositionWrite(position: LocalPosition, side: TradeSide):
  | { kind: "upsert"; position: PositionWriteRecord }
  | { kind: "delete"; position: PositionDeleteRecord } {
  const shares = side === "yes" ? position.yesShares : position.noShares;
  const totalCost = side === "yes" ? position.yesCost : position.noCost;
  const lastPrice = side === "yes" ? position.lastYesPrice : position.lastNoPrice;

  if (shares <= 0) {
    return {
      kind: "delete",
      position: {
        userId: position.userId,
        marketId: position.marketId,
        side,
      },
    };
  }

  return {
    kind: "upsert",
    position: {
      id: randomUUID(),
      userId: position.userId,
      marketId: position.marketId,
      marketTitle: position.marketTitle,
      side,
      shares: String(shares),
      totalCost: String(totalCost),
      averagePrice: shares > 0 ? String(totalCost / shares) : null,
      lastPrice: lastPrice === null ? null : String(lastPrice),
      openedAt: position.lastTradeAt,
      updatedAt: position.lastTradeAt,
    },
  };
}

function updateExistingPosition({
  position,
  quote,
  soldCostBasis,
  yesPrice,
  noPrice,
  now,
}: {
  position: LocalPosition;
  quote: TradingQuote;
  soldCostBasis: number;
  yesPrice: number | null;
  noPrice: number | null;
  now: string;
}) {
  if (quote.action === "buy") {
    return {
      ...position,
      marketTitle: quote.marketTitle,
      yesShares: position.yesShares + (quote.side === "yes" ? quote.shares : 0),
      noShares: position.noShares + (quote.side === "no" ? quote.shares : 0),
      yesCost: position.yesCost + (quote.side === "yes" ? quote.estimatedCost : 0),
      noCost: position.noCost + (quote.side === "no" ? quote.estimatedCost : 0),
      totalCost:
        position.yesCost +
        position.noCost +
        quote.estimatedCost,
      lastYesPrice: yesPrice,
      lastNoPrice: noPrice,
      lastTradeAt: now,
    };
  }

  return {
    ...position,
    marketTitle: quote.marketTitle,
    yesShares:
      quote.side === "yes"
        ? Math.max(0, position.yesShares - quote.shares)
        : position.yesShares,
    noShares:
      quote.side === "no"
        ? Math.max(0, position.noShares - quote.shares)
        : position.noShares,
    yesCost:
      quote.side === "yes"
        ? Math.max(0, position.yesCost - soldCostBasis)
        : position.yesCost,
    noCost:
      quote.side === "no"
        ? Math.max(0, position.noCost - soldCostBasis)
        : position.noCost,
    totalCost:
      quote.side === "yes"
        ? Math.max(0, position.yesCost - soldCostBasis) + position.noCost
        : position.yesCost + Math.max(0, position.noCost - soldCostBasis),
    lastYesPrice: yesPrice,
    lastNoPrice: noPrice,
    lastTradeAt: now,
  };
}

const COIN_MIN_ORDER_MICROS = 1_000_000n;
const COIN_MAX_ORDER_MICROS = 100_000_000_000n;
const TRADING_FEE_BASIS_POINTS = 200n;
const PRICE_NANOS_SCALE = 1_000_000_000n;
const SHARE_MICROS_SCALE = 1_000_000n;

type CoinExecutionResult = {
  status: "filled" | "partially_filled" | "cancelled";
  providerOrderId: string | null;
  providerTradeId: string | null;
  executedPrice: string | null;
  executedShares: string;
  executedAmountCoinMicros: bigint;
  feeCoinMicros: bigint | null;
  settledAt: string;
  raw: unknown;
};

export async function createCoinTradingQuote(
  input: CoinTradingQuoteInput,
): Promise<{ ok: true; quote: CoinTradingQuote } | TradingError> {
  const createdAt = normalizeCreatedAt(input.createdAt);
  if (!createdAt) {
    return {
      ok: false,
      code: "INVALID_CREATED_AT",
      message: "createdAt must be a valid ISO date string.",
    };
  }
  if (
    !input.tradingMode.orders.simulatedExecutionEnabled &&
    !input.tradingMode.orders.realExecutionEnabled
  ) {
    return buildTradingUnavailableError(input.tradingMode);
  }
  if (
    input.tradingMode.realMoneyEnabled &&
    !input.tradingMode.launchApproval.approved
  ) {
    return buildTradingUnavailableError(input.tradingMode);
  }
  if (!isMarketTradable(input.market)) {
    return {
      ok: false,
      code: hasMarketCloseTimePassed(input.market)
        ? "MARKET_CLOSED"
        : "MARKET_NOT_TRADABLE",
      message: "This market is not accepting Coin trades.",
    };
  }

  const priceNanos = getOutcomePriceNanos(input.market, input.side);
  if (priceNanos === null || priceNanos <= 0n) {
    return {
      ok: false,
      code: "PRICE_UNAVAILABLE",
      message: "Price is not available for this side yet.",
    };
  }

  let requestedCoinMicros = 0n;
  let requestedSharesMicros = 0n;
  try {
    if (input.action === "buy") {
      requestedCoinMicros = parseCoinMicrosString(input.amountCoinMicros);
      requestedSharesMicros = multiplyDivide(
        requestedCoinMicros,
        PRICE_NANOS_SCALE,
        priceNanos,
        "down",
      );
    } else {
      requestedSharesMicros = parseClobSharesMicros(input.shares);
      requestedCoinMicros = multiplyDivide(
        requestedSharesMicros,
        priceNanos,
        PRICE_NANOS_SCALE,
        "down",
      );
    }
  } catch {
    return {
      ok: false,
      code: "INVALID_COIN_AMOUNT",
      message:
        input.action === "buy"
          ? "amountCoinMicros must be a positive integer string."
          : "shares must be a positive decimal string with at most 6 decimals.",
    };
  }

  if (
    requestedCoinMicros < COIN_MIN_ORDER_MICROS ||
    requestedCoinMicros > COIN_MAX_ORDER_MICROS
  ) {
    return {
      ok: false,
      code: "ORDER_AMOUNT_OUT_OF_RANGE",
      message: "Order value must be between 1 and 100000 Coins.",
    };
  }

  const [balance, positionRows] = await Promise.all([
    input.coinLedger.getBalance(input.userId),
    input.portfolioRepository.getPositionsByUserId(input.userId),
  ]);
  const availableCoinMicros = BigInt(balance.availableCoinMicros);
  const feeCoinMicros = calculateFee(
    requestedCoinMicros,
    TRADING_FEE_BASIS_POINTS,
    0n,
    "up",
  );
  const availableSharesMicros = getAvailablePositionSharesMicros(
    positionRows,
    input.market.id,
    input.side,
  );

  if (input.action === "sell" && requestedSharesMicros > availableSharesMicros) {
    return {
      ok: false,
      code: "INSUFFICIENT_SHARES",
      message: "Insufficient shares for this sale.",
    };
  }

  const costCoinMicros =
    input.action === "buy" ? requestedCoinMicros + feeCoinMicros : 0n;
  const netProceedsCoinMicros =
    input.action === "sell"
      ? requestedCoinMicros > feeCoinMicros
        ? requestedCoinMicros - feeCoinMicros
        : 0n
      : 0n;
  const balanceAfterCoinMicros =
    input.action === "buy"
      ? availableCoinMicros - costCoinMicros
      : availableCoinMicros + netProceedsCoinMicros;
  const estimatedPayoutCoinMicros =
    input.action === "buy" ? requestedSharesMicros : 0n;
  const estimatedProfitCoinMicros =
    input.action === "buy"
      ? estimatedPayoutCoinMicros - requestedCoinMicros - feeCoinMicros
      : netProceedsCoinMicros;

  return {
    ok: true,
    quote: {
      tradingMode: input.tradingMode,
      id: randomUUID(),
      marketId: input.market.id,
      marketTitle: input.market.title,
      side: input.side,
      action: input.action,
      price: formatAtomic(priceNanos, CLOB_PRICE_DECIMALS),
      shares: formatAtomic(requestedSharesMicros, CLOB_SHARE_DECIMALS),
      amountCoinMicros: requestedCoinMicros.toString(),
      stakeCoinMicros: requestedCoinMicros.toString(),
      feeCoinMicros: feeCoinMicros.toString(),
      estimatedCostCoinMicros: costCoinMicros.toString(),
      estimatedProceedsCoinMicros: netProceedsCoinMicros.toString(),
      estimatedPayoutCoinMicros: estimatedPayoutCoinMicros.toString(),
      estimatedProfitCoinMicros: estimatedProfitCoinMicros.toString(),
      availableCoinMicros: availableCoinMicros.toString(),
      balanceAfterCoinMicros: balanceAfterCoinMicros.toString(),
      availableShares: formatAtomic(availableSharesMicros, CLOB_SHARE_DECIMALS),
      status: "quoted",
      createdAt,
    },
  };
}

export async function placeCoinTradingOrder(
  input: CoinTradingOrderInput,
): Promise<CoinTradingOrderSuccess | TradingError> {
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey) {
    return {
      ok: false,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key is required for Coin orders.",
    };
  }
  if (
    !input.portfolioRepository.reserveCoinTradeOrder ||
    !input.portfolioRepository.finalizeCoinTradeOrder ||
    !input.portfolioRepository.cancelCoinTradeOrder ||
    !input.portfolioRepository.findCoinTradeOrderByIdempotencyKey
  ) {
    return {
      ok: false,
      code: "TRADE_ATOMIC_COMMIT_REQUIRED",
      message:
        "Coin orders require persistent atomic reserve, execution state, and finalization support.",
    };
  }
  const existingOrder =
    await input.portfolioRepository.findCoinTradeOrderByIdempotencyKey(
      input.userId,
      idempotencyKey,
    );
  if (
    existingOrder?.status === "reserved" ||
    existingOrder?.status === "execution_pending"
  ) {
    return {
      ok: false,
      code: "EXECUTION_RECONCILIATION_REQUIRED",
      message:
        "Order execution is already pending; reserved Coins remain locked until provider reconciliation completes.",
    };
  }

  const quoteResult = await createCoinTradingQuote(input);
  if (!quoteResult.ok) return quoteResult;
  const quote = quoteResult.quote;
  const fingerprint = buildCoinOrderFingerprint({
    marketId: quote.marketId,
    side: quote.side,
    action: quote.action,
    amountCoinMicros: quote.amountCoinMicros,
    shares: quote.shares,
    price: quote.price,
  });
  const previousOrder = existingOrder;
  if (previousOrder) {
    if (previousOrder.requestFingerprint !== fingerprint) {
      return {
        ok: false,
        code: "TRADING_ORDER_STATE_CONFLICT",
        message: "Idempotency key was already used for a different order.",
      };
    }
    if (
      previousOrder.status === "filled" ||
      previousOrder.status === "partially_filled"
    ) {
      const previousTrade =
        await input.portfolioRepository.findTradeByIdempotencyKey(
          input.userId,
          idempotencyKey,
        );
      if (!previousTrade) {
        return {
          ok: false,
          code: "EXECUTION_RECONCILIATION_REQUIRED",
          message: "Filled execution is missing its local trade projection.",
        };
      }
      const trade = mapCoinTradeRecord(previousTrade);
      return {
        ok: true,
        quote: coinQuoteFromTrade(trade, quote),
        trade,
        portfolio: await getCoinPortfolio({
          userId: input.userId,
          tradingMode: input.tradingMode,
          coinLedger: input.coinLedger,
          portfolioRepository: input.portfolioRepository,
          settlementRepository: input.settlementRepository,
        }),
        idempotent: true,
        orderStatus: previousOrder.status,
      };
    }
    if (
      previousOrder.status === "cancelled" ||
      previousOrder.status === "failed" ||
      previousOrder.status === "manual_review"
    ) {
      return {
        ok: false,
        code:
          previousOrder.status === "manual_review"
            ? "EXECUTION_RECONCILIATION_REQUIRED"
            : "TRADING_EXECUTION_REJECTED",
        message:
          previousOrder.status === "manual_review"
            ? "Order execution is in manual reconciliation; reserved Coins remain locked."
            : `Order is already ${previousOrder.status}.`,
      };
    }
  }

  const reserveCoinMicros =
    quote.action === "buy" ? BigInt(quote.estimatedCostCoinMicros) : 0n;
  const orderId = previousOrder?.id ?? randomUUID();
  const orderCreatedAt = previousOrder?.createdAt ?? quote.createdAt;
  let order = previousOrder;
  if (!order) {
    let reserve: Awaited<
      ReturnType<NonNullable<PortfolioRepository["reserveCoinTradeOrder"]>>
    >;
    try {
      reserve = await input.portfolioRepository.reserveCoinTradeOrder({
        order: {
          id: orderId,
          userId: input.userId,
          marketId: quote.marketId,
          marketTitle: quote.marketTitle,
          side: quote.side,
          action: quote.action,
          clobTokenId: getClobTokenId(input.market, quote.side),
          status: "execution_pending",
          requestedCoinMicros:
            quote.action === "buy" ? quote.stakeCoinMicros : "0",
          requestedShares: quote.shares,
          quotePriceNanos: parseClobPriceNanos(quote.price).toString(),
          reservedCoinMicros: reserveCoinMicros.toString(),
          filledCoinMicros: "0",
          feeCoinMicros: "0",
          releasedCoinMicros: "0",
          executedShares: null,
          executedPriceNanos: null,
          provider: input.tradingMode.realMoneyEnabled
            ? "polymarket"
            : "local-simulated",
          providerOrderId: null,
          providerTradeId: null,
          reserveLedgerEntryId: null,
          debitLedgerEntryId: null,
          feeLedgerEntryId: null,
          releaseLedgerEntryId: null,
          creditLedgerEntryId: null,
          idempotencyKey,
          requestFingerprint: fingerprint,
          lastError: null,
          metadata: normalizeTradeMetadata(input.metadata),
          createdAt: orderCreatedAt,
          updatedAt: orderCreatedAt,
        },
        reserveEntry:
          reserveCoinMicros > 0n
            ? buildCoinMovement({
                userId: input.userId,
                operationType: "trade_reserve",
                availableDeltaCoinMicros: -reserveCoinMicros,
                reservedDeltaCoinMicros: reserveCoinMicros,
                idempotencyKey: `trade:${orderId}:reserve`,
                sourceId: orderId,
                reason: "Reserve Coins before trade execution",
                auditMetadata: coinOrderMetadata(quote),
              })
            : null,
        outboxPayload: {
          orderId,
          userId: input.userId,
          marketId: quote.marketId,
          action: quote.action,
          amountCoinMicros: quote.amountCoinMicros,
          shares: quote.shares,
        },
      });
    } catch (error) {
      if (
        error instanceof PortfolioRepositoryError &&
        error.code === "TRADING_ORDER_STATE_CONFLICT"
      ) {
        return {
          ok: false,
          code: "TRADING_ORDER_STATE_CONFLICT",
          message: error.message,
        };
      }
      throw error;
    }
    order = reserve.order;
    if (reserve.idempotent) {
      return {
        ok: false,
        code: "EXECUTION_RECONCILIATION_REQUIRED",
        message:
          "Order execution was reserved concurrently; the venue will not be called again until provider reconciliation completes.",
      };
    }
  }

  let execution: CoinExecutionResult;
  try {
    execution = input.tradingMode.realMoneyEnabled
      ? await executeCoinOrderAtVenue(input, quote, order)
      : buildSimulatedCoinExecution(quote, order);
  } catch (error) {
    const ambiguous = isAmbiguousExecutionError(error);
    await input.portfolioRepository.cancelCoinTradeOrder({
      orderId: order.id,
      expectedUserId: input.userId,
      expectedIdempotencyKey: idempotencyKey,
      status: ambiguous ? "manual_review" : "failed",
      error: error instanceof Error ? error.message : String(error),
      releaseEntry:
        !ambiguous && reserveCoinMicros > 0n
          ? buildCoinMovement({
              userId: input.userId,
              operationType: "trade_release",
              availableDeltaCoinMicros: reserveCoinMicros,
              reservedDeltaCoinMicros: -reserveCoinMicros,
              idempotencyKey: `trade:${order.id}:release:failed`,
              sourceId: order.id,
              reason: "Release Coins after rejected trade execution",
              auditMetadata: coinOrderMetadata(quote),
            })
          : null,
      auditEvent: buildCoinOrderAuditEvent({
        eventType: "trading.rejected",
        userId: input.userId,
        sessionId: input.audit?.sessionId,
        orderId: order.id,
        quote,
        metadata: {
          reason: ambiguous
            ? "EXECUTION_RECONCILIATION_REQUIRED"
            : "TRADING_EXECUTION_REJECTED",
          error: error instanceof Error ? error.message : String(error),
        },
      }),
      outboxPayload: {
        orderId: order.id,
        userId: input.userId,
        ambiguous,
      },
    });
    return {
      ok: false,
      code: ambiguous
        ? "EXECUTION_RECONCILIATION_REQUIRED"
        : "TRADING_EXECUTION_REJECTED",
      message: ambiguous
        ? "Execution state is unknown; reserved Coins remain locked for reconciliation."
        : "Trade execution was rejected and the Coin reserve was released.",
    };
  }

  if (execution.status === "cancelled") {
    await input.portfolioRepository.cancelCoinTradeOrder({
      orderId: order.id,
      expectedUserId: input.userId,
      expectedIdempotencyKey: idempotencyKey,
      status: "cancelled",
      error: null,
      releaseEntry:
        reserveCoinMicros > 0n
          ? buildCoinMovement({
              userId: input.userId,
              operationType: "trade_release",
              availableDeltaCoinMicros: reserveCoinMicros,
              reservedDeltaCoinMicros: -reserveCoinMicros,
              idempotencyKey: `trade:${order.id}:release:cancelled`,
              sourceId: order.id,
              reason: "Release unused Coins after cancelled execution",
              auditMetadata: coinOrderMetadata(quote),
            })
          : null,
      auditEvent: buildCoinOrderAuditEvent({
        eventType: "trading.rejected",
        userId: input.userId,
        sessionId: input.audit?.sessionId,
        orderId: order.id,
        quote,
        metadata: { reason: "TRADING_EXECUTION_CANCELLED" },
      }),
      outboxPayload: { orderId: order.id, userId: input.userId },
    });
    return {
      ok: false,
      code: "TRADING_EXECUTION_REJECTED",
      message: "Order was cancelled and unused Coins were released.",
    };
  }

  let committed: Awaited<
    ReturnType<NonNullable<PortfolioRepository["finalizeCoinTradeOrder"]>>
  >;
  try {
    const finalization = await buildCoinTradeFinalization({
      input,
      quote,
      order,
      execution,
    });
    committed = await input.portfolioRepository.finalizeCoinTradeOrder(
      finalization.commit,
    );
  } catch (error) {
    await input.portfolioRepository.cancelCoinTradeOrder({
      orderId: order.id,
      expectedUserId: input.userId,
      expectedIdempotencyKey: idempotencyKey,
      status: "manual_review",
      error: error instanceof Error ? error.message : String(error),
      releaseEntry: null,
      auditEvent: buildCoinOrderAuditEvent({
        eventType: "trading.rejected",
        userId: input.userId,
        sessionId: input.audit?.sessionId,
        orderId: order.id,
        quote,
        metadata: {
          reason: "POST_EXECUTION_COMMIT_RECONCILIATION_REQUIRED",
          providerOrderId: execution.providerOrderId,
          error: error instanceof Error ? error.message : String(error),
        },
      }),
      outboxPayload: {
        orderId: order.id,
        userId: input.userId,
        providerOrderId: execution.providerOrderId,
        reconciliationRequired: true,
      },
    });
    return {
      ok: false,
      code: "EXECUTION_RECONCILIATION_REQUIRED",
      message:
        "External execution may have completed but local finalization failed; reserved Coins remain locked.",
    };
  }
  const trade = mapCoinTradeRecord(committed.trade);

  return {
    ok: true,
    quote: coinQuoteFromTrade(trade, quote),
    trade,
    portfolio: await getCoinPortfolio({
      userId: input.userId,
      tradingMode: input.tradingMode,
      coinLedger: input.coinLedger,
      portfolioRepository: input.portfolioRepository,
      settlementRepository: input.settlementRepository,
    }),
    idempotent: committed.idempotent,
    orderStatus: committed.order.status,
  };
}

export async function getCoinPortfolio(input: {
  userId: string;
  tradingMode: TradingMode;
  coinLedger: CoinLedgerPort;
  portfolioRepository: PortfolioRepository;
  settlementRepository?: SettlementHistoryRepository;
  marketResolver?: PortfolioMarketResolver;
}): Promise<CoinPortfolioResponse> {
  const [balance, positionRows, tradeRows, payoutRows] = await Promise.all([
    input.coinLedger.getBalance(input.userId),
    input.portfolioRepository.getPositionsByUserId(input.userId),
    input.portfolioRepository.getTradesByUserId(input.userId, 200),
    input.settlementRepository?.listPayoutsByUserId?.(input.userId, 200) ??
      Promise.resolve([]),
  ]);
  const positions = await mapCoinPositions(positionRows, input.marketResolver);
  const trades = tradeRows
    .filter((trade) => trade.executionOrderId || trade.amountCoinMicros)
    .map(mapCoinTradeRecord);
  const settlements = payoutRows.map(mapCoinSettlementHistory);
  const investedCoinMicros = positions.reduce(
    (sum, position) => sum + BigInt(position.totalCostCoinMicros),
    0n,
  );
  const positionValueCoinMicros = positions.reduce(
    (sum, position) => sum + BigInt(position.currentValueCoinMicros),
    0n,
  );
  const unrealizedPnlCoinMicros =
    positionValueCoinMicros - investedCoinMicros;
  const realizedTradePnl = trades.reduce(
    (sum, trade) => sum + BigInt(trade.realizedPnlCoinMicros ?? "0"),
    0n,
  );
  const realizedSettlementPnl = settlements.reduce(
    (sum, settlement) => sum + BigInt(settlement.profitCoinMicros),
    0n,
  );
  const realizedPnlCoinMicros = realizedTradePnl + realizedSettlementPnl;
  const pnlCoinMicros = unrealizedPnlCoinMicros + realizedPnlCoinMicros;
  const available = BigInt(balance.availableCoinMicros);
  const reserved = BigInt(balance.reservedCoinMicros);
  const equity = available + reserved + positionValueCoinMicros;

  return {
    tradingMode: input.tradingMode,
    user: createInitialState(input.userId).user,
    wallet: {
      availableCoinMicros: balance.availableCoinMicros,
      reservedCoinMicros: balance.reservedCoinMicros,
      totalCoinMicros: balance.totalCoinMicros,
    },
    positions,
    trades,
    settlements,
    summary: {
      availableCoinMicros: available.toString(),
      reservedCoinMicros: reserved.toString(),
      totalCoinMicros: (available + reserved).toString(),
      positionValueCoinMicros: positionValueCoinMicros.toString(),
      investedCoinMicros: investedCoinMicros.toString(),
      equityCoinMicros: equity.toString(),
      unrealizedPnlCoinMicros: unrealizedPnlCoinMicros.toString(),
      realizedPnlCoinMicros: realizedPnlCoinMicros.toString(),
      pnlCoinMicros: pnlCoinMicros.toString(),
      pnlPercent:
        investedCoinMicros > 0n
          ? formatSignedRatio(pnlCoinMicros, investedCoinMicros, 6)
          : null,
      openPositions: positions.length,
    },
  };
}

async function executeCoinOrderAtVenue(
  input: CoinTradingOrderInput,
  quote: CoinTradingQuote,
  order: CoinTradeOrderRecord,
): Promise<CoinExecutionResult> {
  if (!input.tradingMode.launchApproval.approved) {
    throw new TradingPolicyError(
      "Real-money execution is blocked until the launch approval artifact passes audit.",
    );
  }
  if (!input.realExecutionRuntime) {
    throw new Error("Verified execution adapter is unavailable.");
  }
  const raw = (await input.realExecutionRuntime.executeOrder({
    idempotencyKey: input.idempotencyKey,
    userId: input.userId,
    marketId: quote.marketId,
    marketTitle: quote.marketTitle,
    side: quote.side,
    action: quote.action,
    price: clobDecimalToSdkNumber(quote.price, CLOB_PRICE_DECIMALS),
    amount: clobDecimalToSdkNumber(
      coinMicrosToClobQuoteAmount(coinMicros(BigInt(quote.stakeCoinMicros), false)),
      6,
    ),
    shares: clobDecimalToSdkNumber(quote.shares, CLOB_SHARE_DECIMALS),
    clobTokenId: order.clobTokenId,
    createdAt: order.createdAt,
    metadata: {
      ...normalizeTradeMetadata(input.metadata),
      coinAmountMicros: quote.stakeCoinMicros,
      feeCoinMicros: quote.feeCoinMicros,
      conversionBoundary: "coin_micros_to_clob_quote_units_v1",
    },
  })) as Omit<RealMoneyExecutionOrderResult, "status"> & {
    status?: "filled" | "partially_filled" | "cancelled";
  };
  if (
    raw.status !== "filled" &&
    raw.status !== "partially_filled" &&
    raw.status !== "cancelled"
  ) {
    throw new CoinExecutionReconciliationError(
      "Execution provider returned an unknown order status.",
    );
  }
  const status = raw.status;
  if (status === "cancelled") {
    const nonZeroOrInvalidCancelledValue = [
      raw.executedPrice,
      raw.executedShares,
      raw.executedAmount,
      raw.feeAmount,
    ].some(
      (value) =>
        value !== null &&
        value !== undefined &&
        (!Number.isFinite(value) || value !== 0),
    );
    if (nonZeroOrInvalidCancelledValue) {
      throw new CoinExecutionReconciliationError(
        "Cancelled execution returned non-zero fill data.",
      );
    }
    return {
      status,
      providerOrderId:
        typeof raw.providerOrderId === "string" ? raw.providerOrderId : null,
      providerTradeId: raw.providerTradeId ?? null,
      executedPrice: null,
      executedShares: "0",
      executedAmountCoinMicros: 0n,
      feeCoinMicros: 0n,
      settledAt: raw.settledAt ?? new Date().toISOString(),
      raw: raw.raw,
    };
  }
  let price: string;
  let shares: string;
  let amount: bigint;
  let fee: bigint | null;
  try {
    price = clobSdkNumberToDecimal(
      raw.executedPrice,
      CLOB_PRICE_DECIMALS,
    );
    shares = clobSdkNumberToDecimal(
      raw.executedShares,
      CLOB_SHARE_DECIMALS,
    );
    amount = clobQuoteAmountToMicrosFromSdk(raw.executedAmount);
    fee =
      raw.feeAmount === null || raw.feeAmount === undefined
        ? null
        : clobQuoteAmountToMicrosFromSdk(raw.feeAmount, true);
  } catch {
    throw new CoinExecutionReconciliationError(
      "Execution provider returned invalid fill units.",
    );
  }
  if (!raw.providerOrderId?.trim()) {
    throw new CoinExecutionReconciliationError(
      "Execution provider did not return an order id.",
    );
  }
  return {
    status,
    providerOrderId: raw.providerOrderId.trim(),
    providerTradeId: raw.providerTradeId?.trim() || null,
    executedPrice: price,
    executedShares: shares,
    executedAmountCoinMicros: amount,
    feeCoinMicros: fee,
    settledAt: raw.settledAt ?? new Date().toISOString(),
    raw: raw.raw,
  };
}

function buildSimulatedCoinExecution(
  quote: CoinTradingQuote,
  order: CoinTradeOrderRecord,
): CoinExecutionResult {
  return {
    status: "filled",
    providerOrderId: `local:${order.id}`,
    providerTradeId: `local:${order.id}`,
    executedPrice: quote.price,
    executedShares: quote.shares,
    executedAmountCoinMicros: BigInt(quote.stakeCoinMicros),
    feeCoinMicros: BigInt(quote.feeCoinMicros),
    settledAt: quote.createdAt,
    raw: { simulated: true },
  };
}

async function buildCoinTradeFinalization({
  input,
  quote,
  order,
  execution,
}: {
  input: CoinTradingOrderInput;
  quote: CoinTradingQuote;
  order: CoinTradeOrderRecord;
  execution: CoinExecutionResult;
}): Promise<{
  commit: FinalizeCoinTradeOrderInput;
}> {
  const executedSharesMicros = parseClobSharesMicros(execution.executedShares);
  const executedPriceNanos = parseClobPriceNanos(execution.executedPrice ?? quote.price);
  const requestedSharesMicros = parseClobSharesMicros(quote.shares);
  const requestedStakeCoinMicros = BigInt(quote.stakeCoinMicros);
  const filledCoinMicros = execution.executedAmountCoinMicros;
  const policyFeeCoinMicros = calculateFee(
    filledCoinMicros,
    TRADING_FEE_BASIS_POINTS,
    0n,
    "up",
  );
  const feeCoinMicros = execution.feeCoinMicros ?? policyFeeCoinMicros;
  const amountFromFillCoinMicros = multiplyDivide(
    executedSharesMicros,
    executedPriceNanos,
    PRICE_NANOS_SCALE,
    "down",
  );
  const fillAmountDifference =
    filledCoinMicros >= amountFromFillCoinMicros
      ? filledCoinMicros - amountFromFillCoinMicros
      : amountFromFillCoinMicros - filledCoinMicros;

  if (
    executedSharesMicros <= 0n ||
    filledCoinMicros <= 0n ||
    executedSharesMicros > requestedSharesMicros ||
    fillAmountDifference > 1n
  ) {
    throw new TradingPolicyError(
      "Execution fill amount, shares, and price do not reconcile within one Coin micro.",
    );
  }
  if (
    (execution.status === "filled" &&
      executedSharesMicros !== requestedSharesMicros) ||
    (execution.status === "partially_filled" &&
      executedSharesMicros >= requestedSharesMicros)
  ) {
    throw new TradingPolicyError(
      "Execution status is inconsistent with the requested and executed shares.",
    );
  }
  if (feeCoinMicros !== policyFeeCoinMicros) {
    throw new TradingPolicyError(
      "Execution fee does not match the fixed two-percent Coin trading fee.",
    );
  }
  const reservedCoinMicros = BigInt(order.reservedCoinMicros);
  const consumedReserve =
    quote.action === "buy" ? filledCoinMicros + feeCoinMicros : 0n;
  if (
    quote.action === "buy" &&
    (consumedReserve > reservedCoinMicros ||
      filledCoinMicros > requestedStakeCoinMicros)
  ) {
    throw new TradingPolicyError(
      "Execution exceeds the reserved Coin amount and requires reconciliation.",
    );
  }
  if (
    quote.action === "sell" &&
    (executedSharesMicros > requestedSharesMicros ||
      feeCoinMicros > filledCoinMicros)
  ) {
    throw new TradingPolicyError(
      "Sell execution exceeds the requested shares or returned proceeds.",
    );
  }
  const releasedCoinMicros =
    quote.action === "buy" ? reservedCoinMicros - consumedReserve : 0n;
  const partial = execution.status === "partially_filled";
  const rows = await input.portfolioRepository.getPositionsByUserId(input.userId);
  const sideRow = rows.find(
    (row) => row.marketId === quote.marketId && row.side === quote.side,
  );
  const oldSharesMicros = sideRow ? parseStoredSharesMicros(sideRow.shares) : 0n;
  const oldCostCoinMicros = sideRow
    ? BigInt(sideRow.totalCostCoinMicros ?? "0")
    : 0n;
  let nextSharesMicros: bigint;
  let nextCostCoinMicros: bigint;
  let realizedPnlCoinMicros: bigint | null = null;

  if (quote.action === "buy") {
    nextSharesMicros = oldSharesMicros + executedSharesMicros;
    nextCostCoinMicros = oldCostCoinMicros + filledCoinMicros;
  } else {
    if (executedSharesMicros > oldSharesMicros || oldSharesMicros === 0n) {
      throw new TradingPolicyError(
        "Execution sold more shares than the locally recorded position.",
      );
    }
    const costBasis = multiplyDivide(
      oldCostCoinMicros,
      executedSharesMicros,
      oldSharesMicros,
      "down",
    );
    nextSharesMicros = oldSharesMicros - executedSharesMicros;
    nextCostCoinMicros = oldCostCoinMicros - costBasis;
    realizedPnlCoinMicros = filledCoinMicros - feeCoinMicros - costBasis;
  }
  const averagePriceNanos =
    nextSharesMicros > 0n
      ? multiplyDivide(
          nextCostCoinMicros,
          PRICE_NANOS_SCALE,
          nextSharesMicros,
          "down",
        )
      : null;
  const positionId = sideRow?.id ?? randomUUID();
  const positionWrite: PositionWriteRecord = {
    id: positionId,
    userId: input.userId,
    marketId: quote.marketId,
    marketTitle: quote.marketTitle,
    side: quote.side,
    shares: formatAtomic(nextSharesMicros, CLOB_SHARE_DECIMALS),
    totalCost: formatAtomic(nextCostCoinMicros, 6),
    averagePrice:
      averagePriceNanos === null
        ? null
        : formatAtomic(averagePriceNanos, CLOB_PRICE_DECIMALS),
    lastPrice: formatAtomic(executedPriceNanos, CLOB_PRICE_DECIMALS),
    totalCostCoinMicros: nextCostCoinMicros.toString(),
    averagePriceNanos: averagePriceNanos?.toString() ?? null,
    lastPriceNanos: executedPriceNanos.toString(),
    openedAt: sideRow?.openedAt ?? execution.settledAt,
    updatedAt: execution.settledAt,
  };
  const tradeId = randomUUID();
  const tradeRecord: TradeWriteRecord = {
    id: tradeId,
    userId: input.userId,
    walletId: null,
    marketId: quote.marketId,
    side: quote.side,
    tradeType: quote.action,
    amount: formatAtomic(filledCoinMicros, 6),
    price: formatAtomic(executedPriceNanos, CLOB_PRICE_DECIMALS),
    shares: formatAtomic(executedSharesMicros, CLOB_SHARE_DECIMALS),
    status: "filled",
    idempotencyKey: input.idempotencyKey,
    executionOrderId: order.id,
    amountCoinMicros: filledCoinMicros.toString(),
    feeCoinMicros: feeCoinMicros.toString(),
    realizedPnlCoinMicros: realizedPnlCoinMicros?.toString() ?? null,
    priceNanos: executedPriceNanos.toString(),
    metadata: {
      publicActivity: false,
      marketTitle: quote.marketTitle,
      stakeCoinMicros: filledCoinMicros.toString(),
      executionStatus: partial ? "partially_filled" : "filled",
      provider: input.realExecutionRuntime?.provider ?? "local-simulated",
      providerOrderId: execution.providerOrderId,
      providerTradeId: execution.providerTradeId,
      rawExecution: normalizeJsonLike(execution.raw),
    },
    createdAt: execution.settledAt,
  };
  const commonMetadata = {
    ...coinOrderMetadata(quote),
    tradeId,
    providerOrderId: execution.providerOrderId,
  };
  const tradeDebitEntry =
    quote.action === "buy" && filledCoinMicros > 0n
      ? buildCoinMovement({
          userId: input.userId,
          operationType: "trade_debit",
          availableDeltaCoinMicros: 0n,
          reservedDeltaCoinMicros: -filledCoinMicros,
          idempotencyKey: `trade:${order.id}:debit`,
          sourceId: order.id,
          reason: "Debit reserved Coins for executed trade",
          auditMetadata: commonMetadata,
        })
      : null;
  const tradeCreditEntry =
    quote.action === "sell" && filledCoinMicros > 0n
      ? buildCoinMovement({
          userId: input.userId,
          operationType: "trade_settlement_credit",
          availableDeltaCoinMicros: filledCoinMicros,
          reservedDeltaCoinMicros: 0n,
          idempotencyKey: `trade:${order.id}:credit`,
          sourceId: order.id,
          reason: "Credit Coin proceeds from executed sale",
          auditMetadata: commonMetadata,
        })
      : null;
  const feeDebitEntry =
    feeCoinMicros > 0n
      ? buildCoinMovement({
          userId: input.userId,
          operationType: "fee_debit",
          availableDeltaCoinMicros:
            quote.action === "sell" ? -feeCoinMicros : 0n,
          reservedDeltaCoinMicros:
            quote.action === "buy" ? -feeCoinMicros : 0n,
          idempotencyKey: `trade:${order.id}:fee`,
          sourceId: order.id,
          reason: "Debit Coin trading fee",
          auditMetadata: commonMetadata,
        })
      : null;
  const releaseEntry =
    releasedCoinMicros > 0n
      ? buildCoinMovement({
          userId: input.userId,
          operationType: "trade_release",
          availableDeltaCoinMicros: releasedCoinMicros,
          reservedDeltaCoinMicros: -releasedCoinMicros,
          idempotencyKey: `trade:${order.id}:release:unused`,
          sourceId: order.id,
          reason: "Release unused Coin trade reserve",
          auditMetadata: commonMetadata,
        })
      : null;

  return {
    commit: {
      orderId: order.id,
      expectedUserId: input.userId,
      expectedIdempotencyKey: input.idempotencyKey,
      terminalStatus: partial ? "partially_filled" : "filled",
      filledCoinMicros,
      feeCoinMicros,
      releasedCoinMicros,
      executedShares: tradeRecord.shares,
      executedPriceNanos,
      provider: input.realExecutionRuntime?.provider ?? "local-simulated",
      providerOrderId: execution.providerOrderId ?? `local:${order.id}`,
      providerTradeId: execution.providerTradeId,
      tradeDebitEntry,
      feeDebitEntry,
      tradeCreditEntry,
      releaseEntry,
      trade: tradeRecord,
      positions: nextSharesMicros > 0n ? [positionWrite] : [],
      deletePositions:
        nextSharesMicros === 0n
          ? [
              {
                userId: input.userId,
                marketId: quote.marketId,
                side: quote.side,
              },
            ]
          : [],
      auditEvent: buildCoinOrderAuditEvent({
        eventType: input.tradingMode.realMoneyEnabled
          ? quote.action === "buy"
            ? "trading.buy_real"
            : "trading.sell_real"
          : quote.action === "buy"
            ? "trading.buy_local"
            : "trading.sell_local",
        userId: input.userId,
        sessionId: input.audit?.sessionId,
        orderId: order.id,
        quote,
        metadata: {
          ...input.audit?.metadata,
          tradeId,
          filledCoinMicros: filledCoinMicros.toString(),
          feeCoinMicros: feeCoinMicros.toString(),
          releasedCoinMicros: releasedCoinMicros.toString(),
          partial,
        },
      }),
      outboxPayload: {
        orderId: order.id,
        tradeId,
        userId: input.userId,
        filledCoinMicros: filledCoinMicros.toString(),
        feeCoinMicros: feeCoinMicros.toString(),
        releasedCoinMicros: releasedCoinMicros.toString(),
        partial,
      },
    },
  };
}

async function mapCoinPositions(
  rows: PositionRecord[],
  marketResolver?: PortfolioMarketResolver,
): Promise<CoinTradingPosition[]> {
  const marketIds = [...new Set(rows.map((row) => row.marketId))];
  const markets = new Map<string, NormalizedMarketDetail>();
  if (marketResolver) {
    const results = await Promise.allSettled(
      marketIds.map((marketId) => marketResolver(marketId)),
    );
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const marketId = marketIds[index];
      if (result?.status === "fulfilled" && result.value && marketId) {
        markets.set(marketId, result.value);
      }
    }
  }
  const byMarket = new Map<string, CoinTradingPosition>();
  for (const row of rows) {
    const sharesMicros = parseStoredSharesMicros(row.shares);
    const costMicros = BigInt(row.totalCostCoinMicros ?? "0");
    const market = markets.get(row.marketId);
    const livePriceNanos = market
      ? getOutcomePriceNanos(market, row.side)
      : null;
    const storedPriceNanos =
      row.lastPriceNanos !== null && row.lastPriceNanos !== undefined
        ? BigInt(row.lastPriceNanos)
        : row.lastPrice
          ? parseClobPriceNanos(row.lastPrice)
          : 0n;
    const currentPriceNanos = livePriceNanos ?? storedPriceNanos;
    const valueMicros = multiplyDivide(
      sharesMicros,
      currentPriceNanos,
      PRICE_NANOS_SCALE,
      "down",
    );
    const existing =
      byMarket.get(row.marketId) ??
      ({
        id: row.id,
        userId: row.userId,
        marketId: row.marketId,
        marketTitle: market?.title ?? row.marketTitle,
        yesShares: "0",
        noShares: "0",
        yesCostCoinMicros: "0",
        noCostCoinMicros: "0",
        totalCostCoinMicros: "0",
        averagePrice: "0",
        currentPrice: "0",
        lastYesPrice: null,
        lastNoPrice: null,
        currentValueCoinMicros: "0",
        pnlCoinMicros: "0",
        lastTradeAt: row.updatedAt,
      } satisfies CoinTradingPosition);
    if (row.side === "yes") {
      existing.yesShares = formatAtomic(sharesMicros, CLOB_SHARE_DECIMALS);
      existing.yesCostCoinMicros = costMicros.toString();
      existing.lastYesPrice = formatAtomic(storedPriceNanos, CLOB_PRICE_DECIMALS);
    } else {
      existing.noShares = formatAtomic(sharesMicros, CLOB_SHARE_DECIMALS);
      existing.noCostCoinMicros = costMicros.toString();
      existing.lastNoPrice = formatAtomic(storedPriceNanos, CLOB_PRICE_DECIMALS);
    }
    const nextCost = BigInt(existing.totalCostCoinMicros) + costMicros;
    const nextValue = BigInt(existing.currentValueCoinMicros) + valueMicros;
    const totalShares =
      parseStoredSharesMicros(existing.yesShares) +
      parseStoredSharesMicros(existing.noShares);
    existing.totalCostCoinMicros = nextCost.toString();
    existing.currentValueCoinMicros = nextValue.toString();
    existing.pnlCoinMicros = (nextValue - nextCost).toString();
    existing.averagePrice =
      totalShares > 0n
        ? formatAtomic(
            multiplyDivide(
              nextCost,
              PRICE_NANOS_SCALE,
              totalShares,
              "down",
            ),
            CLOB_PRICE_DECIMALS,
          )
        : "0";
    existing.currentPrice =
      totalShares > 0n
        ? formatAtomic(
            multiplyDivide(
              nextValue,
              PRICE_NANOS_SCALE,
              totalShares,
              "down",
            ),
            CLOB_PRICE_DECIMALS,
          )
        : "0";
    if (Date.parse(row.updatedAt) > Date.parse(existing.lastTradeAt)) {
      existing.lastTradeAt = row.updatedAt;
    }
    byMarket.set(row.marketId, existing);
  }
  return [...byMarket.values()];
}

function mapCoinTradeRecord(row: TradeRecord): CoinTrade {
  const metadata = row.metadata ?? {};
  return {
    id: row.id,
    executionOrderId: row.executionOrderId ?? null,
    userId: row.userId,
    marketId: row.marketId,
    marketTitle:
      typeof metadata.marketTitle === "string" ? metadata.marketTitle : row.marketId,
    side: row.side,
    action: row.tradeType,
    amountCoinMicros: row.amountCoinMicros ?? "0",
    stakeCoinMicros:
      typeof metadata.stakeCoinMicros === "string"
        ? metadata.stakeCoinMicros
        : row.amountCoinMicros ?? "0",
    feeCoinMicros: row.feeCoinMicros ?? "0",
    price:
      row.priceNanos && BigInt(row.priceNanos) > 0n
        ? formatAtomic(BigInt(row.priceNanos), CLOB_PRICE_DECIMALS)
        : row.price,
    shares: row.shares,
    realizedPnlCoinMicros: row.realizedPnlCoinMicros ?? null,
    status:
      metadata.executionStatus === "partially_filled"
        ? "partially_filled"
        : "filled",
    providerOrderId:
      typeof metadata.providerOrderId === "string"
        ? metadata.providerOrderId
        : null,
    providerTradeId:
      typeof metadata.providerTradeId === "string"
        ? metadata.providerTradeId
        : null,
    idempotencyKey: row.idempotencyKey ?? "",
    createdAt: row.createdAt,
  };
}

function mapCoinSettlementHistory(
  payout: SettlementPayoutRecord,
): CoinSettlementHistoryItem {
  return {
    id: payout.id,
    marketId: payout.marketId,
    settlementId: payout.settlementId,
    side: payout.side,
    originalStakeCoinMicros: payout.originalStakeCoinMicros ?? "0",
    payoutCoinMicros: payout.payoutCoinMicros ?? "0",
    profitCoinMicros: payout.profitCoinMicros ?? "0",
    kind: payout.kind,
    createdAt: payout.createdAt,
  };
}

function coinQuoteFromTrade(
  trade: CoinTrade,
  original: CoinTradingQuote,
): CoinTradingQuote {
  return {
    ...original,
    id: trade.id,
    price: trade.price,
    shares: trade.shares,
    amountCoinMicros: trade.amountCoinMicros,
    stakeCoinMicros: trade.stakeCoinMicros,
    feeCoinMicros: trade.feeCoinMicros,
    estimatedCostCoinMicros:
      trade.action === "buy"
        ? (
            BigInt(trade.stakeCoinMicros) + BigInt(trade.feeCoinMicros)
          ).toString()
        : "0",
    estimatedProceedsCoinMicros:
      trade.action === "sell"
        ? (
            BigInt(trade.amountCoinMicros) - BigInt(trade.feeCoinMicros)
          ).toString()
        : "0",
    createdAt: trade.createdAt,
  };
}

function buildCoinMovement(
  input: Omit<PostCoinEntryInput, "sourceType">,
): PostCoinEntryInput {
  return {
    ...input,
    sourceType: "trade_execution_order",
  };
}

function coinOrderMetadata(quote: CoinTradingQuote) {
  return {
    marketId: quote.marketId,
    marketTitle: quote.marketTitle,
    side: quote.side,
    action: quote.action,
    price: quote.price,
    shares: quote.shares,
    stakeCoinMicros: quote.stakeCoinMicros,
    feeCoinMicros: quote.feeCoinMicros,
  };
}

function buildCoinOrderAuditEvent(input: {
  eventType: AuditEvent["eventType"];
  userId: string;
  sessionId?: string | null;
  orderId: string;
  quote: CoinTradingQuote;
  metadata?: Record<string, unknown>;
}): AuditEvent {
  return {
    id: randomUUID(),
    eventType: input.eventType,
    userId: input.userId,
    sessionId: input.sessionId ?? null,
    metadata: {
      orderId: input.orderId,
      ...coinOrderMetadata(input.quote),
      ...input.metadata,
    },
    createdAt: new Date().toISOString(),
  };
}

function buildCoinOrderFingerprint(value: Record<string, string>) {
  return createHash("sha256")
    .update(JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]])))
    .digest("hex");
}

function getOutcomePriceNanos(
  market: NormalizedMarketDetail,
  side: TradeSide,
): bigint | null {
  const price = market.outcomes.find(
    (outcome) => outcome.name.toLowerCase() === side,
  )?.priceDecimal;
  if (!price) {
    return null;
  }
  try {
    return parseClobPriceNanos(normalizeClobPrice(price));
  } catch {
    return null;
  }
}

function getClobTokenId(market: NormalizedMarketDetail, side: TradeSide) {
  return (
    market.outcomes.find((outcome) => outcome.name.toLowerCase() === side)
      ?.clobTokenId ?? null
  );
}

function parseCoinMicrosString(value: string | undefined): bigint {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    throw new Error("invalid Coin micros");
  }
  return BigInt(value);
}

function parseClobSharesMicros(value: string | undefined): bigint {
  if (!value) throw new Error("shares are required");
  return parseDecimalToAtomic(normalizeClobShares(value), CLOB_SHARE_DECIMALS, {
    allowZero: false,
  });
}

function parseStoredSharesMicros(value: string): bigint {
  return parseStoredDecimalToAtomic(
    value,
    CLOB_SHARE_DECIMALS,
    {
      allowZero: true,
    },
  );
}

function parseClobPriceNanos(value: string): bigint {
  return parseDecimalToAtomic(normalizeClobPrice(value), CLOB_PRICE_DECIMALS, {
    allowZero: false,
  });
}

function getAvailablePositionSharesMicros(
  positions: PositionRecord[],
  marketId: string,
  side: TradeSide,
) {
  return positions
    .filter((position) => position.marketId === marketId && position.side === side)
    .reduce(
      (sum, position) => sum + parseStoredSharesMicros(position.shares),
      0n,
    );
}

function clobQuoteAmountToMicrosFromSdk(value: number, allowZero = false) {
  if (allowZero && value === 0) return 0n;
  return parseDecimalToAtomic(clobSdkNumberToDecimal(value, 6), 6, {
    allowZero: false,
  });
}

function isAmbiguousExecutionError(error: unknown) {
  if (error instanceof CoinExecutionReconciliationError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|unknown|connection reset|socket hang up|econnreset/i.test(
    message,
  );
}

function formatSignedRatio(numerator: bigint, denominator: bigint, decimals: number) {
  if (denominator <= 0n) return "0";
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const scaled = multiplyDivide(
    absolute,
    10n ** BigInt(decimals),
    denominator,
    "down",
  );
  return `${negative ? "-" : ""}${formatAtomic(scaled, decimals)}`;
}
