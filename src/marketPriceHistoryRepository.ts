import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.js";
import { numberFromDb, toIsoString } from "./utils.js";

export type MarketPriceHistoryScopeType = "market" | "event";
export type MarketPriceHistorySource = "pulse_seed" | "admin" | "trade";

export type PulseMarketPriceHistoryOutcome = {
  name: string;
  price: number | null;
  volume?: number;
};

export type PulseMarketPriceHistoryPoint = {
  id: string;
  scopeType: MarketPriceHistoryScopeType;
  scopeId: string;
  marketExternalId: string | null;
  capturedAt: string;
  outcomes: PulseMarketPriceHistoryOutcome[];
  yes: number | null;
  no: number | null;
  volume: number;
  liquidity: number;
  source: MarketPriceHistorySource;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SaveMarketPriceHistoryPointInput = Omit<
  PulseMarketPriceHistoryPoint,
  "id" | "createdAt"
> & {
  id?: string;
  createdAt?: string;
};

export type MarketPriceHistoryRepository = {
  listPoints(input: {
    scopeType: MarketPriceHistoryScopeType;
    scopeId: string;
    source?: MarketPriceHistorySource;
    limit?: number;
  }): Promise<PulseMarketPriceHistoryPoint[]>;
  savePoint(point: SaveMarketPriceHistoryPointInput): Promise<PulseMarketPriceHistoryPoint>;
  savePoints(points: SaveMarketPriceHistoryPointInput[]): Promise<PulseMarketPriceHistoryPoint[]>;
  deletePoints(input: {
    scopeType: MarketPriceHistoryScopeType;
    scopeId: string;
    source?: MarketPriceHistorySource;
  }): Promise<number>;
};

export class MemoryMarketPriceHistoryRepository implements MarketPriceHistoryRepository {
  private readonly points: PulseMarketPriceHistoryPoint[] = [];

  async listPoints(input: {
    scopeType: MarketPriceHistoryScopeType;
    scopeId: string;
    source?: MarketPriceHistorySource;
    limit?: number;
  }) {
    const filtered = this.points
      .filter((point) => point.scopeType === input.scopeType && point.scopeId === input.scopeId)
      .filter((point) => (input.source ? point.source === input.source : true))
      .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));

    return typeof input.limit === "number" && input.limit > 0
      ? filtered.slice(Math.max(0, filtered.length - input.limit))
      : filtered;
  }

  async savePoint(input: SaveMarketPriceHistoryPointInput) {
    const point = normalizePointInput(input);
    this.points.push(point);
    this.points.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
    return point;
  }

  async savePoints(points: SaveMarketPriceHistoryPointInput[]) {
    const saved: PulseMarketPriceHistoryPoint[] = [];
    for (const point of points) {
      saved.push(await this.savePoint(point));
    }
    return saved;
  }

  async deletePoints(input: {
    scopeType: MarketPriceHistoryScopeType;
    scopeId: string;
    source?: MarketPriceHistorySource;
  }) {
    const before = this.points.length;
    for (let index = this.points.length - 1; index >= 0; index -= 1) {
      const point = this.points[index];
      if (
        point?.scopeType === input.scopeType &&
        point.scopeId === input.scopeId &&
        (input.source ? point.source === input.source : true)
      ) {
        this.points.splice(index, 1);
      }
    }
    return before - this.points.length;
  }
}

type MarketPriceHistoryRow = {
  id: string;
  scope_type: MarketPriceHistoryScopeType;
  scope_id: string;
  market_external_id: string | null;
  captured_at: Date | string;
  outcomes: PulseMarketPriceHistoryOutcome[] | null;
  yes: string | number | null;
  no: string | number | null;
  volume: string | number;
  liquidity: string | number;
  source: MarketPriceHistorySource;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
};

export class PostgresMarketPriceHistoryRepository implements MarketPriceHistoryRepository {
  constructor(private readonly db: Queryable) {}

  async listPoints(input: {
    scopeType: MarketPriceHistoryScopeType;
    scopeId: string;
    source?: MarketPriceHistorySource;
    limit?: number;
  }) {
    const values: unknown[] = [input.scopeType, input.scopeId];
    const sourceSql = input.source ? `and source = $${values.push(input.source)}` : "";
    const limit = Math.max(1, Math.min(input.limit ?? 2000, 5000));
    values.push(limit);

    const result = await this.db.query<MarketPriceHistoryRow>(
      `select
         id, scope_type, scope_id, market_external_id, captured_at, outcomes, yes, no,
         volume, liquidity, source, created_by, metadata, created_at
       from market_price_history_points
       where scope_type = $1 and scope_id = $2 ${sourceSql}
       order by captured_at desc
       limit $${values.length}`,
      values,
    );

    return result.rows.reverse().map(mapHistoryRow);
  }

  async savePoint(input: SaveMarketPriceHistoryPointInput) {
    const point = normalizePointInput(input);
    const result = await this.db.query<MarketPriceHistoryRow>(
      `insert into market_price_history_points (
         id, scope_type, scope_id, market_external_id, captured_at, outcomes, yes, no,
         volume, liquidity, source, created_by, metadata, created_at, updated_at
       )
       values (
         $1, $2, $3, $4, $5, $6::jsonb, $7, $8,
         $9, $10, $11, $12, $13::jsonb, $14, $14
       )
       returning
         id, scope_type, scope_id, market_external_id, captured_at, outcomes, yes, no,
         volume, liquidity, source, created_by, metadata, created_at`,
      [
        point.id,
        point.scopeType,
        point.scopeId,
        point.marketExternalId,
        point.capturedAt,
        JSON.stringify(point.outcomes),
        point.yes,
        point.no,
        point.volume,
        point.liquidity,
        point.source,
        point.createdBy,
        JSON.stringify(point.metadata),
        point.createdAt,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Market price history insert returned no row.");
    }

    return mapHistoryRow(row);
  }

  async savePoints(points: SaveMarketPriceHistoryPointInput[]) {
    const saved: PulseMarketPriceHistoryPoint[] = [];
    for (const point of points) {
      saved.push(await this.savePoint(point));
    }
    return saved;
  }

  async deletePoints(input: {
    scopeType: MarketPriceHistoryScopeType;
    scopeId: string;
    source?: MarketPriceHistorySource;
  }) {
    const values: unknown[] = [input.scopeType, input.scopeId];
    const sourceSql = input.source ? `and source = $${values.push(input.source)}` : "";
    const result = await this.db.query<{ id: string }>(
      `delete from market_price_history_points
       where scope_type = $1 and scope_id = $2 ${sourceSql}
       returning id`,
      values,
    );

    return result.rows.length;
  }
}

function normalizePointInput(input: SaveMarketPriceHistoryPointInput): PulseMarketPriceHistoryPoint {
  return {
    ...input,
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    outcomes: input.outcomes.map((outcome) => ({
      name: outcome.name,
      price: outcome.price,
      ...(outcome.volume === undefined ? {} : { volume: outcome.volume }),
    })),
  };
}

function mapHistoryRow(row: MarketPriceHistoryRow): PulseMarketPriceHistoryPoint {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    marketExternalId: row.market_external_id,
    capturedAt: toIsoString(row.captured_at),
    outcomes: row.outcomes ?? [],
    yes: row.yes === null ? null : numberFromDb(row.yes),
    no: row.no === null ? null : numberFromDb(row.no),
    volume: numberFromDb(row.volume),
    liquidity: numberFromDb(row.liquidity),
    source: row.source,
    createdBy: row.created_by,
    metadata: row.metadata ?? {},
    createdAt: toIsoString(row.created_at),
  };
}
