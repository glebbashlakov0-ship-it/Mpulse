-- Immutable evidence for the explicitly authorized one-time production Coin
-- cutover. Legacy money history remains in place and fenced; these tables add
-- the exact computed pre-cutover balance snapshot and successful release proof.

create table if not exists coin_cutover_snapshots (
  release_marker text primary key check (length(btrim(release_marker)) > 0),
  migration_version text not null check (length(btrim(migration_version)) > 0),
  database_target jsonb not null,
  balance_snapshot_sha256 text not null
    check (balance_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  legacy_account_count integer not null check (legacy_account_count >= 0),
  legacy_available_coin_micros bigint not null,
  legacy_reserved_coin_micros bigint not null,
  pending_deposit_count bigint not null check (pending_deposit_count >= 0),
  pending_withdrawal_count bigint not null check (pending_withdrawal_count >= 0),
  inspection_report jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists coin_cutover_balance_snapshots (
  release_marker text not null
    references coin_cutover_snapshots(release_marker) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  legacy_available_amount numeric(30, 10) not null,
  legacy_reserved_amount numeric(30, 10) not null,
  available_coin_micros bigint not null,
  reserved_coin_micros bigint not null,
  pending_deposit_amount numeric(30, 10) not null,
  pending_withdrawal_amount numeric(30, 10) not null,
  pending_deposit_count bigint not null check (pending_deposit_count >= 0),
  pending_withdrawal_count bigint not null check (pending_withdrawal_count >= 0),
  primary key (release_marker, user_id)
);

create table if not exists coin_production_cutover_completions (
  release_marker text primary key
    references coin_cutover_snapshots(release_marker) on delete restrict,
  migration_version text not null check (length(btrim(migration_version)) > 0),
  database_target jsonb not null,
  reconciliation_run_id uuid not null
    references money_reconciliation_runs(id) on delete restrict,
  reconciliation_report jsonb not null,
  completed_at timestamptz not null default now()
);

drop trigger if exists coin_cutover_snapshots_immutable on coin_cutover_snapshots;
create trigger coin_cutover_snapshots_immutable
before update or delete on coin_cutover_snapshots
for each row execute function prevent_money_history_mutation();

drop trigger if exists coin_cutover_balance_snapshots_immutable
  on coin_cutover_balance_snapshots;
create trigger coin_cutover_balance_snapshots_immutable
before update or delete on coin_cutover_balance_snapshots
for each row execute function prevent_money_history_mutation();

drop trigger if exists coin_production_cutover_completions_immutable
  on coin_production_cutover_completions;
create trigger coin_production_cutover_completions_immutable
before update or delete on coin_production_cutover_completions
for each row execute function prevent_money_history_mutation();
