alter table trades
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists trades_admin_seed_public_activity_idx
  on trades ((metadata ->> 'source'), (metadata ->> 'publicActivity'))
  where status = 'filled';
