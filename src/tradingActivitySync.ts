import type { MarketActivityRepository } from "./marketActivityRepository.js";
import type { PortfolioResponse, Trade } from "./trading.js";

type SuccessfulOrderResult = {
  ok: true;
  trade: Trade;
  portfolio: PortfolioResponse;
};

export async function syncTradingMarketActivity({
  repository,
  displayName,
  result,
}: {
  repository?: MarketActivityRepository;
  displayName: string;
  result: SuccessfulOrderResult;
}) {
  if (!repository?.recordTrade) {
    return null;
  }

  const trade = await repository.recordTrade({
    id: result.trade.id,
    marketId: result.trade.marketId,
    userId: result.trade.userId,
    displayName,
    side: result.trade.side,
    action: result.trade.action,
    amount: result.trade.stakeAmount ?? result.trade.amount,
    price: result.trade.price,
    shares: result.trade.shares,
    createdAt: result.trade.createdAt,
  });

  const position = result.portfolio.positions.find(
    (candidate) => candidate.marketId === result.trade.marketId,
  );

  if (!repository.upsertPosition || !repository.deletePosition) {
    return trade;
  }

  for (const side of ["yes", "no"] as const) {
    const shares = side === "yes" ? position?.yesShares ?? 0 : position?.noShares ?? 0;
    const totalCost = side === "yes" ? position?.yesCost ?? 0 : position?.noCost ?? 0;
    const lastPrice =
      side === "yes" ? position?.lastYesPrice ?? null : position?.lastNoPrice ?? null;

    if (!position || shares <= 0) {
      await repository.deletePosition({
        marketId: result.trade.marketId,
        userId: result.trade.userId,
        side,
      });
      continue;
    }

    const price = lastPrice ?? (shares > 0 ? totalCost / shares : 0);
    const value = shares * (price ?? 0);

    await repository.upsertPosition({
      id: `${result.trade.marketId}:${result.trade.userId}:${side}`,
      userId: result.trade.userId,
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

  return trade;
}
