create table if not exists market_price_history_points (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('market', 'event')),
  scope_id text not null,
  market_external_id text,
  captured_at timestamptz not null,
  outcomes jsonb not null default '[]'::jsonb,
  yes numeric(20, 10),
  no numeric(20, 10),
  volume numeric(30, 10) not null default 0,
  liquidity numeric(30, 10) not null default 0,
  source text not null check (source in ('pulse_seed', 'admin', 'trade')),
  created_by uuid references users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists market_price_history_scope_captured_idx
  on market_price_history_points (scope_type, scope_id, captured_at desc);

create index if not exists market_price_history_market_external_idx
  on market_price_history_points (market_external_id, captured_at desc);

create index if not exists market_price_history_source_idx
  on market_price_history_points (source, created_at desc);
