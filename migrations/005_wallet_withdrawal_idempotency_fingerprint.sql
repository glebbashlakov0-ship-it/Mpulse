alter table wallet_withdrawal_requests
  add column if not exists request_fingerprint text;

update wallet_withdrawal_requests
set request_fingerprint = encode(
  digest(
    jsonb_build_object(
      'asset', asset,
      'network', network,
      'destinationAddress', destination_address,
      'amount', amount::text
    )::text,
    'sha256'
  ),
  'hex'
)
where request_fingerprint is null;

alter table wallet_withdrawal_requests
  alter column request_fingerprint set not null;
