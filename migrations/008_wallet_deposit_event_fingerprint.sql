alter table wallet_deposit_events
  add column if not exists event_fingerprint text;

update wallet_deposit_events
set event_fingerprint = md5(
  concat_ws(
    ':',
    tx_hash,
    log_index,
    coalesce(recipient_address, ''),
    amount::text,
    asset,
    network,
    provider,
    coalesce(raw_payload::text, '{}')
  )
)
where event_fingerprint is null;

alter table wallet_deposit_events
  alter column event_fingerprint set not null;

alter table wallet_deposit_events
  drop constraint if exists wallet_deposit_events_status_check,
  add constraint wallet_deposit_events_status_check check (
    status in ('detected', 'confirmed', 'credited', 'rejected', 'manual_review')
  );
