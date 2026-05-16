import { categoryFallbackImagePools, categoryFallbackImages } from "./constants";
import type { Market, LocalPosition, PortfolioSummary, RelatedMarket } from "./types";

type MarketImageLike = Pick<Market, "id" | "slug" | "title" | "category"> & {
  image?: string | null;
  icon?: string | null;
};

export function getMarketKind(market: Market) {
  const text = `${market.category ?? ""} ${market.title}`.toLowerCase();

  if (text.includes("bitcoin") || text.includes("crypto") || text.includes("btc")) {
    return "Crypto";
  }

  if (
    text.includes("nba") ||
    text.includes("nfl") ||
    text.includes("nhl") ||
    text.includes("cup") ||
    text.includes("match")
  ) {
    return "Sports";
  }

  if (text.includes("gta") || text.includes("game")) {
    return "Gaming";
  }

  if (text.includes("album") || text.includes("movie") || text.includes("music")) {
    return "Culture";
  }

  return market.category_label ?? market.category ?? "Market";
}

export function getSourceImage(market: MarketImageLike) {
  return market.image ?? market.icon ?? null;
}

export function getFallbackImage(market: MarketImageLike) {
  const pool = getFallbackImagePool(market);

  return pool[getStableImageIndex(getMarketImageKey(market), pool.length)] ?? categoryFallbackImages.markets;
}

export function getLastResortImage(market: MarketImageLike) {
  return getFallbackImage(market);
}

export function getFallbackImagePool(market: MarketImageLike) {
  const category = (market.category ?? "markets").toLowerCase();
  const pool = categoryFallbackImagePools[category] ?? categoryFallbackImagePools.markets;

  return pool.length > 0 ? pool : [categoryFallbackImages.markets];
}

function getMarketImageKey(market: MarketImageLike) {
  return market.id || market.slug || market.title || market.category || "market";
}

function getStableImageIndex(key: string, poolLength: number) {
  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }

  return poolLength > 0 ? hash % poolLength : 0;
}

function getListFallbackImage(market: MarketImageLike, usedImages: Set<string>) {
  const pool = getFallbackImagePool(market);
  const startIndex = getStableImageIndex(getMarketImageKey(market), pool.length);

  for (let offset = 0; offset < pool.length; offset += 1) {
    const candidate = pool[(startIndex + offset) % pool.length];

    if (!usedImages.has(candidate)) {
      return candidate;
    }
  }

  return pool[startIndex] ?? categoryFallbackImages.markets;
}

export function getRelatedMarketDisplayImage(relatedMarket: RelatedMarket) {
  return getSourceImage(relatedMarket) ?? getFallbackImage(relatedMarket);
}

export function withUniqueImages(markets: Market[]) {
  const usedDisplayImages = new Set<string>();

  return markets.map((market) => {
    const source = getSourceImage(market);
    const displayImage = source ?? getListFallbackImage(market, usedDisplayImages);

    usedDisplayImages.add(displayImage);

    return {
      ...market,
      displayImage,
    };
  });
}

export function withDetailImage(market: Market, fallback?: Market | null): Market {
  return {
    ...market,
    displayImage:
      market.displayImage ??
      fallback?.displayImage ??
      getSourceImage(market) ??
      getFallbackImage(market),
  };
}

export function getPositionMarket(position: LocalPosition, markets: Market[]) {
  return markets.find((market) => market.id === position.marketId) ?? null;
}

export function getSidePrice(market: Market | null, side: "yes" | "no", fallback: number) {
  if (!market) {
    return fallback;
  }

  const price =
    market.outcomes.find((outcome) => outcome.name.toLowerCase() === side)?.price ??
    market.prices?.[side] ??
    null;

  return price === null ? fallback : price;
}

export function getPositionShares(position: LocalPosition) {
  return position.yesShares + position.noShares;
}

export function getOutcomeActionLabel(outcomeName: string, isBinaryMarket: boolean) {
  const trimmedName = outcomeName.trim();
  const normalizedName = trimmedName.toLowerCase();

  if (!isBinaryMarket) {
    return trimmedName || "Trade";
  }

  if (normalizedName === "yes") {
    return "Yes";
  }

  if (normalizedName === "no") {
    return "No";
  }

  return trimmedName || "Trade";
}

export function getAveragePositionPrice(position: LocalPosition) {
  const shares = getPositionShares(position);

  return shares > 0 ? position.totalCost / shares : 0;
}

export function getPositionValue(position: LocalPosition, market: Market | null) {
  const fallbackPrice = getAveragePositionPrice(position);
  const yesValue = position.yesShares * getSidePrice(market, "yes", fallbackPrice);
  const noValue = position.noShares * getSidePrice(market, "no", fallbackPrice);

  return yesValue + noValue;
}

export function getPositionPnl(position: LocalPosition, market: Market | null) {
  return getPositionValue(position, market) - position.totalCost;
}

export function getPortfolioSummary(
  portfolio: {
    wallet: { balance: number; initialBalance: number };
    positions: LocalPosition[];
  },
  markets: Market[],
): PortfolioSummary {
  const positionValue = portfolio.positions.reduce((total, position) => {
    return total + getPositionValue(position, getPositionMarket(position, markets));
  }, 0);
  const invested = portfolio.positions.reduce(
    (total, position) => total + position.totalCost,
    0,
  );
  const equity = portfolio.wallet.balance + positionValue;
  const pnl = equity - portfolio.wallet.initialBalance;

  return {
    cash: portfolio.wallet.balance,
    positionValue,
    invested,
    equity,
    pnl,
    pnlPercent: portfolio.wallet.initialBalance > 0 ? pnl / portfolio.wallet.initialBalance : 0,
    openPositions: portfolio.positions.length,
  };
}
