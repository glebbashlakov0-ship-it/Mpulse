import type { MarketActivityRepository } from "./marketActivityRepository.js";
import type {
  CoinPortfolioResponse,
  CoinTrade,
  PortfolioResponse,
  Trade,
} from "./trading.js";
import { formatAtomic } from "./money.js";

type SuccessfulOrderResult = {
  ok: true;
  trade: Trade | CoinTrade;
  portfolio: PortfolioResponse | CoinPortfolioResponse;
};

export type TradingMarketActivitySyncResult = {
  trade: Awaited<ReturnType<NonNullable<MarketActivityRepository["recordTrade"]>>> | null;
  error: {
    stage: "trade" | "position";
    message: string;
  } | null;
};

export async function syncTradingMarketActivity({
  repository,
  displayName,
  result,
}: {
  repository?: MarketActivityRepository;
  displayName: string;
  result: SuccessfulOrderResult;
}): Promise<TradingMarketActivitySyncResult> {
  if (!repository?.recordTrade) {
    return { trade: null, error: null };
  }

  const projection = buildMarketActivityProjection(result);
  let trade: TradingMarketActivitySyncResult["trade"] = null;
  try {
    trade = await repository.recordTrade({
      id: projection.trade.id,
      marketId: projection.trade.marketId,
      userId: projection.trade.userId,
      displayName,
      side: projection.trade.side,
      action: projection.trade.action,
      amount: projection.trade.amount,
      price: projection.trade.price,
      shares: projection.trade.shares,
      createdAt: projection.trade.createdAt,
    });
  } catch (error) {
    return {
      trade: null,
      error: {
        stage: "trade",
        message: getErrorMessage(error),
      },
    };
  }

  const position = projection.position;
  const tradeProjection = projection.trade;

  if (!repository.upsertPosition || !repository.deletePosition) {
    return { trade, error: null };
  }

  try {
    for (const side of ["yes", "no"] as const) {
      const shares = side === "yes" ? position?.yesShares ?? 0 : position?.noShares ?? 0;
      const totalCost = side === "yes" ? position?.yesCost ?? 0 : position?.noCost ?? 0;
      const lastPrice =
        side === "yes" ? position?.lastYesPrice ?? null : position?.lastNoPrice ?? null;

      if (!position || shares <= 0) {
        await repository.deletePosition({
          marketId: tradeProjection.marketId,
          userId: tradeProjection.userId,
          side,
        });
        continue;
      }

      const price = lastPrice ?? (shares > 0 ? totalCost / shares : 0);
      const value = shares * (price ?? 0);

      await repository.upsertPosition({
        id: `${tradeProjection.marketId}:${tradeProjection.userId}:${side}`,
        userId: tradeProjection.userId,
        displayName,
        side,
        shares,
        totalCost,
        averagePrice: shares > 0 ? totalCost / shares : null,
        lastPrice,
        value,
        pnl: value - totalCost,
        updatedAt: position.lastTradeAt,
      });
    }
  } catch (error) {
    return {
      trade,
      error: {
        stage: "position",
        message: getErrorMessage(error),
      },
    };
  }

  return { trade, error: null };
}

function buildMarketActivityProjection(result: SuccessfulOrderResult) {
  if ("amountCoinMicros" in result.trade) {
    const coinTrade = result.trade;
    const coinPortfolio = result.portfolio as CoinPortfolioResponse;
    const coinPosition = coinPortfolio.positions.find(
      (candidate) => candidate.marketId === coinTrade.marketId,
    );
    return {
      trade: {
        id: coinTrade.id,
        marketId: coinTrade.marketId,
        userId: coinTrade.userId,
        side: coinTrade.side,
        action: coinTrade.action,
        amount: projectionNumberFromAtomic(coinTrade.stakeCoinMicros, 6),
        price: projectionNumberFromDecimal(coinTrade.price),
        shares: projectionNumberFromDecimal(coinTrade.shares),
        createdAt: coinTrade.createdAt,
      },
      position: coinPosition
        ? {
            yesShares: projectionNumberFromDecimal(coinPosition.yesShares),
            noShares: projectionNumberFromDecimal(coinPosition.noShares),
            yesCost: projectionNumberFromAtomic(
              coinPosition.yesCostCoinMicros,
              6,
            ),
            noCost: projectionNumberFromAtomic(
              coinPosition.noCostCoinMicros,
              6,
            ),
            lastYesPrice:
              coinPosition.lastYesPrice === null
                ? null
                : projectionNumberFromDecimal(coinPosition.lastYesPrice),
            lastNoPrice:
              coinPosition.lastNoPrice === null
                ? null
                : projectionNumberFromDecimal(coinPosition.lastNoPrice),
            lastTradeAt: coinPosition.lastTradeAt,
          }
        : null,
    };
  }

  const legacyTrade = result.trade;
  const legacyPortfolio = result.portfolio as PortfolioResponse;
  return {
    trade: {
      id: legacyTrade.id,
      marketId: legacyTrade.marketId,
      userId: legacyTrade.userId,
      side: legacyTrade.side,
      action: legacyTrade.action,
      amount: legacyTrade.stakeAmount ?? legacyTrade.amount,
      price: legacyTrade.price,
      shares: legacyTrade.shares,
      createdAt: legacyTrade.createdAt,
    },
    position:
      legacyPortfolio.positions.find(
        (candidate) => candidate.marketId === legacyTrade.marketId,
      ) ?? null,
  };
}

function projectionNumberFromAtomic(value: string, decimals: number) {
  return projectionNumberFromDecimal(formatAtomic(BigInt(value), decimals));
}

function projectionNumberFromDecimal(value: string) {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new Error("Market activity projection value is outside the numeric range.");
  }
  return result;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
