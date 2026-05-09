alter table wallets
  drop constraint if exists wallets_provider_check;

update wallets
set provider = 'internal_wallet',
    updated_at = now()
where provider is null or provider <> 'internal_wallet';

alter table wallets
  alter column provider set default 'internal_wallet',
  add constraint wallets_provider_check check (provider in ('internal_wallet'));

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'wallet_withdrawal_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%provider%'
  loop
    execute format(
      'alter table wallet_withdrawal_requests drop constraint if exists %I',
      constraint_record.conname
    );
  end loop;
end $$;

update wallet_withdrawal_requests
set provider = 'internal_wallet',
    updated_at = now()
where provider is null or provider <> 'internal_wallet';

alter table wallet_withdrawal_requests
  alter column provider set default 'internal_wallet',
  add constraint wallet_withdrawal_requests_provider_check check (provider in ('internal_wallet'));

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'wallet_provider_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%provider%'
  loop
    execute format(
      'alter table wallet_provider_events drop constraint if exists %I',
      constraint_record.conname
    );
  end loop;
end $$;

update wallet_provider_events
set provider = 'internal_wallet',
    updated_at = now()
where provider is null or provider <> 'internal_wallet';

alter table wallet_provider_events
  alter column provider set default 'internal_wallet',
  add constraint wallet_provider_events_provider_check check (provider in ('internal_wallet'));

update wallet_deposit_events
set provider = 'internal_wallet',
    updated_at = now()
where provider is null or provider <> 'internal_wallet';

alter table wallet_deposit_events
  alter column provider set default 'internal_wallet';

update user_compliance_profiles
set verification_provider = 'self_declared',
    updated_at = now()
where verification_provider is null or verification_provider <> 'self_declared';

alter table user_compliance_profiles
  alter column verification_provider set default 'self_declared';
