alter table ledger_entries
  add column if not exists reason text not null default 'legacy_migration';

alter table ledger_entries
  alter column reference_id type text using reference_id::text;

update ledger_entries
set idempotency_key = 'legacy:' || id::text
where idempotency_key is null;

alter table ledger_entries
  alter column idempotency_key set not null;

alter table ledger_entries
  drop constraint if exists ledger_entries_entry_type_check;

alter table ledger_entries
  add constraint ledger_entries_entry_type_check
    check (entry_type in (
      'credit',
      'debit',
      'hold',
      'release',
      'trade_debit',
      'trade_credit',
      'adjustment'
    )) not valid;

alter table ledger_entries
  validate constraint ledger_entries_entry_type_check;

alter table ledger_entries
  drop constraint if exists ledger_entries_amount_positive_check;

alter table ledger_entries
  add constraint ledger_entries_amount_positive_check
    check (amount > 0) not valid;

alter table ledger_entries
  validate constraint ledger_entries_amount_positive_check;

alter table ledger_entries
  drop constraint if exists ledger_entries_idempotency_key_key;

create unique index if not exists ledger_entries_user_idempotency_key_idx
  on ledger_entries (user_id, idempotency_key);

create index if not exists ledger_entries_user_asset_created_at_idx
  on ledger_entries (user_id, asset, created_at desc);

create index if not exists ledger_entries_entry_type_idx
  on ledger_entries (entry_type);
