import type { Queryable } from "./db.js";
import { numberFromDb, toIsoString } from "./utils.js";

export type PlatformActivityType = "deposit" | "payment" | "trade";

export type PlatformActivityItem = {
  id: string;
  type: PlatformActivityType;
  displayName: string;
  amount: number;
  asset: "USDT";
  marketTitle: string | null;
  createdAt: string;
  relativeTime: string;
};

export type PlatformActivityRepository = {
  listRecent(limit?: number): Promise<PlatformActivityItem[]>;
  record?(item: Omit<PlatformActivityItem, "displayName" | "relativeTime"> & {
    displayName?: string | null;
  }): Promise<void>;
};

export class MemoryPlatformActivityRepository implements PlatformActivityRepository {
  private readonly items: PlatformActivityItem[] = [];

  async listRecent(limit = 30) {
    return this.items
      .slice()
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit)
      .map((item) => ({
        ...item,
        relativeTime: formatRelativeTime(item.createdAt),
      }));
  }

  async record(item: Omit<PlatformActivityItem, "displayName" | "relativeTime"> & {
    displayName?: string | null;
  }) {
    this.items.unshift({
      ...item,
      displayName: maskDisplayName(item.displayName ?? "Pulse Trader"),
      relativeTime: formatRelativeTime(item.createdAt),
    });
    this.items.splice(250);
  }
}

type ActivityRow = {
  id: string;
  type: PlatformActivityType;
  display_name: string | null;
  amount: string | number;
  asset: "USDT";
  market_title: string | null;
  created_at: Date | string;
};

export class PostgresPlatformActivityRepository implements PlatformActivityRepository {
  constructor(private readonly db: Queryable) {}

  async listRecent(limit = 30) {
    const result = await this.db.query<ActivityRow>(
      `select *
       from (
         select
           e.id::text as id,
           'deposit'::text as type,
           u.display_name,
           e.amount,
           e.asset,
           null::text as market_title,
           e.created_at
         from wallet_deposit_events e
         left join users u on u.id = e.user_id
         where e.status = 'credited'
           and e.provider = 'admin_seed'
           and coalesce((e.raw_payload -> 'metadata' ->> 'publicActivity')::boolean, false) = true

         union all

         select
           l.id::text as id,
           'payment'::text as type,
           u.display_name,
           l.amount,
           l.asset,
           null::text as market_title,
           l.created_at
         from ledger_entries l
         left join users u on u.id = l.user_id
         where l.reason = 'admin_seed_payment'
           and coalesce((l.metadata ->> 'publicActivity')::boolean, false) = true

         union all

         select
           t.id::text as id,
           'trade'::text as type,
           u.display_name,
           t.amount,
           'USDT'::text as asset,
           m.title as market_title,
           t.created_at
         from trades t
         left join users u on u.id = t.user_id
         left join markets m on m.source = 'polymarket' and m.external_id = t.market_external_id
         where t.status = 'filled'
           and coalesce((t.metadata ->> 'publicActivity')::boolean, true) = true
       ) activity
       order by created_at desc
       limit $1`,
      [Math.max(1, Math.min(limit, 100))],
    );

    return result.rows.map(mapActivityRow);
  }
}

export function buildPlatformActivityService(repository: PlatformActivityRepository) {
  async function listRecent(limit = 30) {
    return repository.listRecent(Math.max(1, Math.min(limit, 100)));
  }

  return {
    listRecent,
    repository,
  };
}

export type PlatformActivityService = ReturnType<typeof buildPlatformActivityService>;

function mapActivityRow(row: ActivityRow): PlatformActivityItem {
  const createdAt = toIsoString(row.created_at);

  return {
    id: row.id,
    type: row.type,
    displayName: maskDisplayName(row.display_name ?? "Pulse Trader"),
    amount: numberFromDb(row.amount),
    asset: row.asset,
    marketTitle: row.market_title,
    createdAt,
    relativeTime: formatRelativeTime(createdAt),
  };
}

export function maskDisplayName(value: string) {
  const trimmed = value.trim() || "Pulse Trader";
  const [firstWord = trimmed] = trimmed.split(/\s+/);

  if (firstWord.length <= 2) {
    return `${firstWord[0] ?? "P"}***`;
  }

  return `${firstWord.slice(0, 2)}***`;
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "just now";
  }

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) {
    return "just now";
  }

  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  return `${Math.floor(deltaHours / 24)}d ago`;
}
