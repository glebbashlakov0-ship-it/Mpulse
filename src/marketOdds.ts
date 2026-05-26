import type { MarketTradeActivityRecord } from "./marketActivityRepository.js";
import { calculateNetStake } from "./tradingEconomics.js";
import type { MarketPriceHistoryPoint, NormalizedMarket, NormalizedOutcome } from "./types.js";

const STARTING_BINARY_RESERVE = 100;

export type OwnMarketStats = {
  outcomes: NormalizedOutcome[];
  volume: number;
  volume24h: number;
  liquidity: number;
  yes: number | null;
  no: number | null;
};

type BinaryBook = {
  yesReserve: number;
  noReserve: number;
  volume: number;
  volume24h: number;
};

export function buildOwnMarketStats(
  market: Pick<NormalizedMarket, "outcomes">,
  trades: MarketTradeActivityRecord[],
  now = Date.now(),
): OwnMarketStats {
  const marketOutcomes = market.outcomes.length > 0 ? market.outcomes : getDefaultBinaryOutcomes();

  if (marketOutcomes.length !== 2) {
    const outcomes = normalizeMultiOutcomeDefaults(marketOutcomes);

    return {
      outcomes,
      volume: getTradeVolume(trades),
      volume24h: getTradeVolume(trades, now - 24 * 60 * 60 * 1000),
      liquidity: getTradeVolume(trades),
      yes: outcomes[0]?.price ?? null,
      no: outcomes[1]?.price ?? null,
    };
  }

  const book = applyTradesToBinaryBook(trades, now);
  const prices = getBinaryBookPrices(book);
  const outcomes = applyBinaryOutcomePrices(marketOutcomes, prices.yes, prices.no);

  return {
    outcomes,
    volume: book.volume,
    volume24h: book.volume24h,
    liquidity: Math.max(0, book.yesReserve + book.noReserve - STARTING_BINARY_RESERVE * 2),
    yes: prices.yes,
    no: prices.no,
  };
}

function getDefaultBinaryOutcomes(): NormalizedOutcome[] {
  return [
    { name: "Yes", price: 0.5, probability: 0.5, price_cents: 50, clobTokenId: null },
    { name: "No", price: 0.5, probability: 0.5, price_cents: 50, clobTokenId: null },
  ];
}

export function buildOwnMarketHistory(
  market: Pick<NormalizedMarket, "outcomes">,
  trades: MarketTradeActivityRecord[],
  now = Date.now(),
): MarketPriceHistoryPoint[] {
  if (market.outcomes.length !== 2 || trades.length === 0) {
    return [];
  }

  const book: BinaryBook = {
    yesReserve: STARTING_BINARY_RESERVE,
    noReserve: STARTING_BINARY_RESERVE,
    volume: 0,
    volume24h: 0,
  };
  const recentCutoff = now - 24 * 60 * 60 * 1000;

  return [...trades]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .flatMap((trade) => {
      applyTradeToBinaryBook(book, trade, recentCutoff);
      const timestamp = toIsoTimestamp(trade.createdAt);

      if (!timestamp) {
        return [];
      }

      const prices = getBinaryBookPrices(book);

      return [
        {
          timestamp,
          yes: prices.yes,
          no: prices.no,
          outcomes: applyBinaryOutcomePrices(market.outcomes, prices.yes, prices.no).map(
            (outcome) => ({
              name: outcome.name,
              price: outcome.price,
            }),
          ),
          volume: book.volume,
          liquidity: Math.max(0, book.yesReserve + book.noReserve - STARTING_BINARY_RESERVE * 2),
          synthetic: false,
        } satisfies MarketPriceHistoryPoint,
      ];
    });
}

function applyTradesToBinaryBook(trades: MarketTradeActivityRecord[], now: number): BinaryBook {
  const book: BinaryBook = {
    yesReserve: STARTING_BINARY_RESERVE,
    noReserve: STARTING_BINARY_RESERVE,
    volume: 0,
    volume24h: 0,
  };
  const recentCutoff = now - 24 * 60 * 60 * 1000;

  for (const trade of trades) {
    applyTradeToBinaryBook(book, trade, recentCutoff);
  }

  return book;
}

function applyTradeToBinaryBook(
  book: BinaryBook,
  trade: MarketTradeActivityRecord,
  recentCutoff: number,
) {
  const grossAmount = Math.max(0, trade.amount);
  const netStake = calculateNetStake(grossAmount);
  const signedStake = trade.action === "sell" ? -netStake : netStake;

  book.volume += grossAmount;
  if (Date.parse(trade.createdAt) >= recentCutoff) {
    book.volume24h += grossAmount;
  }

  if (trade.side === "yes") {
    book.yesReserve = Math.max(0, book.yesReserve + signedStake);
  } else {
    book.noReserve = Math.max(0, book.noReserve + signedStake);
  }
}

function getBinaryBookPrices(book: BinaryBook) {
  const total = book.yesReserve + book.noReserve;
  const yes = total > 0 ? clampProbability(book.yesReserve / total) : 0.5;

  return {
    yes,
    no: clampProbability(1 - yes),
  };
}

function applyBinaryOutcomePrices(
  outcomes: NormalizedOutcome[],
  yes: number,
  no: number,
): NormalizedOutcome[] {
  return outcomes.map((outcome, index) => {
    const normalized = outcome.name.trim().toLowerCase();
    const price = normalized === "no" || index === 1 ? no : yes;

    return {
      ...outcome,
      price,
      probability: price,
      price_cents: Math.round(price * 100),
    };
  });
}

function normalizeMultiOutcomeDefaults(outcomes: NormalizedOutcome[]) {
  const price = outcomes.length > 0 ? clampProbability(1 / outcomes.length) : null;

  return outcomes.map((outcome) => ({
    ...outcome,
    price,
    probability: price,
    price_cents: price === null ? null : Math.round(price * 100),
  }));
}

function getTradeVolume(trades: MarketTradeActivityRecord[], since?: number) {
  return trades.reduce((total, trade) => {
    if (since !== undefined && Date.parse(trade.createdAt) < since) {
      return total;
    }

    return total + Math.max(0, trade.amount);
  }, 0);
}

function toIsoTimestamp(value: string) {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function clampProbability(value: number) {
  return Math.min(1, Math.max(0, value));
}
