-- A completed production cutover permanently seals its per-user snapshot.
-- The explicit parent-row lock closes the race between completion and an
-- insert whose foreign-key check would otherwise happen after its BEFORE
-- trigger.

create or replace function prevent_completed_coin_cutover_snapshot_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  cutover_completed boolean;
begin
  execute format(
    'select true from %I.coin_cutover_snapshots
     where release_marker = $1
     for key share',
    tg_table_schema
  )
  into cutover_completed
  using new.release_marker;

  execute format(
    'select exists (
       select 1
       from %I.coin_production_cutover_completions
       where release_marker = $1
     )',
    tg_table_schema
  )
  into cutover_completed
  using new.release_marker;

  if cutover_completed then
    raise exception 'Completed Coin cutover snapshot is immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists coin_cutover_balance_snapshots_sealed
  on coin_cutover_balance_snapshots;
create trigger coin_cutover_balance_snapshots_sealed
before insert on coin_cutover_balance_snapshots
for each row
execute function prevent_completed_coin_cutover_snapshot_insert();
