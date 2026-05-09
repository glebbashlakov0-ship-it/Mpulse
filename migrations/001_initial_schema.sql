create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  email_verified boolean not null default false,
  display_name text not null,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'ar')),
  currency text not null default 'USDT' check (currency in ('USDT')),
  country text,
  email_notifications boolean not null default true,
  market_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  title_ar text,
  description text,
  image text,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists markets (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'polymarket',
  external_id text not null,
  slug text,
  title text not null,
  title_ar text,
  description text,
  category_id text,
  category_label text,
  image text,
  icon text,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default false,
  closed boolean not null default false,
  archived boolean not null default false,
  restricted boolean not null default false,
  status text not null default 'live' check (status in ('upcoming', 'live', 'expired', 'closed')),
  volume numeric(30, 10) not null default 0,
  liquidity numeric(30, 10) not null default 0,
  trading jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table if not exists market_outcomes (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id) on delete cascade,
  outcome_index integer not null,
  name text not null,
  price numeric(20, 10),
  probability numeric(20, 10),
  price_cents integer,
  clob_token_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_id, outcome_index)
);

create table if not exists market_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_id text not null unique,
  market_id uuid not null references markets(id) on delete cascade,
  market_external_id text not null,
  captured_at timestamptz not null,
  prices jsonb not null,
  volume numeric(30, 10) not null default 0,
  liquidity numeric(30, 10) not null default 0,
  source text not null default 'polymarket',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  asset text not null default 'USDT',
  network text,
  balance numeric(30, 10) not null default 0,
  initial_balance numeric(30, 10) not null default 0,
  status text not null default 'active' check (status in ('active', 'frozen', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  market_id uuid references markets(id) on delete set null,
  market_external_id text not null,
  market_title text not null,
  side text not null check (side in ('yes', 'no')),
  shares numeric(30, 10) not null default 0,
  total_cost numeric(30, 10) not null default 0,
  average_price numeric(20, 10),
  last_price numeric(20, 10),
  created_at timestamptz not null default now(),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wallet_id uuid references wallets(id) on delete set null,
  market_id uuid references markets(id) on delete set null,
  market_external_id text not null,
  side text not null check (side in ('yes', 'no')),
  trade_type text not null check (trade_type in ('buy', 'sell')),
  amount numeric(30, 10) not null,
  price numeric(20, 10) not null,
  shares numeric(30, 10) not null,
  status text not null default 'pending' check (status in ('pending', 'filled', 'rejected', 'cancelled')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wallet_id uuid references wallets(id) on delete set null,
  entry_type text not null,
  asset text not null default 'USDT',
  amount numeric(30, 10) not null,
  balance_after numeric(30, 10),
  reference_type text,
  reference_id uuid,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid references users(id) on delete set null,
  session_id uuid references user_sessions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  market_id uuid references markets(id) on delete cascade,
  parent_comment_id uuid references comments(id) on delete cascade,
  body text not null,
  status text not null default 'visible' check (status in ('visible', 'hidden', 'deleted', 'pending_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists market_visibility_rules (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'polymarket',
  market_external_id text,
  category_id text,
  rule_type text not null check (rule_type in ('allow', 'block', 'review')),
  reason text not null,
  region text,
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_email_idx on users (email);
create index if not exists user_sessions_user_id_idx on user_sessions (user_id);
create index if not exists user_sessions_token_hash_idx on user_sessions (token_hash);
create index if not exists user_sessions_expires_at_idx on user_sessions (expires_at);
create index if not exists markets_category_id_idx on markets (category_id);
create index if not exists markets_status_idx on markets (status);
create index if not exists markets_source_external_id_idx on markets (source, external_id);
create index if not exists market_outcomes_market_id_idx on market_outcomes (market_id);
create index if not exists market_snapshots_market_id_captured_at_idx on market_snapshots (market_id, captured_at desc);
create index if not exists market_snapshots_market_external_id_idx on market_snapshots (market_external_id);
create index if not exists wallets_user_id_idx on wallets (user_id);
create index if not exists positions_user_id_idx on positions (user_id);
create index if not exists positions_market_id_idx on positions (market_id);
create index if not exists positions_market_external_id_idx on positions (market_external_id);
create index if not exists trades_user_id_idx on trades (user_id);
create index if not exists trades_market_id_idx on trades (market_id);
create index if not exists trades_market_external_id_idx on trades (market_external_id);
create unique index if not exists trades_user_idempotency_key_idx on trades (user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists ledger_entries_user_id_idx on ledger_entries (user_id);
create index if not exists ledger_entries_wallet_id_idx on ledger_entries (wallet_id);
create index if not exists audit_logs_user_id_idx on audit_logs (user_id);
create index if not exists audit_logs_event_type_idx on audit_logs (event_type);
create index if not exists comments_user_id_idx on comments (user_id);
create index if not exists comments_market_id_idx on comments (market_id);
create index if not exists market_visibility_rules_market_external_id_idx
  on market_visibility_rules (market_external_id);
create index if not exists market_visibility_rules_category_id_idx
  on market_visibility_rules (category_id);
