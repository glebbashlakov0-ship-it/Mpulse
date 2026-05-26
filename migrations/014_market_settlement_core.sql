create table if not exists market_settlements (
  id uuid primary key default gen_random_uuid(),
  market_external_id text not null,
  status text not null check (status in ('resolved', 'cancelled', 'no_winner')),
  winning_side text check (winning_side in ('yes', 'no')),
  total_pool numeric(30, 10) not null default 0,
  winning_pool numeric(30, 10) not null default 0,
  platform_fee numeric(30, 10) not null default 0,
  distributable_pool numeric(30, 10) not null default 0,
  payout_count integer not null default 0,
  created_by uuid references users(id) on delete set null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_external_id)
);

create table if not exists market_settlement_payouts (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references market_settlements(id) on delete cascade,
  market_external_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  side text not null check (side in ('yes', 'no')),
  original_stake numeric(30, 10) not null default 0,
  payout numeric(30, 10) not null default 0,
  profit numeric(30, 10) not null default 0,
  kind text not null check (kind in ('payout', 'refund', 'loss')),
  ledger_entry_id uuid references ledger_entries(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists market_settlements_market_external_id_idx
  on market_settlements (market_external_id);

create index if not exists market_settlement_payouts_user_id_created_idx
  on market_settlement_payouts (user_id, created_at desc);

create index if not exists market_settlement_payouts_market_external_id_idx
  on market_settlement_payouts (market_external_id);
