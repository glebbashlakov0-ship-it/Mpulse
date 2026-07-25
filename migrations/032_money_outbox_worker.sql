alter table money_outbox_events
  drop constraint if exists money_outbox_events_status_check;

alter table money_outbox_events
  add constraint money_outbox_events_status_check
    check (status in ('pending', 'processing', 'sent', 'failed', 'dead_letter')),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists lock_token uuid,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists money_outbox_events_ready_idx
  on money_outbox_events (available_at, created_at, id)
  where status in ('pending', 'failed');

create index if not exists money_outbox_events_processing_lease_idx
  on money_outbox_events (locked_at, id)
  where status = 'processing';

create index if not exists money_outbox_events_dead_letter_idx
  on money_outbox_events (dead_lettered_at desc, id)
  where status = 'dead_letter';
