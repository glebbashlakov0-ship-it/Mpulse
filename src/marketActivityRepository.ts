import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.js";
import { toIsoString } from "./utils.js";

export type MarketCommentRecord = {
  id: string;
  marketId: string;
  userId: string | null;
  displayName: string;
  body: string;
  positionLabel: string | null;
  createdAt: string;
};

export type MarketHolderRecord = {
  id: string;
  userId: string;
  displayName: string;
  yesShares: number;
  noShares: number;
  shares: number;
  value: number;
  updatedAt: string;
};

export type MarketPositionRecord = {
  id: string;
  userId: string;
  displayName: string;
  side: "yes" | "no";
  shares: number;
  totalCost: number;
  averagePrice: number | null;
  lastPrice: number | null;
  value: number;
  pnl: number;
  updatedAt: string;
};

export type MarketTradeActivityRecord = {
  id: string;
  marketId: string;
  userId: string;
  displayName: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  amount: number;
  price: number;
  shares: number;
  createdAt: string;
};

type MarketActivityIdentity = {
  id?: string | null;
  userId?: string | null;
  displayName?: string | null;
  body?: string | null;
};

const legacyDemoUserIds = new Set([
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
]);

const legacyDemoDisplayNames = new Set(["Mila Forecast", "Atlas Trader", "Pulse Demo"]);

export function isLegacyDemoMarketActivity(record: MarketActivityIdentity) {
  const id = record.id?.toLowerCase() ?? "";
  const body = record.body?.toLowerCase() ?? "";

  return (
    id.startsWith("aaaaaaaa-") ||
    id.startsWith("bbbbbbbb-") ||
    id.startsWith("cccccccc-") ||
    legacyDemoUserIds.has(record.userId ?? "") ||
    legacyDemoDisplayNames.has(record.displayName ?? "") ||
    body.includes("ui smoke") ||
    body.includes("demo comment seeded") ||
    body.includes("local setup")
  );
}

export type MarketActivityRepository = {
  listComments(marketId: string, limit?: number): Promise<MarketCommentRecord[]>;
  createComment(comment: {
    marketId: string;
    userId: string | null;
    displayName: string;
    body: string;
    positionLabel?: string | null;
  }): Promise<MarketCommentRecord>;
  listTopHolders(marketId: string, limit?: number): Promise<MarketHolderRecord[]>;
  listPositions(marketId: string, limit?: number): Promise<MarketPositionRecord[]>;
  listTrades(marketId: string, limit?: number): Promise<MarketTradeActivityRecord[]>;
  recordTrade?(trade: Omit<MarketTradeActivityRecord, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
  }): Promise<MarketTradeActivityRecord>;
  upsertPosition?(position: MarketPositionRecord): Promise<void>;
  deletePosition?(input: { marketId: string; userId: string; side: "yes" | "no" }): Promise<void>;
};

export class MemoryMarketActivityRepository implements MarketActivityRepository {
  private readonly comments: MarketCommentRecord[] = [];
  private readonly positions: MarketPositionRecord[] = [];
  private readonly trades: MarketTradeActivityRecord[] = [];

  async listComments(marketId: string, limit = 100) {
    return this.comments
      .filter((comment) => comment.marketId === marketId)
      .slice(0, limit);
  }

  async createComment(comment: {
    marketId: string;
    userId: string | null;
    displayName: string;
    body: string;
    positionLabel?: string | null;
  }) {
    const record: MarketCommentRecord = {
      id: randomUUID(),
      marketId: comment.marketId,
      userId: comment.userId,
      displayName: comment.displayName,
      body: comment.body,
      positionLabel: comment.positionLabel ?? null,
      createdAt: new Date().toISOString(),
    };

    this.comments.unshift(record);
    return record;
  }

  async listTopHolders(marketId: string, limit = 20) {
    const byUser = new Map<string, MarketHolderRecord>();

    for (const position of this.positions.filter((item) => item.id.startsWith(`${marketId}:`))) {
      const existing = byUser.get(position.userId) ?? {
        id: `${marketId}:${position.userId}`,
        userId: position.userId,
        displayName: position.displayName,
        yesShares: 0,
        noShares: 0,
        shares: 0,
        value: 0,
        updatedAt: position.updatedAt,
      };
      const shares = Math.max(0, position.shares);

      if (position.side === "yes") {
        existing.yesShares += shares;
      } else {
        existing.noShares += shares;
      }
      existing.shares += shares;
      existing.value += position.value;
      existing.updatedAt =
        Date.parse(position.updatedAt) > Date.parse(existing.updatedAt)
          ? position.updatedAt
          : existing.updatedAt;
      byUser.set(position.userId, existing);
    }

    return [...byUser.values()]
      .sort((left, right) => right.shares - left.shares || right.value - left.value)
      .slice(0, limit);
  }

  async listPositions(marketId: string, limit = 50) {
    return this.positions
      .filter((position) => position.id === marketId || position.id.startsWith(`${marketId}:`))
      .slice(0, limit);
  }

  async listTrades(marketId: string, limit = 100) {
    return this.trades
      .filter((trade) => trade.marketId === marketId)
      .slice(0, limit);
  }

  async recordTrade(trade: Omit<MarketTradeActivityRecord, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
  }) {
    const record: MarketTradeActivityRecord = {
      id: trade.id ?? randomUUID(),
      marketId: trade.marketId,
      userId: trade.userId,
      displayName: trade.displayName,
      side: trade.side,
      action: trade.action,
      amount: trade.amount,
      price: trade.price,
      shares: trade.shares,
      createdAt: trade.createdAt ?? new Date().toISOString(),
    };

    this.trades.unshift(record);
    return record;
  }

  async upsertPosition(position: MarketPositionRecord) {
    const index = this.positions.findIndex((candidate) => candidate.id === position.id);

    if (position.shares <= 0) {
      if (index >= 0) {
        this.positions.splice(index, 1);
      }
      return;
    }

    if (index >= 0) {
      this.positions[index] = position;
    } else {
      this.positions.unshift(position);
    }
  }

  async deletePosition(input: { marketId: string; userId: string; side: "yes" | "no" }) {
    const index = this.positions.findIndex(
      (position) =>
        position.id === `${input.marketId}:${input.userId}:${input.side}` ||
        (position.userId === input.userId &&
          position.side === input.side &&
          position.id.startsWith(`${input.marketId}:`)),
    );

    if (index >= 0) {
      this.positions.splice(index, 1);
    }
  }
}

type CommentRow = {
  id: string;
  market_external_id: string | null;
  user_id: string | null;
  body: string;
  user_display_name: string | null;
  position_label: string | null;
  joined_display_name: string | null;
  created_at: Date | string;
};

type HolderRow = {
  user_id: string;
  display_name: string | null;
  yes_shares: string | number;
  no_shares: string | number;
  shares: string | number;
  value: string | number;
  updated_at: Date | string;
};

type PositionRow = {
  id: string;
  user_id: string;
  display_name: string | null;
  side: "yes" | "no";
  shares: string | number;
  total_cost: string | number;
  average_price: string | number | null;
  last_price: string | number | null;
  updated_at: Date | string;
};

type TradeRow = {
  id: string;
  market_external_id: string;
  user_id: string;
  display_name: string | null;
  side: "yes" | "no";
  trade_type: "buy" | "sell";
  amount: string | number;
  price: string | number;
  shares: string | number;
  created_at: Date | string;
};

export class PostgresMarketActivityRepository implements MarketActivityRepository {
  constructor(private readonly db: Queryable) {}

  async listComments(marketId: string, limit = 100) {
    const result = await this.db.query<CommentRow>(
      `select
         c.id,
         c.market_external_id,
         c.user_id,
         c.body,
         c.user_display_name,
         c.position_label,
         u.display_name as joined_display_name,
         c.created_at
       from comments c
       left join users u on u.id = c.user_id
       where c.market_external_id = $1 and c.status = 'visible'
       order by c.created_at desc
       limit $2`,
      [marketId, limit],
    );

    return result.rows.map(mapCommentRow);
  }

  async createComment(comment: {
    marketId: string;
    userId: string | null;
    displayName: string;
    body: string;
    positionLabel?: string | null;
  }) {
    const result = await this.db.query<CommentRow>(
      `insert into comments (
         market_external_id, user_id, user_display_name, body, position_label, status
       )
       values ($1, $2, $3, $4, $5, 'visible')
       returning
         id,
         market_external_id,
         user_id,
         body,
         user_display_name,
         position_label,
         null::text as joined_display_name,
         created_at`,
      [
        comment.marketId,
        comment.userId,
        comment.displayName,
        comment.body,
        comment.positionLabel ?? null,
      ],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("Comment insert returned no row.");
    }

    return mapCommentRow(row);
  }

  async listTopHolders(marketId: string, limit = 20) {
    const result = await this.db.query<HolderRow>(
      `select
         p.user_id,
         u.display_name,
         coalesce(sum(case when p.side = 'yes' then p.shares else 0 end), 0) as yes_shares,
         coalesce(sum(case when p.side = 'no' then p.shares else 0 end), 0) as no_shares,
         coalesce(sum(p.shares), 0) as shares,
         coalesce(sum(p.shares * coalesce(p.last_price, p.average_price, 0)), 0) as value,
         max(p.updated_at) as updated_at
       from positions p
       left join users u on u.id = p.user_id
       where p.market_external_id = $1 and p.shares > 0
       group by p.user_id, u.display_name
       order by shares desc, value desc
       limit $2`,
      [marketId, limit],
    );

    return result.rows.map((row) => ({
      id: `${marketId}:${row.user_id}`,
      userId: row.user_id,
      displayName: row.display_name ?? "Trader",
      yesShares: Number(row.yes_shares),
      noShares: Number(row.no_shares),
      shares: Number(row.shares),
      value: Number(row.value),
      updatedAt: toIsoString(row.updated_at),
    }));
  }

  async listPositions(marketId: string, limit = 50) {
    const result = await this.db.query<PositionRow>(
      `select
         p.id,
         p.user_id,
         u.display_name,
         p.side,
         p.shares,
         p.total_cost,
         p.average_price,
         p.last_price,
         p.updated_at
       from positions p
       left join users u on u.id = p.user_id
       where p.market_external_id = $1 and p.shares > 0
       order by p.updated_at desc
       limit $2`,
      [marketId, limit],
    );

    return result.rows.map((row) => {
      const shares = Number(row.shares);
      const totalCost = Number(row.total_cost);
      const averagePrice = row.average_price === null ? null : Number(row.average_price);
      const lastPrice = row.last_price === null ? averagePrice : Number(row.last_price);
      const value = shares * (lastPrice ?? averagePrice ?? 0);

      return {
        id: row.id,
        userId: row.user_id,
        displayName: row.display_name ?? "Trader",
        side: row.side,
        shares,
        totalCost,
        averagePrice,
        lastPrice,
        value,
        pnl: value - totalCost,
        updatedAt: toIsoString(row.updated_at),
      };
    });
  }

  async listTrades(marketId: string, limit = 100) {
    const result = await this.db.query<TradeRow>(
      `select
         t.id,
         t.market_external_id,
         t.user_id,
         u.display_name,
         t.side,
         t.trade_type,
         t.amount,
         t.price,
         t.shares,
         t.created_at
       from trades t
       left join users u on u.id = t.user_id
       where t.market_external_id = $1
       order by t.created_at desc
       limit $2`,
      [marketId, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      marketId: row.market_external_id,
      userId: row.user_id,
      displayName: row.display_name ?? "Trader",
      side: row.side,
      action: row.trade_type,
      amount: Number(row.amount),
      price: Number(row.price),
      shares: Number(row.shares),
      createdAt: toIsoString(row.created_at),
    }));
  }
}

function mapCommentRow(row: CommentRow): MarketCommentRecord {
  return {
    id: row.id,
    marketId: row.market_external_id ?? "",
    userId: row.user_id,
    displayName: row.joined_display_name ?? row.user_display_name ?? "Trader",
    body: row.body,
    positionLabel: row.position_label,
    createdAt: toIsoString(row.created_at),
  };
}
