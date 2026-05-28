import type { Queryable } from "./db.js";
import { toIsoString, toIsoStringOrNull } from "./utils.js";
import type { MarketSnapshot, NormalizedMarket, NormalizedOutcome } from "./types.js";

export type MarketRepository = {
  upsertMarket(market: NormalizedMarket): Promise<void>;
  upsertOutcomes(marketId: string, outcomes: NormalizedOutcome[]): Promise<void>;
  getMarketById(marketId: string): Promise<NormalizedMarket | null>;
  listMarkets(limit?: number): Promise<NormalizedMarket[]>;
  saveSnapshot(snapshot: MarketSnapshot): Promise<void>;
  listSnapshots(marketId: string, limit?: number): Promise<MarketSnapshot[]>;
};

export class MemoryMarketRepository implements MarketRepository {
  private readonly markets = new Map<string, NormalizedMarket>();
  private readonly snapshots = new Map<string, MarketSnapshot[]>();

  async upsertMarket(market: NormalizedMarket) {
    this.markets.set(market.id, market);
  }

  async upsertOutcomes(marketId: string, outcomes: NormalizedOutcome[]) {
    const market = this.markets.get(marketId);
    if (market) {
      this.markets.set(marketId, { ...market, outcomes });
    }
  }

  async getMarketById(marketId: string) {
    return this.markets.get(marketId) ?? null;
  }

  async listMarkets(limit = 100) {
    return [...this.markets.values()].slice(0, limit);
  }

  async saveSnapshot(snapshot: MarketSnapshot) {
    const current = this.snapshots.get(snapshot.market_id) ?? [];
    current.push(snapshot);
    current.sort((left, right) => left.captured_at.localeCompare(right.captured_at));
    this.snapshots.set(snapshot.market_id, current);
  }

  async listSnapshots(marketId: string, limit = 240) {
    const current = this.snapshots.get(marketId) ?? [];
    return current.slice(Math.max(0, current.length - limit));
  }
}

type MarketRow = {
  id: string;
  slug: string | null;
  title: string;
  title_ar: string | null;
  description: string | null;
  category_id: string | null;
  category_label: string | null;
  image: string | null;
  icon: string | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  active: boolean;
  closed: boolean;
  archived: boolean;
  restricted: boolean;
  status: "upcoming" | "live" | "closed" | "expired";
  volume: string | number;
  liquidity: string | number;
  trading: NormalizedMarket["trading"];
  source: "polymarket";
  outcomes: NormalizedOutcome[] | null;
};

type SnapshotRow = {
  id: string;
  market_id: string;
  captured_at: Date | string;
  prices: MarketSnapshot["prices"];
  volume: string | number;
  liquidity: string | number;
  source: "polymarket";
};

export class PostgresMarketRepository implements MarketRepository {
  constructor(private readonly db: Queryable) {}

  async upsertMarket(market: NormalizedMarket) {
    await this.db.query(
      `insert into markets (
         source, external_id, slug, title, title_ar, description, category_id, category_label, image, icon,
         starts_at, ends_at, active, closed, archived, restricted, status, volume, liquidity,
         trading, created_at, updated_at
       )
       values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19,
         $20::jsonb, now(), now()
       )
       on conflict (source, external_id) do update set
         slug = excluded.slug,
         title = excluded.title,
         title_ar = excluded.title_ar,
         description = excluded.description,
         category_id = excluded.category_id,
         category_label = excluded.category_label,
         image = excluded.image,
         icon = excluded.icon,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         active = excluded.active,
         closed = excluded.closed,
         archived = excluded.archived,
         restricted = excluded.restricted,
         status = excluded.status,
         volume = excluded.volume,
         liquidity = excluded.liquidity,
         trading = excluded.trading,
         updated_at = now()`,
      [
        market.source,
        market.id,
        market.slug,
        market.title,
        market.title_ar,
        market.description,
        market.category,
        market.category_label,
        market.image,
        market.icon,
        market.starts_at,
        market.ends_at,
        market.active,
        market.closed,
        market.archived,
        market.restricted,
        getMarketStatus(market),
        market.volume,
        market.liquidity,
        JSON.stringify(market.trading),
      ],
    );
  }

  async upsertOutcomes(marketId: string, outcomes: NormalizedOutcome[]) {
    await this.db.query(
      `delete from market_outcomes
       where market_id = (
         select id from markets where source = 'polymarket' and external_id = $1
       )`,
      [marketId],
    );

    for (const [index, outcome] of outcomes.entries()) {
      await this.db.query(
        `insert into market_outcomes (
           market_id, outcome_index, name, price, probability, price_cents, clob_token_id,
           created_at, updated_at
         )
         values (
           (select id from markets where source = 'polymarket' and external_id = $1),
           $2, $3, $4, $5, $6, $7, now(), now()
         )`,
        [
          marketId,
          index,
          outcome.name,
          outcome.price,
          outcome.probability,
          outcome.price_cents,
          outcome.clobTokenId,
        ],
      );
    }
  }

  async getMarketById(marketId: string) {
    const result = await this.db.query<MarketRow>(
      `select
         m.external_id as id, m.slug, m.title, m.title_ar, m.description, m.category_id, m.category_label,
         m.image, m.icon, m.starts_at, m.ends_at, m.active, m.closed, m.archived, m.restricted,
         m.status, m.volume, m.liquidity, m.trading, m.source,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'name', o.name,
               'price', o.price,
               'probability', o.probability,
               'price_cents', o.price_cents,
               'clobTokenId', o.clob_token_id
             )
             order by o.outcome_index
           ) filter (where o.id is not null),
           '[]'::jsonb
         ) as outcomes
       from markets m
       left join market_outcomes o on o.market_id = m.id
       where m.source = 'polymarket' and m.external_id = $1
       group by m.id
       limit 1`,
      [marketId],
    );

    const row = result.rows[0];
    return row ? mapMarket(row) : null;
  }

  async listMarkets(limit = 100) {
    const result = await this.db.query<MarketRow>(
      `select
         m.external_id as id, m.slug, m.title, m.title_ar, m.description, m.category_id, m.category_label,
         m.image, m.icon, m.starts_at, m.ends_at, m.active, m.closed, m.archived, m.restricted,
         m.status, m.volume, m.liquidity, m.trading, m.source,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'name', o.name,
               'price', o.price,
               'probability', o.probability,
               'price_cents', o.price_cents,
               'clobTokenId', o.clob_token_id
             )
             order by o.outcome_index
           ) filter (where o.id is not null),
           '[]'::jsonb
         ) as outcomes
       from markets m
       left join market_outcomes o on o.market_id = m.id
       where m.source = 'polymarket'
       group by m.id
       order by m.updated_at desc
       limit $1`,
      [limit],
    );

    return result.rows.map(mapMarket);
  }

  async saveSnapshot(snapshot: MarketSnapshot) {
    await this.db.query(
      `insert into market_snapshots (
         source_snapshot_id, market_id, market_external_id, captured_at, prices, volume, liquidity, source,
         created_at
       )
       values (
         $1,
         (select id from markets where source = 'polymarket' and external_id = $2),
         $2, $3, $4::jsonb, $5, $6, $7, now()
       )
       on conflict (source_snapshot_id) do nothing`,
      [
        snapshot.id,
        snapshot.market_id,
        snapshot.captured_at,
        JSON.stringify(snapshot.prices),
        snapshot.volume,
        snapshot.liquidity,
        snapshot.source,
      ],
    );
  }

  async listSnapshots(marketId: string, limit = 240) {
    const result = await this.db.query<SnapshotRow>(
      `select source_snapshot_id as id, market_external_id as market_id, captured_at, prices, volume, liquidity, source
       from market_snapshots
       where source = 'polymarket' and market_external_id = $1
       order by captured_at desc
       limit $2`,
      [marketId, limit],
    );

    return result.rows.reverse().map(mapSnapshot);
  }
}

function mapMarket(row: MarketRow): NormalizedMarket {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    title_ar: row.title_ar,
    description: row.description,
    category: row.category_id,
    category_label: row.category_label,
    topics: row.category_id ? [row.category_id] : [],
    image: row.image,
    icon: row.icon,
    starts_at: toIsoStringOrNull(row.starts_at),
    ends_at: toIsoStringOrNull(row.ends_at),
    status: row.closed || row.archived ? "closed" : "live",
    active: row.active,
    closed: row.closed,
    archived: row.archived,
    restricted: row.restricted,
    volume: Number(row.volume),
    liquidity: Number(row.liquidity),
    outcomes: row.outcomes ?? [],
    trading: row.trading,
    event_id: null,
    event_slug: null,
    event_title: null,
    groupItemTitle: null,
    groupItemThreshold: null,
    canonical_market_id: row.id,
    canonical_event_slug: null,
    source: row.source,
  };
}

function mapSnapshot(row: SnapshotRow): MarketSnapshot {
  return {
    id: row.id,
    market_id: row.market_id,
    captured_at: toIsoString(row.captured_at),
    prices: row.prices,
    volume: Number(row.volume),
    liquidity: Number(row.liquidity),
    source: row.source,
  };
}

function getMarketStatus(market: NormalizedMarket) {
  const now = Date.now();
  const startsAt = market.starts_at ? Date.parse(market.starts_at) : Number.NaN;
  const endsAt = market.ends_at ? Date.parse(market.ends_at) : Number.NaN;

  if (market.closed || market.archived) {
    return "closed";
  }
  if (Number.isFinite(endsAt) && endsAt <= now) {
    return "expired";
  }
  if (Number.isFinite(startsAt) && startsAt > now) {
    return "upcoming";
  }
  return "live";
}
