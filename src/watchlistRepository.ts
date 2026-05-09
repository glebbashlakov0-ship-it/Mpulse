import type { Queryable } from "./db.js";
import type { NormalizedMarket } from "./types.js";

export type WatchlistRecord = {
  userId: string;
  marketId: string;
  market: NormalizedMarket;
  createdAt: string;
};

export type WatchlistRepository = {
  list(userId: string): Promise<WatchlistRecord[]>;
  upsert(record: Omit<WatchlistRecord, "createdAt">): Promise<WatchlistRecord>;
  delete(userId: string, marketId: string): Promise<void>;
};

export class MemoryWatchlistRepository implements WatchlistRepository {
  private readonly records = new Map<string, WatchlistRecord>();

  async list(userId: string) {
    return [...this.records.values()]
      .filter((record) => record.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async upsert(record: Omit<WatchlistRecord, "createdAt">) {
    const key = `${record.userId}:${record.marketId}`;
    const next = {
      ...record,
      createdAt: this.records.get(key)?.createdAt ?? new Date().toISOString(),
    };
    this.records.set(key, next);
    return next;
  }

  async delete(userId: string, marketId: string) {
    this.records.delete(`${userId}:${marketId}`);
  }
}

type WatchlistRow = {
  user_id: string;
  market_external_id: string;
  market_snapshot: NormalizedMarket;
  created_at: Date | string;
};

export class PostgresWatchlistRepository implements WatchlistRepository {
  constructor(private readonly db: Queryable) {}

  async list(userId: string) {
    const result = await this.db.query<WatchlistRow>(
      `select user_id, market_external_id, market_snapshot, created_at
       from user_watchlist
       where user_id = $1
       order by created_at desc`,
      [userId],
    );

    return result.rows.map((row) => ({
      userId: row.user_id,
      marketId: row.market_external_id,
      market: row.market_snapshot,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async upsert(record: Omit<WatchlistRecord, "createdAt">) {
    const result = await this.db.query<WatchlistRow>(
      `insert into user_watchlist (user_id, market_external_id, market_snapshot)
       values ($1, $2, $3)
       on conflict (user_id, market_external_id) do update set
         market_snapshot = excluded.market_snapshot
       returning user_id, market_external_id, market_snapshot, created_at`,
      [record.userId, record.marketId, JSON.stringify(record.market)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Watchlist upsert returned no row.");
    }
    return {
      userId: row.user_id,
      marketId: row.market_external_id,
      market: row.market_snapshot,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async delete(userId: string, marketId: string) {
    await this.db.query(
      `delete from user_watchlist where user_id = $1 and market_external_id = $2`,
      [userId, marketId],
    );
  }
}
