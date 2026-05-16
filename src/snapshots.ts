import { randomUUID } from "node:crypto";
import type { MarketSnapshot, NormalizedMarket, NormalizedMarketDetail } from "./types.js";

type SnapshotStore = {
  add(snapshot: MarketSnapshot): void;
  listForMarket(marketId: string, limit?: number): MarketSnapshot[];
};

export class MemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, MarketSnapshot[]>();

  add(snapshot: MarketSnapshot): void {
    const current = this.snapshots.get(snapshot.market_id) ?? [];
    current.push(snapshot);
    current.sort((left, right) => left.captured_at.localeCompare(right.captured_at));
    this.snapshots.set(snapshot.market_id, current);
  }

  listForMarket(marketId: string, limit = 240): MarketSnapshot[] {
    const current = this.snapshots.get(marketId) ?? [];
    return current.slice(Math.max(0, current.length - limit));
  }
}

export const marketSnapshotSchema = {
  table: "market_snapshots",
  columns: {
    id: "text primary key",
    market_id: "text not null",
    captured_at: "timestamp with time zone not null",
    prices: "jsonb not null",
    volume: "numeric not null default 0",
    liquidity: "numeric not null default 0",
    source: "text not null",
  },
  indexes: ["market_snapshots_market_id_captured_at_idx"],
};

export function buildSnapshotFromMarket(
  market: NormalizedMarket | NormalizedMarketDetail,
  capturedAt = new Date().toISOString(),
): MarketSnapshot {
  const prices =
    "prices" in market
      ? market.prices
      : {
          yes: market.outcomes[0]?.price ?? market.outcomes[0]?.probability ?? null,
          no: market.outcomes[1]?.price ?? market.outcomes[1]?.probability ?? null,
          best_bid: market.trading.best_bid,
          best_ask: market.trading.best_ask,
          last_trade: market.trading.last_trade_price,
          midpoint:
            market.trading.best_bid !== null && market.trading.best_ask !== null
              ? (market.trading.best_bid + market.trading.best_ask) / 2
              : null,
          spread:
            market.trading.best_bid !== null && market.trading.best_ask !== null
              ? Math.max(0, market.trading.best_ask - market.trading.best_bid)
              : null,
        };

  return {
    id: `polymarket:${market.id}:${capturedAt}:${randomUUID()}`,
    market_id: market.id,
    captured_at: capturedAt,
    prices,
    volume: market.volume,
    liquidity: market.liquidity,
    source: market.source,
  };
}
