-- Coins cutover schema. This migration is structural and deliberately does not
-- migrate production balances automatically. Use scripts/coinsMigration.ts in
-- dry-run mode first, then explicitly apply after approval.

create table if not exists money_system_state (
  singleton boolean primary key default true check (singleton),
  active_system text not null default 'legacy'
    check (active_system in ('legacy', 'migrating', 'coin')),
  legacy_writes_enabled boolean not null default true,
  migration_version text,
  cutover_completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (active_system = 'legacy' and legacy_writes_enabled = true)
    or (active_system in ('migrating', 'coin') and legacy_writes_enabled = false)
  )
);

insert into money_system_state (singleton, active_system, legacy_writes_enabled)
values (true, 'legacy', true)
on conflict (singleton) do nothing;

alter table user_settings
  drop constraint if exists user_settings_currency_check;
update user_settings
set currency = 'COIN', updated_at = now()
where currency <> 'COIN';
alter table user_settings
  alter column currency set default 'COIN',
  add constraint user_settings_currency_check check (currency = 'COIN');

alter table wallets
  drop constraint if exists wallets_provider_check,
  add constraint wallets_provider_check
    check (provider in ('internal_wallet', 'fireblocks'));

alter table wallet_withdrawal_requests
  drop constraint if exists wallet_withdrawal_requests_provider_check,
  add constraint wallet_withdrawal_requests_provider_check
    check (provider in ('internal_wallet', 'fireblocks'));

create unique index if not exists wallets_fireblocks_destination_ownership_uidx
  on wallets (provider, asset, network, address)
  where provider = 'fireblocks' and address is not null;

create table if not exists exchange_rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  base_asset text not null check (base_asset = 'USDT'),
  network text not null check (network = 'TRON'),
  quote_currency text not null check (quote_currency = 'USD'),
  rate_nanos bigint not null check (rate_nanos > 0),
  source text not null check (length(btrim(source)) > 0),
  kind text not null check (kind in ('indicative', 'final')),
  purpose text not null check (
    purpose in ('deposit_final', 'withdrawal_indicative', 'withdrawal_final')
  ),
  quoted_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > quoted_at),
  provider_reference text,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists coin_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete restrict,
  available_coin_micros bigint not null default 0 check (available_coin_micros >= 0),
  reserved_coin_micros bigint not null default 0 check (reserved_coin_micros >= 0),
  migration_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (id, user_id)
);

create table if not exists coin_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_sequence bigint generated always as identity,
  account_id uuid not null references coin_accounts(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  operation_type text not null check (operation_type in (
    'crypto_deposit_credit',
    'withdrawal_reserve',
    'withdrawal_debit',
    'withdrawal_release',
    'trade_reserve',
    'trade_debit',
    'trade_release',
    'trade_settlement_credit',
    'fee_debit',
    'refund_credit',
    'bonus_credit',
    'admin_credit',
    'admin_debit',
    'migration_credit',
    'correction_credit',
    'correction_debit',
    'reversed_deposit'
  )),
  available_delta_coin_micros bigint not null,
  reserved_delta_coin_micros bigint not null default 0,
  available_after_coin_micros bigint not null check (available_after_coin_micros >= 0),
  reserved_after_coin_micros bigint not null check (reserved_after_coin_micros >= 0),
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  source_type text not null check (length(btrim(source_type)) > 0),
  source_id text not null check (length(btrim(source_id)) > 0),
  external_reference text,
  rate_snapshot_id uuid references exchange_rate_snapshots(id) on delete restrict,
  reason text not null check (length(btrim(reason)) > 0),
  admin_user_id uuid references users(id) on delete restrict,
  admin_actor text,
  audit_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (available_delta_coin_micros <> 0 or reserved_delta_coin_micros <> 0),
  check (
    operation_type not in ('admin_credit', 'admin_debit', 'correction_credit', 'correction_debit')
    or admin_user_id is not null
    or coalesce(length(btrim(admin_actor)), 0) > 0
  ),
  check (
    (operation_type not in ('crypto_deposit_credit', 'refund_credit', 'bonus_credit',
      'admin_credit', 'correction_credit', 'trade_settlement_credit')
      or (available_delta_coin_micros > 0 and reserved_delta_coin_micros = 0))
    and
    (operation_type not in ('withdrawal_reserve', 'trade_reserve')
      or (available_delta_coin_micros < 0
        and reserved_delta_coin_micros = -available_delta_coin_micros))
    and
    (operation_type not in ('withdrawal_release', 'trade_release')
      or (available_delta_coin_micros > 0
        and reserved_delta_coin_micros = -available_delta_coin_micros))
    and
    (operation_type not in ('withdrawal_debit', 'trade_debit')
      or (available_delta_coin_micros = 0 and reserved_delta_coin_micros < 0))
    and
    (operation_type <> 'reversed_deposit'
      or (available_delta_coin_micros < 0 and reserved_delta_coin_micros = 0))
    and
    (operation_type not in ('admin_debit', 'correction_debit')
      or (available_delta_coin_micros < 0 and reserved_delta_coin_micros = 0))
    and
    (operation_type <> 'fee_debit'
      or (available_delta_coin_micros + reserved_delta_coin_micros < 0))
    and
    (operation_type <> 'migration_credit'
      or (available_delta_coin_micros >= 0 and reserved_delta_coin_micros >= 0))
  ),
  unique (account_id, idempotency_key),
  foreign key (account_id, user_id)
    references coin_accounts(id, user_id) on delete restrict
);

alter table coin_ledger_entries
  add column if not exists entry_sequence bigint generated always as identity;

create unique index if not exists coin_ledger_entries_sequence_idx
  on coin_ledger_entries (entry_sequence);
create index if not exists coin_ledger_entries_user_created_idx
  on coin_ledger_entries (user_id, created_at desc);
create index if not exists coin_ledger_entries_user_sequence_idx
  on coin_ledger_entries (user_id, entry_sequence desc);
create index if not exists coin_ledger_entries_source_idx
  on coin_ledger_entries (source_type, source_id);

create table if not exists money_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (length(btrim(provider)) > 0),
  provider_event_id text not null check (length(btrim(provider_event_id)) > 0),
  event_type text not null check (length(btrim(event_type)) > 0),
  provider_transaction_id text,
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists money_provider_events_transaction_idx
  on money_provider_events (provider, provider_transaction_id)
  where provider_transaction_id is not null;

create table if not exists crypto_deposits (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  provider_transaction_id text,
  fireblocks_transaction_id text,
  blockchain_tx_hash text not null,
  event_index text not null,
  network text not null check (network = 'TRON'),
  token_contract text not null,
  destination_address text not null,
  deposit_intent_id uuid references wallet_deposit_intents(id) on delete restrict,
  user_id uuid references users(id) on delete restrict,
  gross_usdt_atomic bigint not null check (gross_usdt_atomic >= 0),
  network_fee_usdt_atomic bigint not null default 0 check (network_fee_usdt_atomic >= 0),
  provider_fee_usdt_atomic bigint not null default 0 check (provider_fee_usdt_atomic >= 0),
  net_usdt_atomic bigint not null check (net_usdt_atomic >= 0),
  rate_snapshot_id uuid references exchange_rate_snapshots(id) on delete restrict,
  usd_value_micros bigint check (usd_value_micros >= 0),
  credited_coin_micros bigint check (credited_coin_micros >= 0),
  ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict,
  reversal_ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict,
  last_provider_event_id uuid references money_provider_events(id) on delete restrict,
  required_confirmations integer not null check (required_confirmations > 0),
  actual_confirmations integer not null default 0 check (actual_confirmations >= 0),
  status text not null check (status in (
    'detected', 'confirming', 'confirmed_unpriced', 'pending_rate', 'manual_review',
    'credited', 'rejected', 'reversal_pending', 'reversing', 'reversed'
  )),
  manual_review_reason text,
  reviewed_by uuid references users(id) on delete restrict,
  reviewed_at timestamptz,
  idempotency_key text not null unique,
  detected_at timestamptz not null,
  confirmed_at timestamptz,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (network, blockchain_tx_hash, token_contract, event_index, destination_address),
  check (
    status <> 'credited'
    or (rate_snapshot_id is not null and credited_coin_micros is not null and ledger_entry_id is not null)
  ),
  check (
    status <> 'reversed'
    or reversal_ledger_entry_id is not null
  )
);

create unique index if not exists crypto_deposits_provider_transaction_uidx
  on crypto_deposits (provider, provider_transaction_id)
  where provider_transaction_id is not null;

create table if not exists withdrawal_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete restrict,
  asset text not null check (asset = 'USDT'),
  network text not null check (network = 'TRON'),
  destination_address text not null,
  coin_to_debit_micros bigint not null check (coin_to_debit_micros > 0),
  estimated_usdt_atomic bigint not null check (estimated_usdt_atomic > 0),
  network_fee_usdt_atomic bigint not null default 0 check (network_fee_usdt_atomic >= 0),
  provider_fee_usdt_atomic bigint not null default 0 check (provider_fee_usdt_atomic >= 0),
  rate_snapshot_id uuid not null references exchange_rate_snapshots(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'consumed', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  idempotency_key text not null,
  request_fingerprint text not null check (length(btrim(request_fingerprint)) > 0),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table wallet_withdrawal_requests
  alter column block_reason drop not null,
  add column if not exists withdrawal_quote_id uuid references withdrawal_quotes(id) on delete restrict,
  add column if not exists coin_reserved_micros bigint check (coin_reserved_micros >= 0),
  add column if not exists coin_debited_micros bigint check (coin_debited_micros >= 0),
  add column if not exists estimated_usdt_atomic bigint check (estimated_usdt_atomic >= 0),
  add column if not exists final_usdt_atomic bigint check (final_usdt_atomic >= 0),
  add column if not exists network_fee_usdt_atomic bigint check (network_fee_usdt_atomic >= 0),
  add column if not exists provider_fee_usdt_atomic bigint check (provider_fee_usdt_atomic >= 0),
  add column if not exists final_rate_snapshot_id uuid references exchange_rate_snapshots(id) on delete restrict,
  add column if not exists fireblocks_reference text,
  add column if not exists failure_state text,
  add column if not exists review_reason text,
  add column if not exists reviewed_by_actor text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reserve_ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict,
  add column if not exists final_ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict,
  add column if not exists release_ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict;

create table if not exists trade_execution_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete restrict,
  market_external_id text not null check (length(btrim(market_external_id)) > 0),
  market_title text not null check (length(btrim(market_title)) > 0),
  side text not null check (side in ('yes', 'no')),
  action text not null check (action in ('buy', 'sell')),
  clob_token_id text,
  status text not null check (status in (
    'reserved', 'execution_pending', 'partially_filled', 'filled',
    'cancelled', 'failed', 'manual_review'
  )),
  requested_coin_micros bigint not null default 0 check (requested_coin_micros >= 0),
  requested_shares numeric(30, 10) not null default 0 check (
    requested_shares >= 0
    and requested_shares * 1000000 = trunc(requested_shares * 1000000)
    and requested_shares * 1000000 <= 9223372036854775807
  ),
  quote_price_nanos bigint not null check (quote_price_nanos > 0),
  reserved_coin_micros bigint not null default 0 check (reserved_coin_micros >= 0),
  filled_coin_micros bigint not null default 0 check (filled_coin_micros >= 0),
  fee_coin_micros bigint not null default 0 check (fee_coin_micros >= 0),
  released_coin_micros bigint not null default 0 check (released_coin_micros >= 0),
  executed_shares numeric(30, 10) not null default 0 check (
    executed_shares >= 0
    and executed_shares * 1000000 = trunc(executed_shares * 1000000)
    and executed_shares * 1000000 <= 9223372036854775807
  ),
  executed_price_nanos bigint check (executed_price_nanos > 0),
  provider text not null default 'polymarket',
  provider_order_id text,
  provider_trade_id text,
  reserve_ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict,
  debit_ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict,
  fee_ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict,
  release_ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict,
  credit_ledger_entry_id uuid unique references coin_ledger_entries(id) on delete restrict,
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  request_fingerprint text not null check (length(btrim(request_fingerprint)) > 0),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (
    (action = 'buy' and requested_coin_micros > 0)
    or (action = 'sell' and requested_shares > 0)
  ),
  check (
    action <> 'buy'
    or filled_coin_micros + fee_coin_micros + released_coin_micros
      <= reserved_coin_micros
  ),
  check (
    action <> 'buy'
    or status not in ('filled', 'cancelled', 'failed')
    or filled_coin_micros + fee_coin_micros + released_coin_micros
      = reserved_coin_micros
  )
);

create unique index if not exists trade_execution_orders_provider_order_uidx
  on trade_execution_orders (provider, provider_order_id)
  where provider_order_id is not null;
create index if not exists trade_execution_orders_user_created_idx
  on trade_execution_orders (user_id, created_at desc);
create index if not exists trade_execution_orders_status_updated_idx
  on trade_execution_orders (status, updated_at);
create unique index if not exists trade_execution_orders_active_sell_execution_uidx
  on trade_execution_orders (user_id, market_external_id, side)
  where action = 'sell'
    and status in ('execution_pending', 'manual_review');

alter table trades
  add column if not exists execution_order_id uuid unique
    references trade_execution_orders(id) on delete restrict,
  add column if not exists amount_coin_micros bigint not null default 0
    check (amount_coin_micros >= 0),
  add column if not exists fee_coin_micros bigint not null default 0
    check (fee_coin_micros >= 0),
  add column if not exists realized_pnl_coin_micros bigint,
  add column if not exists price_nanos bigint check (price_nanos > 0),
  add column if not exists coin_migration_version text;

alter table positions
  add column if not exists total_cost_coin_micros bigint not null default 0
    check (total_cost_coin_micros >= 0),
  add column if not exists average_price_nanos bigint check (average_price_nanos > 0),
  add column if not exists last_price_nanos bigint check (last_price_nanos > 0),
  add column if not exists coin_migration_version text;

alter table market_settlements
  add column if not exists total_pool_coin_micros bigint not null default 0
    check (total_pool_coin_micros >= 0),
  add column if not exists winning_pool_coin_micros bigint not null default 0
    check (winning_pool_coin_micros >= 0),
  add column if not exists platform_fee_coin_micros bigint not null default 0
    check (platform_fee_coin_micros >= 0),
  add column if not exists distributable_pool_coin_micros bigint not null default 0
    check (distributable_pool_coin_micros >= 0),
  add column if not exists coin_migration_version text;

alter table market_settlement_payouts
  add column if not exists original_stake_coin_micros bigint not null default 0
    check (original_stake_coin_micros >= 0),
  add column if not exists payout_coin_micros bigint not null default 0
    check (payout_coin_micros >= 0),
  add column if not exists profit_coin_micros bigint,
  add column if not exists coin_migration_version text,
  add column if not exists coin_ledger_entry_id uuid unique
    references coin_ledger_entries(id) on delete restrict;

create table if not exists money_outbox_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists coin_migration_markers (
  user_id uuid not null references users(id) on delete restrict,
  migration_version text not null,
  legacy_available_amount numeric(30, 10) not null,
  legacy_reserved_amount numeric(30, 10) not null,
  migrated_available_coin_micros bigint not null,
  migrated_reserved_coin_micros bigint not null,
  ledger_entry_id uuid references coin_ledger_entries(id) on delete restrict,
  migration_metadata jsonb not null default '{}'::jsonb,
  migrated_at timestamptz not null default now(),
  primary key (user_id, migration_version)
);

create table if not exists coin_cutover_runs (
  id uuid primary key default gen_random_uuid(),
  migration_version text not null unique,
  status text not null check (status in ('completed', 'rolled_back', 'failed')),
  legacy_account_count integer not null check (legacy_account_count >= 0),
  legacy_available_coin_micros bigint not null,
  legacy_reserved_coin_micros bigint not null,
  before_available_coin_micros bigint not null,
  before_reserved_coin_micros bigint not null,
  after_available_coin_micros bigint not null,
  after_reserved_coin_micros bigint not null,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists money_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'passed', 'failed')),
  dry_run boolean not null default true,
  discrepancy_count integer not null default 0 check (discrepancy_count >= 0),
  report jsonb not null default '{}'::jsonb,
  initiated_by uuid references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function coin_post_ledger_entry(
  p_user_id uuid,
  p_operation_type text,
  p_available_delta_coin_micros bigint,
  p_reserved_delta_coin_micros bigint,
  p_idempotency_key text,
  p_source_type text,
  p_source_id text,
  p_reason text,
  p_external_reference text default null,
  p_rate_snapshot_id uuid default null,
  p_admin_user_id uuid default null,
  p_admin_actor text default null,
  p_audit_metadata jsonb default '{}'::jsonb
) returns coin_ledger_entries
language plpgsql
as $$
declare
  v_account coin_accounts;
  v_existing coin_ledger_entries;
  v_entry coin_ledger_entries;
  v_active_system text;
begin
  select active_system into v_active_system
  from money_system_state
  where singleton = true;

  if not found
    or v_active_system is null
    or (
      v_active_system <> 'coin'
      and not (
        v_active_system = 'migrating'
        and p_operation_type = 'migration_credit'
      )
    ) then
    raise exception 'COIN_CUTOVER_INCOMPLETE';
  end if;

  insert into coin_accounts (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_account from coin_accounts
  where user_id = p_user_id for update;

  select * into v_existing from coin_ledger_entries
  where account_id = v_account.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.operation_type <> p_operation_type
      or v_existing.available_delta_coin_micros <> p_available_delta_coin_micros
      or v_existing.reserved_delta_coin_micros <> p_reserved_delta_coin_micros
      or v_existing.source_type <> p_source_type
      or v_existing.source_id is distinct from p_source_id
      or v_existing.reason <> p_reason
      or v_existing.external_reference is distinct from p_external_reference
      or v_existing.rate_snapshot_id is distinct from p_rate_snapshot_id
      or v_existing.admin_user_id is distinct from p_admin_user_id
      or v_existing.admin_actor is distinct from p_admin_actor then
      raise exception 'COIN_IDEMPOTENCY_KEY_REUSE_MISMATCH';
    end if;
    return v_existing;
  end if;

  if v_account.available_coin_micros + p_available_delta_coin_micros < 0
    or v_account.reserved_coin_micros + p_reserved_delta_coin_micros < 0 then
    raise exception 'INSUFFICIENT_COIN_BALANCE';
  end if;

  perform set_config('mpulse.coin_posting', '1', true);

  update coin_accounts set
    available_coin_micros = available_coin_micros + p_available_delta_coin_micros,
    reserved_coin_micros = reserved_coin_micros + p_reserved_delta_coin_micros,
    updated_at = now()
  where id = v_account.id
  returning * into v_account;

  perform set_config('mpulse.coin_posting', '0', true);

  insert into coin_ledger_entries (
    account_id, user_id, operation_type, available_delta_coin_micros,
    reserved_delta_coin_micros, available_after_coin_micros,
    reserved_after_coin_micros, idempotency_key, source_type, source_id,
    external_reference, rate_snapshot_id, reason, admin_user_id, admin_actor,
    audit_metadata
  ) values (
    v_account.id, p_user_id, p_operation_type, p_available_delta_coin_micros,
    p_reserved_delta_coin_micros, v_account.available_coin_micros,
    v_account.reserved_coin_micros, p_idempotency_key, p_source_type, p_source_id,
    p_external_reference, p_rate_snapshot_id, p_reason, p_admin_user_id,
    p_admin_actor,
    coalesce(p_audit_metadata, '{}'::jsonb)
  ) returning * into v_entry;
  return v_entry;
end;
$$;

create or replace function guard_coin_account_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'coin_accounts cannot be deleted';
  end if;

  if tg_op = 'INSERT' then
    if new.available_coin_micros <> 0 or new.reserved_coin_micros <> 0 then
      raise exception 'coin_accounts must start at zero; post a Coin ledger entry';
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'coin account ownership is immutable';
  end if;
  if (
    new.available_coin_micros is distinct from old.available_coin_micros
    or new.reserved_coin_micros is distinct from old.reserved_coin_micros
  ) and coalesce(current_setting('mpulse.coin_posting', true), '0') <> '1' then
    raise exception 'coin balances may only change through coin_post_ledger_entry';
  end if;
  return new;
end;
$$;

drop trigger if exists coin_accounts_mutation_guard on coin_accounts;
create trigger coin_accounts_mutation_guard
before insert or update or delete on coin_accounts
for each row execute function guard_coin_account_mutation();

create or replace function prevent_money_history_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is immutable; post a compensating Coin entry when applicable', tg_table_name;
end;
$$;

drop trigger if exists coin_ledger_entries_immutable on coin_ledger_entries;
create trigger coin_ledger_entries_immutable
before update or delete on coin_ledger_entries
for each row execute function prevent_money_history_mutation();

drop trigger if exists exchange_rate_snapshots_immutable on exchange_rate_snapshots;
create trigger exchange_rate_snapshots_immutable
before update or delete on exchange_rate_snapshots
for each row execute function prevent_money_history_mutation();

drop trigger if exists money_provider_events_immutable on money_provider_events;
create trigger money_provider_events_immutable
before update or delete on money_provider_events
for each row execute function prevent_money_history_mutation();

drop trigger if exists coin_migration_markers_immutable on coin_migration_markers;
create trigger coin_migration_markers_immutable
before update or delete on coin_migration_markers
for each row execute function prevent_money_history_mutation();

drop trigger if exists coin_cutover_runs_immutable on coin_cutover_runs;
create trigger coin_cutover_runs_immutable
before update or delete on coin_cutover_runs
for each row execute function prevent_money_history_mutation();

create or replace function enforce_legacy_money_fence()
returns trigger language plpgsql as $$
declare
  v_legacy_writes_enabled boolean;
begin
  select legacy_writes_enabled
    into v_legacy_writes_enabled
  from money_system_state
  where singleton = true;

  if coalesce(v_legacy_writes_enabled, false) = false then
    raise exception 'LEGACY_MONEY_WRITES_FENCED: Coin ledger is authoritative';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists ledger_entries_coin_cutover_fence on ledger_entries;
create trigger ledger_entries_coin_cutover_fence
before insert or update or delete on ledger_entries
for each row execute function enforce_legacy_money_fence();

drop trigger if exists wallets_balance_coin_cutover_fence on wallets;
create trigger wallets_balance_coin_cutover_fence
before update of balance, initial_balance on wallets
for each row execute function enforce_legacy_money_fence();
