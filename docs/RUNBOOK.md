# Coin Ledger Cutover Runbook

## Controlling status

Production money movement is **review-only and not approved**.

- Deposit credit is denied by the controlling rejected launch artifact; review-only withdrawal
  requests and internal Coin trading remain separate fail-closed gates.
- Fireblocks integration verifies signed inbound webhooks and stores review evidence; it cannot
  credit Coins while the deposit feature gate is disabled.
- No public or admin route broadcasts a Fireblocks withdrawal.
- Internal Coin trading never enables a Polymarket CLOB runtime.
- The general Coin rehearsal CLI remains restricted to a dedicated `TEST_DATABASE_URL`.
- One production balance cutover is explicitly gated by the committed 2026-07-25 release marker;
  this runbook does not authorize a deploy or any other migration.

Keep `APP_MODE=local`. See [real-money-launch-approval.md](real-money-launch-approval.md) for the
denial record and [coins-architecture.md](coins-architecture.md) for units and invariants.

For a production runtime without Fireblocks or CLOB, the maximum supported capability set is:

```dotenv
COIN_DEPOSIT_CREDITS_ENABLED=false
COIN_WITHDRAWAL_REQUESTS_ENABLED=true
COIN_INTERNAL_TRADING_ENABLED=true
EXCHANGE_RATE_PROVIDER=coinbase
```

This permits only rate-backed withdrawal quotes, Coin reserve/cancel/reject under manual review,
and internal simulated execution against the Coin ledger. Confirm through
`GET /api/money/supported-assets` that `withdrawalBroadcastEnabled`,
`externalTradingEnabled`, and `outboundFundsProviderCallsEnabled` remain `false`. If withdrawal
operations are not staffed for manual review, leave `COIN_WITHDRAWAL_REQUESTS_ENABLED=false`.

## Local startup

```bash
npm install
cp .env.example .env
npm run dev:api
npm run dev:web
```

The API defaults to `http://localhost:4000`; Vite defaults to `http://localhost:5173`.

With `DATABASE_URL` empty, non-money local development can run without PostgreSQL. Authenticated
Coin balance, wallet, portfolio, trading, and settlement paths must fail closed in that mode.
Migration `031` also leaves `money_system_state` in `legacy`; applying the schema alone does not
enable Coin routes. To exercise those paths, use a disposable test-scoped database and complete the
test-only cutover rehearsal in this runbook before starting the API:

```bash
DATABASE_URL=postgresql:///mpulse_coins_dev_test \
  DATABASE_SSL=false \
  npm run db:migrate

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_dev_test \
  TEST_DATABASE_SSL=false \
  npm run coins:migration:dry-run

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_dev_test \
  TEST_DATABASE_SSL=false \
  COINS_MIGRATION_APPLY=true \
  npm run coins:migration:apply

DATABASE_URL=postgresql:///mpulse_coins_dev_test \
  DATABASE_SSL=false \
  npm run dev:api
```

Do not manually update the cutover fence or add a startup command that hides which database the
server is using. Check the sanitized startup error and `/api/ready` when PostgreSQL is unavailable.

## Migration inventory

The repository uses an explicit sparse migration plan:

- `001` through `016` are the existing application migrations;
- `017` through `030` are not part of this focused cutover change;
- `031_coins_ledger_cutover.sql` is the structural Coin migration.
- `032_money_outbox_worker.sql` adds durable outbox leasing, retries, and dead-letter state.
- `033_production_coin_cutover_evidence.sql` stores immutable release snapshot/completion evidence.

The gap is intentional and is validated against the explicit plan rather than inferred as a
contiguous sequence:

```bash
npm run migration:plan-check
```

Migration `031` creates Coin accounts, immutable ledger entries, exchange-rate snapshots, provider
events, crypto deposits, withdrawal quotes/requests, execution orders, outbox events, migration
markers, cutover runs, reconciliation reports, and global write fences. It does not copy balances.
The schema runner holds `market_pulse:schema_migrations` on one PostgreSQL session while applying
the checked plan, so concurrent production builds serialize safely.

## Authorized production build cutover

The only production trigger is the committed marker
`releases/2026-07-25-coins-v1-production-cutover.json`, invoked by `npm run vercel-build`. Do not
run the test CLI against production and do not set `TEST_DATABASE_URL` in the production build.

The wrapper runs only when all of these are true:

- `VERCEL_ENV=production`;
- `VERCEL_PROJECT_PRODUCTION_URL` resolves to the host recorded in the marker;
- `DATABASE_URL` names one non-local, non-test PostgreSQL database;
- `DATABASE_SSL=true`;
- the connected database name exactly matches the database named by `DATABASE_URL`.

It takes a release-scoped advisory lock, applies schema migrations, runs
`inspectMigration -> applyMigration -> reconciliation`, and stops on pending deposits,
withdrawals, invalid precision/range, negative balances, projection errors, or reconciliation
discrepancies. The apply transaction writes a header manifest, SHA-256 balance digest, and exact
per-user legacy balance rows before moving the fence. Credentials are never stored; target evidence
contains only host/port/database, connected server identity, SSL state, and a credential-free
fingerprint.

After a passing reconciliation it records immutable completion evidence. A repeated build for the
same marker/target checks the snapshot, migration run, and reconciliation but does not add a second
balance credit, snapshot, or completion. A failed production build is an incident: preserve the
reports and database, keep money movement disabled, and use a reviewed forward fix.

## Dedicated test database

Never rehearse against an application or production database. Use a disposable database whose name
is visibly test-scoped:

```bash
createdb mpulse_coins_test

DATABASE_URL=postgresql:///mpulse_coins_test \
  DATABASE_SSL=false \
  npm run db:migrate
```

The integration and cutover commands validate `TEST_DATABASE_URL`. They fail when the URL is
missing or malformed, points to a maintenance database, is not test-scoped, runs in a production
deployment context, or resolves to the same host/port/database as `DATABASE_URL`. Before invoking a
test-only command, leave `DATABASE_URL` unset or point it at a different database.

```bash
DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  NODE_ENV=test \
  npm run test:postgres
```

Drop the disposable database after evidence is saved:

```bash
dropdb mpulse_coins_test
```

## Test-only cutover rehearsal

### 1. Establish a clean baseline

Apply the structural migrations, then inspect the migration plan:

```bash
DATABASE_URL=postgresql:///mpulse_coins_test \
  DATABASE_SSL=false \
  npm run db:migrate

npm run migration:plan-check
```

Seed only non-production fixture data. Do not use live credentials, real provider payloads, or
production exports containing secrets or personal data.

### 2. Dry-run before apply

```bash
DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  npm run coins:migration:dry-run
```

Review:

- legacy available and reserved totals;
- expected Coin-micro totals;
- user count and per-user conversion;
- pending legacy deposit and withdrawal counts;
- unsafe precision, negative balance, overflow, trade, position, or settlement projections;
- current `money_system_state`.

Apply must remain blocked while pending legacy money operations exist. Drain or explicitly resolve
them in the test fixture; do not reinterpret a pending row as completed.

### 3. Apply once

```bash
DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  COINS_MIGRATION_APPLY=true \
  npm run coins:migration:apply
```

The apply command must:

1. run in a serializable transaction;
2. take the cutover advisory lock and lock legacy money/projection tables;
3. snapshot exact balances after the locks;
4. move the global fence from `legacy` to `migrating`;
5. append one migration credit and marker per user;
6. convert supported historical trade/position/settlement projections;
7. compare before, expected, and after totals;
8. record a cutover run;
9. switch the global fence once to `coin`.

Any failed invariant must roll back the transaction, including the fence.

### 4. Prove idempotency

Run the same apply command again:

```bash
DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  COINS_MIGRATION_APPLY=true \
  npm run coins:migration:apply
```

The second run must report `noOp: true`. A second migration credit, changed total, or new marker is a
release blocker.

### 5. Dry-run and reconcile after apply

```bash
DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  npm run coins:migration:dry-run

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  npm run coins:reconcile
```

Reconciliation records a report and audit event but does not repair money. It exits non-zero when
discrepancies exist. Require zero discrepancies in every reported category:

- account cache versus ledger totals;
- entry running balances and non-negative states;
- migration markers, converted users, and cutover totals;
- post-cutover legacy writes;
- deposit amount/rate/credit/reversal/provider evidence;
- withdrawal reserve/release/final-debit state;
- trade reserves, fills, fees, releases, positions, and execution links;
- settlement payout/refund rows and Coin credits;
- failed or stale outbox events.

Store the dry-run, first apply, no-op apply, final dry-run, reconciliation, test, and commit IDs as
review evidence. They are not launch approval.

## Deposit operations

The only supported external asset is configured USDT TRC-20.

1. Provision and persist an owned Fireblocks deposit address outside this application.
2. Create a deposit intent with informational `expectedUsdtAtomic`.
3. Set `REAL_MONEY_DEPOSIT_PROVIDER=fireblocks` only in a controlled test environment.
4. For an actual Fireblocks-signed sandbox/test notification, configure the official JWKS for that
   Fireblocks region (the US production example is
   `https://keys.fireblocks.io/.well-known/jwks.json`). A deterministic locally signed fixture must
   instead inject or serve its matching test JWKS; it is never production evidence.
5. Send the controlled notification with a detached RS512 JWS in
   `Fireblocks-Webhook-Signature` through `POST /api/wallets/webhooks/deposits`.
6. Confirm that the raw-body signature, event ID, payload hash, provider transaction ID, chain
   transaction hash/event index, asset, network, token contract, destination, amounts, fees,
   status, and confirmations are persisted.
7. Replay the exact payload and confirm idempotency.
8. Exercise a conflicting payload and confirm `manual_review` without credit.
9. Exercise confirmation progression and confirm that confirmations cannot decrease.
10. At final confirmation, expect `manual_review` with
   `REAL_MONEY_LAUNCH_NOT_APPROVED`, no rate snapshot, and no Coin credit.

Never bypass that result. The rejected launch artifact makes
`COIN_DEPOSIT_CREDITS_ENABLED=true` fail startup and forces `allowDepositCredits: false`; provider
configuration cannot override it.

The unsigned legacy webhook returns `410`. Multiple live intents for the same destination, reused
event identity with different evidence, wrong network/contract/address, invalid net amount, or
unexpected reversal must fail closed. An admin retry is appropriate only for a safe, fully
confirmed rate-failure state; it cannot override launch approval.

## Withdrawal operations

1. Create a quote using decimal-string `coinAmountMicros`, destination address, and idempotency key.
2. Verify the quote contains a stored rate snapshot, integer USDT estimate, explicit fees, and
   expiry.
3. Consume the quote once. Confirm `withdrawal_reserve` moved the exact amount from available to
   reserved.
4. Confirm the request starts as `pending_review` with `realTransferBlocked: true`.
5. Admin approval may move it only to `approved_for_review`.
6. Confirm `broadcastAttempted` remains false and no provider call occurs.
7. Before any ambiguous external state, cancellation or rejection must append one exact
   `withdrawal_release`.
8. In unknown or incomplete external state, keep the reserve locked.

There is no Fireblocks broadcast route in this cutover. The internal outcome reconciler accepts
separately verified provider evidence but does not initiate a transaction. A verified completion
requires exact final amount/fees, a fresh final rate, provider reference, transaction hash, and
evidence hash before a reserved Coin debit. A verified failure releases the reserve. Anything less
remains manual review.

## Trading and settlement operations

Buy requests use `amountCoinMicros`; sell requests use decimal-string `shares`. Both require an
idempotency key.

For buys:

- reserve stake plus the rounded-up 2% fee;
- finalize exact full/partial fill amount, shares, price, and fee;
- append debit and fee entries;
- release unused reserve;
- commit trade, position, audit, and outbox state atomically.

For sells:

- lock and reduce the stored position;
- credit executed proceeds;
- debit the fee;
- reject overlapping active sell execution for the same position.

An `execution_pending` retry must not resubmit to the venue. Unknown status, missing provider order
identity, inconsistent full/partial/cancel state, invalid integer conversion, or stale position
transition moves the order to manual review. Any buy reserve remains locked until authoritative
evidence is reconciled.

Market resolve/cancel shares the market advisory lock with trade reserve/finalization. It must
reject pending execution. Cancellation and no-winner resolution commit refund rows, Coin entries,
position cleanup, audit, and outbox together. A winner resolution fails with
`SETTLEMENT_PROVIDER_FUNDING_UNVERIFIED` until authoritative external CLOB funding evidence is
persisted and verified. Settlement evidence remains `reviewOnly: true` and
`providerFundingVerified: false`; no externally funded CLOB collateral is proven here.

## Rates, fees, and rounding

`EXCHANGE_RATE_PROVIDER=disabled` is the fail-closed default. For controlled quote tests,
`EXCHANGE_RATE_PROVIDER=coinbase` reads the USDT/USD decimal rate from the configured Coinbase
exchange-rate endpoint. A configured rate source does not enable a Coin credit or provider
transfer.

- rate snapshots use integer nanos;
- deposit conversion rounds down to Coin micros;
- withdrawal conversion rounds down to USDT atomic units;
- current network/provider withdrawal fees are explicit atomic values and default to zero;
- the 2% trading fee rounds up to the next Coin micro;
- stale, future, malformed, mismatched-purpose, or unavailable rates fail closed.

Never assume `1 USDT = 1 USD` and never reconstruct a final rate from a later quote.

## Admin corrections

Finance-admin corrections require the authenticated admin actor, signed integer
`deltaCoinMicros`, reason, source entity, and idempotency key. They append a `correction_credit` or
`correction_debit` entry with before/after audit metadata.

- Never update `coin_accounts` directly.
- Never update or delete a ledger entry, rate snapshot, provider event, migration marker, or cutover
  run.
- Correct a bad entry with a separately reviewed opposite entry referencing the original source.
- Corrections do not represent a deposit, provider completion, or launch approval.

## Incident handling

### Reconciliation discrepancy

1. Stop affected Coin write routes.
2. Keep the database and immutable evidence intact.
3. Save the reconciliation report and relevant audit/outbox records.
4. Identify the first bad idempotency/source/entity chain.
5. Prepare a reviewed forward fix or compensating entry.
6. Re-run reconciliation before restoring writes.

Do not edit history or re-enable legacy writes.

### Deposit evidence conflict

Keep the deposit in `manual_review`. Preserve both payload hashes and raw provider evidence. Compare
provider event ID and chain transfer coordinates separately. Do not retry into a credit state and
do not delete the conflicting event.

### Deposit reversal

A pre-credit reversal cannot debit Coins. A post-credit reversal appends `reversed_deposit`. If
available Coins are insufficient, retain `reversal_pending`, stop dependent withdrawals, and
escalate for manual reconciliation.

### Withdrawal provider state unknown

Keep the full reserve locked. Disable cancellation/rejection release for the request. Obtain
separately verified provider evidence; do not infer failure from a timeout and do not retry a
broadcast from this application.

### Ambiguous trade execution

Move the order to `manual_review`; keep any buy reserve locked and keep the active-sell guard.
Reconcile against authoritative venue order/fill identity before a final debit, credit, release, or
position change. Never resubmit an `execution_pending` order.

### Cutover apply failure

Confirm the serializable transaction rolled back and `money_system_state` did not partially
advance. Save the failure report, fix the fixture or migration logic, restore a clean disposable
database, and repeat from the initial dry-run. Do not hand-edit migration markers.

### Post-cutover rollback request

Rollback means stop Coin money routes, preserve the database, reconcile, and ship a reviewed
forward fix. It does not mean turning legacy writes or dual writes back on. Making legacy
authoritative again requires a separate migration and finance/security approval.

## Required verification

```bash
npm run typecheck
npm run typecheck:vercel
npm run typecheck:web
npm run typecheck:scripts
npm run test
npm run test:web
DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  NODE_ENV=test \
  npm run test:postgres
npm run secrets:audit
npm run migration:plan-check
npm run security:audit
npm run build
```

Also run `npm run coins:reconcile` against the migrated disposable test database and require zero
discrepancies. A green suite does not authorize Fireblocks calls, production migration,
deployment, or real-money launch.

### Outbox worker operations

Apply `032_money_outbox_worker.sql` before enabling the runtime. Claims are bounded and concurrent
safe (`SKIP LOCKED` plus a per-claim fencing token); delivery is at-least-once, so the injected
handler must deduplicate on `idempotencyKey`. Set
`MONEY_OUTBOX_DELIVERY_MODE=structured_log`; the built-in monitoring sink writes only event ID,
event type, aggregate coordinates, and attempt, never payload or idempotency key. Use
`MONEY_OUTBOX_WORKER_ENABLED=true` only in an always-on process. For Vercel Cron set
`MONEY_OUTBOX_DRAIN_ENDPOINT_ENABLED=true` and a random 32+ character `CRON_SECRET`;
`GET /api/cron/money-outbox` requires
`Authorization: Bearer <CRON_SECRET>` and drains one batch. Startup fails when a runtime is enabled
without the explicit delivery mode. Alert on dead letters, lost leases, drain failures, and
reconciliation findings. The Hobby schedule runs daily at 00:00 UTC. Pending or retryable failed
events become reconciliation discrepancies after 26 hours, allowing two hours beyond the normal
24-hour drain interval for scheduler/startup jitter. `dead_letter` is always an immediate
discrepancy; a processing lease remains stale after 15 minutes.

## External blockers

Before any future launch decision, separately close at least:

- named legal, finance, security, and operations approval;
- production-specific backup, restore, maintenance, observation, abort, and forward-recovery
  procedure;
- AML/sanctions/region/account-risk controls;
- Fireblocks key custody, policies, allowlists, limits, broadcast owner, final-fee/rate snapshot,
  and reconciliation;
- authoritative Polymarket CLOB fill receipts, funded collateral proof, and provider
  reconciliation;
- downstream outbox handlers, dead-letter alerting, monitoring, replay controls, and ownership;
- reviewed non-zero withdrawal fee policy where applicable.

Until then, leave launch approval false, deposit crediting disabled, withdrawal broadcast absent,
and production balance migration unimplemented.
