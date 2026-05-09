create table if not exists wallet_deposit_events (
  id uuid primary key,
  tx_hash text not null,
  log_index text not null,
  wallet_id uuid references wallets(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  amount numeric(24, 8) not null,
  asset text not null,
  network text not null,
  confirmations integer not null default 0,
  status text not null default 'detected',
  provider text not null default 'internal_wallet',
  recipient_address text,
  event_fingerprint text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  rejection_reason text,
  credited_ledger_entry_id uuid references ledger_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_deposit_events_asset_check check (asset in ('USDT')),
  constraint wallet_deposit_events_network_check check (network in ('TRON')),
  constraint wallet_deposit_events_confirmations_check check (confirmations >= 0),
  constraint wallet_deposit_events_status_check check (
    status in ('detected', 'confirmed', 'credited', 'rejected', 'manual_review')
  ),
  constraint wallet_deposit_events_tx_log_unique unique (tx_hash, log_index)
);

create index if not exists wallet_deposit_events_user_created_idx
  on wallet_deposit_events (user_id, created_at desc);

create index if not exists wallet_deposit_events_wallet_created_idx
  on wallet_deposit_events (wallet_id, created_at desc);

create index if not exists wallet_deposit_events_status_idx
  on wallet_deposit_events (status);
