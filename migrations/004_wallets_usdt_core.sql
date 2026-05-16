alter table wallets
  add column if not exists address text,
  add column if not exists provider text not null default 'internal_wallet';

update wallets
set
  network = coalesce(network, 'TRON'),
  provider = case
    when provider is null or provider <> 'internal_wallet' then 'internal_wallet'
    else provider
  end,
  status = case when status in ('pending', 'active', 'disabled') then status else 'active' end,
  updated_at = now()
where asset = 'USDT';

alter table wallets
  alter column network set default 'TRON',
  alter column provider set default 'internal_wallet',
  alter column status set default 'pending';

alter table wallets
  drop constraint if exists wallets_status_check,
  drop constraint if exists wallets_asset_check,
  drop constraint if exists wallets_network_check,
  drop constraint if exists wallets_provider_check,
  drop constraint if exists wallets_tron_address_shape_check,
  add constraint wallets_asset_check check (asset in ('USDT')),
  add constraint wallets_network_check check (network in ('TRON')),
  add constraint wallets_provider_check check (provider in ('internal_wallet')),
  add constraint wallets_status_check check (status in ('pending', 'active', 'disabled')),
  add constraint wallets_tron_address_shape_check check (
    address is null or address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
  );

create unique index if not exists wallets_user_asset_network_provider_idx
  on wallets (user_id, asset, network, provider);

create table if not exists wallet_deposit_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wallet_id uuid not null references wallets(id) on delete cascade,
  asset text not null default 'USDT' check (asset in ('USDT')),
  network text not null default 'TRON' check (network in ('TRON')),
  address text not null check (address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  expected_amount numeric(30, 10) not null check (expected_amount > 0),
  status text not null default 'waiting' check (
    status in ('waiting', 'detected', 'credited', 'expired', 'rejected')
  ),
  memo text,
  reference text,
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wallet_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  asset text not null default 'USDT' check (asset in ('USDT')),
  network text not null default 'TRON' check (network in ('TRON')),
  destination_address text not null check (destination_address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  amount numeric(30, 10) not null check (amount > 0),
  status text not null default 'pending_review' check (
    status in (
      'draft',
      'pending_review',
      'approved',
      'rejected',
      'cancelled',
      'broadcast_pending',
      'broadcasted',
      'failed'
    )
  ),
  provider text not null default 'internal_wallet' check (provider in ('internal_wallet')),
  idempotency_key text not null,
  real_transfer_blocked boolean not null default true,
  block_reason text not null default 'TRANSFERS_UNAVAILABLE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists wallet_provider_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  provider text not null default 'internal_wallet' check (provider in ('internal_wallet')),
  event_type text not null check (event_type like 'deposit.%'),
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wallet_deposit_intents_user_id_idx
  on wallet_deposit_intents (user_id);

create index if not exists wallet_deposit_intents_wallet_id_idx
  on wallet_deposit_intents (wallet_id);

create index if not exists wallet_deposit_intents_status_expires_idx
  on wallet_deposit_intents (status, expires_at);

create index if not exists wallet_withdrawal_requests_user_id_created_idx
  on wallet_withdrawal_requests (user_id, created_at desc);

create index if not exists wallet_withdrawal_requests_status_idx
  on wallet_withdrawal_requests (status);

create index if not exists wallet_provider_events_event_type_idx
  on wallet_provider_events (event_type);
