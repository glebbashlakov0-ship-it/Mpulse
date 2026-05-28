import type { Queryable } from "./db.js";
import { toIsoString } from "./utils.js";

export type WalletRecord = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON" | null;
  balance: string;
  initialBalance: string;
  createdAt: string;
  updatedAt: string;
};

export type PositionRecord = {
  id: string;
  userId: string;
  marketId: string;
  marketTitle: string;
  side: "yes" | "no";
  shares: string;
  totalCost: string;
  averagePrice: string | null;
  lastPrice: string | null;
  openedAt: string;
  updatedAt: string;
};

export type TradeRecord = {
  id: string;
  userId: string;
  walletId: string | null;
  marketId: string;
  side: "yes" | "no";
  tradeType: "buy" | "sell";
  amount: string;
  price: string;
  shares: string;
  status: "local" | "pending" | "filled" | "rejected" | "cancelled";
  idempotencyKey: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type PositionWriteRecord = PositionRecord;
export type TradeWriteRecord = TradeRecord;

export type PortfolioRepository = {
  getWalletsByUserId(userId: string): Promise<WalletRecord[]>;
  getPositionsByUserId(userId: string): Promise<PositionRecord[]>;
  listPositionsByMarketId(marketId: string): Promise<PositionRecord[]>;
  getTradesByUserId(userId: string, limit?: number): Promise<TradeRecord[]>;
  findTradeByIdempotencyKey(userId: string, idempotencyKey: string): Promise<TradeRecord | null>;
  upsertPosition(position: PositionWriteRecord): Promise<void>;
  deletePosition(userId: string, marketId: string, side: "yes" | "no"): Promise<void>;
  clearMarketPositions(marketId: string): Promise<void>;
  createTrade(trade: TradeWriteRecord): Promise<void>;
  clearUserPortfolio(userId: string): Promise<void>;
};

export class MemoryPortfolioRepository implements PortfolioRepository {
  private readonly positions = new Map<string, PositionRecord>();
  private readonly trades: TradeRecord[] = [];

  async getWalletsByUserId() {
    return [];
  }

  async getPositionsByUserId(userId: string) {
    return [...this.positions.values()]
      .filter((position) => position.userId === userId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async listPositionsByMarketId(marketId: string) {
    return [...this.positions.values()]
      .filter((position) => position.marketId === marketId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async getTradesByUserId(userId: string, limit = 100) {
    return this.trades.filter((trade) => trade.userId === userId).slice(0, limit);
  }

  async findTradeByIdempotencyKey(userId: string, idempotencyKey: string) {
    return (
      this.trades.find(
        (trade) => trade.userId === userId && trade.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async upsertPosition(position: PositionWriteRecord) {
    this.positions.set(position.id, position);
  }

  async deletePosition(userId: string, marketId: string, side: "yes" | "no") {
    for (const [id, position] of this.positions.entries()) {
      if (position.userId === userId && position.marketId === marketId && position.side === side) {
        this.positions.delete(id);
      }
    }
  }

  async clearMarketPositions(marketId: string) {
    for (const [id, position] of this.positions.entries()) {
      if (position.marketId === marketId) {
        this.positions.delete(id);
      }
    }
  }

  async createTrade(trade: TradeWriteRecord) {
    this.trades.unshift(trade);
  }

  async clearUserPortfolio(userId: string) {
    for (const [id, position] of this.positions.entries()) {
      if (position.userId === userId) {
        this.positions.delete(id);
      }
    }

    for (let index = this.trades.length - 1; index >= 0; index -= 1) {
      if (this.trades[index]?.userId === userId) {
        this.trades.splice(index, 1);
      }
    }
  }
}

type WalletRow = {
  id: string;
  user_id: string;
  asset: "USDT";
  network: "TRON" | null;
  balance: string | number;
  initial_balance: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type PositionRow = {
  id: string;
  user_id: string;
  market_external_id: string;
  market_title: string;
  side: "yes" | "no";
  shares: string | number;
  total_cost: string | number;
  average_price: string | number | null;
  last_price: string | number | null;
  opened_at: Date | string;
  updated_at: Date | string;
};

type TradeRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  market_external_id: string;
  side: "yes" | "no";
  trade_type: "buy" | "sell";
  amount: string | number;
  price: string | number;
  shares: string | number;
  status: "local" | "pending" | "filled" | "rejected" | "cancelled";
  idempotency_key: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
};

export class PostgresPortfolioRepository implements PortfolioRepository {
  constructor(private readonly db: Queryable) {}

  async getWalletsByUserId(userId: string) {
    const result = await this.db.query<WalletRow>(
      `select id, user_id, asset, network, balance, initial_balance, created_at, updated_at
       from wallets
       where user_id = $1
       order by created_at asc`,
      [userId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      asset: row.asset,
      network: row.network,
      balance: String(row.balance),
      initialBalance: String(row.initial_balance),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    }));
  }

  async getPositionsByUserId(userId: string) {
    const result = await this.db.query<PositionRow>(
      `select
         id, user_id, market_external_id, market_title, side, shares, total_cost,
         average_price, last_price, opened_at, updated_at
       from positions
       where user_id = $1
       order by updated_at desc`,
      [userId],
    );

    return result.rows.map(mapPositionRow);
  }

  async listPositionsByMarketId(marketId: string) {
    const result = await this.db.query<PositionRow>(
      `select
         id, user_id, market_external_id, market_title, side, shares, total_cost,
         average_price, last_price, opened_at, updated_at
       from positions
       where market_external_id = $1
       order by updated_at desc`,
      [marketId],
    );

    return result.rows.map(mapPositionRow);
  }

  async getTradesByUserId(userId: string, limit = 100) {
    const result = await this.db.query<TradeRow>(
      `select
         id, user_id, wallet_id, market_external_id, side, trade_type, amount, price, shares,
         status, idempotency_key, metadata, created_at
       from trades
       where user_id = $1
       order by created_at desc
       limit $2`,
      [userId, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      walletId: row.wallet_id,
      marketId: row.market_external_id,
      side: row.side,
      tradeType: row.trade_type,
      amount: String(row.amount),
      price: String(row.price),
      shares: String(row.shares),
      status: row.status,
      idempotencyKey: row.idempotency_key,
      metadata: row.metadata ?? {},
      createdAt: toIsoString(row.created_at),
    }));
  }

  async findTradeByIdempotencyKey(userId: string, idempotencyKey: string) {
    const result = await this.db.query<TradeRow>(
      `select
         id, user_id, wallet_id, market_external_id, side, trade_type, amount, price, shares,
         status, idempotency_key, metadata, created_at
       from trades
       where user_id = $1 and idempotency_key = $2
       limit 1`,
      [userId, idempotencyKey],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          walletId: row.wallet_id,
          marketId: row.market_external_id,
          side: row.side,
          tradeType: row.trade_type,
          amount: String(row.amount),
          price: String(row.price),
          shares: String(row.shares),
          status: row.status,
          idempotencyKey: row.idempotency_key,
          metadata: row.metadata ?? {},
          createdAt: toIsoString(row.created_at),
        }
      : null;
  }

  async upsertPosition(position: PositionWriteRecord) {
    await this.db.query(
      `insert into positions (
         id, user_id, market_external_id, market_title, side, shares, total_cost,
         average_price, last_price, opened_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (user_id, market_external_id, side) do update set
         market_title = excluded.market_title,
         shares = excluded.shares,
         total_cost = excluded.total_cost,
         average_price = excluded.average_price,
         last_price = excluded.last_price,
         updated_at = excluded.updated_at`,
      [
        position.id,
        position.userId,
        position.marketId,
        position.marketTitle,
        position.side,
        position.shares,
        position.totalCost,
        position.averagePrice,
        position.lastPrice,
        position.openedAt,
        position.updatedAt,
      ],
    );
  }

  async deletePosition(userId: string, marketId: string, side: "yes" | "no") {
    await this.db.query(
      `delete from positions where user_id = $1 and market_external_id = $2 and side = $3`,
      [userId, marketId, side],
    );
  }

  async clearMarketPositions(marketId: string) {
    await this.db.query(`delete from positions where market_external_id = $1`, [marketId]);
  }

  async createTrade(trade: TradeWriteRecord) {
    await this.db.query(
      `insert into trades (
         id, user_id, wallet_id, market_external_id, side, trade_type, amount, price, shares,
         status, idempotency_key, metadata, created_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing`,
      [
        trade.id,
        trade.userId,
        trade.walletId,
        trade.marketId,
        trade.side,
        trade.tradeType,
        trade.amount,
        trade.price,
        trade.shares,
        trade.status,
        trade.idempotencyKey,
        JSON.stringify(trade.metadata ?? {}),
        trade.createdAt,
      ],
    );
  }

  async clearUserPortfolio(userId: string) {
    await this.db.query(`delete from trades where user_id = $1`, [userId]);
    await this.db.query(`delete from positions where user_id = $1`, [userId]);
  }
}

function mapPositionRow(row: PositionRow): PositionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    marketId: row.market_external_id,
    marketTitle: row.market_title,
    side: row.side,
    shares: String(row.shares),
    totalCost: String(row.total_cost),
    averagePrice: row.average_price === null ? null : String(row.average_price),
    lastPrice: row.last_price === null ? null : String(row.last_price),
    openedAt: toIsoString(row.opened_at),
    updatedAt: toIsoString(row.updated_at),
  };
}
