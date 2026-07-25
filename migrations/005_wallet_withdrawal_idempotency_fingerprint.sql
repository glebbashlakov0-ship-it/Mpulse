alter table wallet_withdrawal_requests
  add column if not exists request_fingerprint text;

do $wallet_withdrawal_fingerprint$
declare
  pgcrypto_schema text;
begin
  select namespaces.nspname
  into pgcrypto_schema
  from pg_extension extensions
  join pg_namespace namespaces
    on namespaces.oid = extensions.extnamespace
  where extensions.extname = 'pgcrypto';

  if pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required for withdrawal fingerprints';
  end if;

  -- Supabase installs pgcrypto in the protected `extensions` schema, while
  -- vanilla PostgreSQL installs it in the active schema. Qualify the trusted
  -- extension discovered from pg_catalog because migrations intentionally run
  -- with an exact `public` search_path.
  execute format(
    $backfill$
      update wallet_withdrawal_requests
      set request_fingerprint = encode(
        %I.digest(
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
      where request_fingerprint is null
    $backfill$,
    pgcrypto_schema
  );
end
$wallet_withdrawal_fingerprint$;

alter table wallet_withdrawal_requests
  alter column request_fingerprint set not null;
