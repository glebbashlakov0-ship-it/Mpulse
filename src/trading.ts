import { randomUUID } from "node:crypto";
import type { NormalizedMarketDetail } from "./types.js";
import type { LedgerService } from "./ledger.js";
import type { PortfolioRepository, PositionRecord, TradeRecord } from "./portfolioRepository.js";
import type { SettlementPayoutRecord } from "./settlement.js";
import { calculatePlatformFee, roundMoney } from "./tradingEconomics.js";

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
  user: LocalUser;
  wallet: { balance: number };
  positions: LocalPosition[];
  trades: Trade[];
  settlements: SettlementHistoryItem[];
  summary: PortfolioSummary;
};

type PlaceTradeInput = {
  market: NormalizedMarketDetail;
  side: TradeSide;
  amount: number;
  userId?: string;
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
  ledger: LedgerService;
  portfolioRepository?: PortfolioRepository;
  settlementRepository?: SettlementHistoryRepository;
};

export type TradingOrderInput = TradingQuoteInput & {
  idempotencyKey?: string | null;
};

export type TradingQuote = {
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
  | "MARKET_NOT_TRADABLE"
  | "MARKET_CLOSED"
  | "PRICE_UNAVAILABLE"
  | "INVALID_AMOUNT"
  | "ORDER_AMOUNT_OUT_OF_RANGE"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_SHARES";

type TradingError = {
  ok: false;
  code: TradingErrorCode;
  message: string;
};

type TradingOrderSuccess = {
  ok: true;
  quote: TradingQuote;
  trade: Trade;
  portfolio: PortfolioResponse;
  idempotent: boolean;
};

type SettlementHistoryRepository = {
  listPayoutsByUserId?(userId: string, limit?: number): Promise<SettlementPayoutRecord[]>;
};

const INITIAL_MOCK_BALANCE = 10_000;
const DEMO_USER_ID = "local-user";
const MIN_ORDER_AMOUNT = 1;
const MAX_ORDER_AMOUNT = 100_000;

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
): Promise<PortfolioResponse> {
  const state = await getTradingState(userId, portfolioRepository);
  const positions = state.positions.map(withComputedPosition);
  const balance = await ensureLocalBalance(userId, ledger);
  const settlements = await getSettlementHistory(userId, ledger, settlementRepository);

  return {
    user: state.user,
    wallet: { balance: balance.availableBalance },
    positions,
    trades: state.trades,
    settlements,
    summary: await getPortfolioSummary(state, ledger, userId, settlements),
  };
}

export async function resetPortfolio(
  userId = DEMO_USER_ID,
  ledger: LedgerService,
  portfolioRepository?: PortfolioRepository,
  settlementRepository?: SettlementHistoryRepository,
): Promise<PortfolioResponse> {
  portfoliosByUserId.set(userId, createInitialState(userId));
  await portfolioRepository?.clearUserPortfolio(userId);
  
  // Reset ledger balance by creating an adjustment entry
  const balance = await ledger.getBalance({
    userId,
    asset: "USDT",
    walletId: null,
  });
  
  if (balance.availableBalance !== INITIAL_MOCK_BALANCE) {
    const adjustment = INITIAL_MOCK_BALANCE - balance.availableBalance;
    await ledger.createEntry({
      userId,
      walletId: null,
      asset: "USDT",
      entryType: adjustment > 0 ? "credit" : "debit",
      amount: Math.abs(adjustment),
      reason: "Pulse Market portfolio reset",
      referenceType: "local_reset",
      referenceId: userId,
      idempotencyKey: `local-reset:${userId}:${Date.now()}`,
      metadata: {
        resetBalance: INITIAL_MOCK_BALANCE,
        previousBalance: balance.availableBalance,
      },
    });
  }

  return getPortfolio(userId, ledger, portfolioRepository, settlementRepository);
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
  ledger,
  portfolioRepository,
}: TradingQuoteInput): Promise<{ ok: true; quote: TradingQuote } | TradingError> {
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

  const balance = await ensureLocalBalance(userId, ledger);
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
      createdAt: new Date().toISOString(),
    },
  };
}

export async function placeLocalOrder(
  input: TradingOrderInput,
): Promise<TradingOrderSuccess | TradingError> {
  const userId = input.userId ?? DEMO_USER_ID;
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
        );
        const trade = mapTradeRecord(previousTrade);
        return {
          ok: true,
          quote: quoteFromTrade(trade),
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
        ),
        idempotent: true,
      };
    }
  }

  const quoteResult = await createTradingQuote({ ...input, userId });
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

  const now = new Date().toISOString();
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

  // Create ledger entry for the trade
  const ledgerIdempotencyKey = normalizedIdempotencyKey ?? `local-trade:${trade.id}`;
  await input.ledger.createEntry({
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
    },
  });

  state.trades = [trade, ...state.trades].slice(0, 200);
  state.positions =
    getPositionShares(nextPosition) > 0
      ? [
          nextPosition,
          ...state.positions.filter((position) => position.marketId !== quote.marketId),
        ]
      : state.positions.filter((position) => position.marketId !== quote.marketId);

  if (input.portfolioRepository) {
    await persistTradeState({
      repository: input.portfolioRepository,
      trade,
      position: nextPosition,
    });
  }

  const result: TradingOrderSuccess = {
    ok: true,
    quote,
    trade,
    portfolio: await getPortfolio(
      userId,
      input.ledger,
      input.portfolioRepository,
      input.settlementRepository,
    ),
    idempotent: false,
  };

  if (normalizedIdempotencyKey) {
    state.idempotencyResults.set(normalizedIdempotencyKey, result);
  }

  return result;
}

export async function placeTrade({
  market,
  side,
  amount,
  userId = DEMO_USER_ID,
  ledger,
  portfolioRepository,
}: PlaceTradeInput) {
  return placeLocalOrder({ market, side, action: "buy", amount, userId, ledger, portfolioRepository });
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
  return {
    id: row.id,
    userId: row.userId,
    walletId: row.walletId ?? getWalletId(row.userId),
    marketId: row.marketId,
    marketTitle: marketTitle ?? row.marketId,
    side: row.side,
    action: row.tradeType,
    amount: Number(row.amount),
    price: Number(row.price),
    shares: Number(row.shares),
    realizedPnl: null,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

function quoteFromTrade(trade: Trade): TradingQuote {
  const price = trade.price;
  const amount = trade.amount;
  const fee = trade.platformFee ?? 0;

  return {
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
  await repository.createTrade({
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
    createdAt: trade.createdAt,
  });

  await persistSidePosition(repository, position, "yes");
  await persistSidePosition(repository, position, "no");
}

async function persistSidePosition(
  repository: PortfolioRepository,
  position: LocalPosition,
  side: TradeSide,
) {
  const shares = side === "yes" ? position.yesShares : position.noShares;
  const totalCost = side === "yes" ? position.yesCost : position.noCost;
  const lastPrice = side === "yes" ? position.lastYesPrice : position.lastNoPrice;

  if (shares <= 0) {
    await repository.deletePosition(position.userId, position.marketId, side);
    return;
  }

  await repository.upsertPosition({
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
  });
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
