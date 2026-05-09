do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wallet_deposit_events_amount_positive_check'
  ) then
    alter table wallet_deposit_events
      add constraint wallet_deposit_events_amount_positive_check check (amount > 0);
  end if;
end $$;
