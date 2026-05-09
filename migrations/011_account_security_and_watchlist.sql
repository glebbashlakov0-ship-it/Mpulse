-- Account security and authenticated-user product state.

alter table user_sessions
  add column if not exists ip_address text,
  add column if not exists user_agent text;

create table if not exists user_watchlist (
  user_id uuid not null references users(id) on delete cascade,
  market_external_id text not null,
  market_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, market_external_id)
);

create index if not exists user_watchlist_user_id_idx on user_watchlist(user_id);

create unique index if not exists positions_user_market_side_idx
  on positions (user_id, market_external_id, side);
