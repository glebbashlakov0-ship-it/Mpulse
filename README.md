# Pulse Market

Pulse Market is a TypeScript/Fastify and React/Vite prediction-market application. This branch
cuts authenticated user money state over to a PostgreSQL-backed Coin ledger.

## Money status

Real-money launch is **not approved**. The implemented posture is review-only:

- `1 Coin = 1 USD` as an internal accounting policy.
- `1 Coin = 1,000,000` integer Coin micros.
- USDT TRC-20 is an external rail, never the internal balance unit.
- Review-only withdrawal requests and internal Coin trading require separate explicit environment
  opt-ins and default to disabled;
- the controlling rejected launch artifact prevents the deposit-credit gate from enabling, even
  when every Fireblocks, rate, and contract prerequisite is configured;
- there is no public or admin Fireblocks withdrawal-broadcast route;
- internal Coin trading never enables or calls a Polymarket CLOB execution runtime;
- the balance-migration CLI accepts only a dedicated test database;
- the authorized production balance cutover is release-marker gated; this change itself does not
  deploy anything.

The Coin ledger, Fireblocks custody, and Polymarket CLOB execution are separate trust domains.
Provider configuration, a green test run, or a successful rehearsal does not enable real money.
The controlling denial is recorded in
[docs/real-money-launch-approval.md](docs/real-money-launch-approval.md).

The production capability switches are:

```dotenv
COIN_DEPOSIT_CREDITS_ENABLED=false
COIN_WITHDRAWAL_REQUESTS_ENABLED=false
COIN_INTERNAL_TRADING_ENABLED=false
```

`COIN_DEPOSIT_CREDITS_ENABLED=true` is rejected at startup while the controlling launch artifact
remains rejected; provider configuration cannot override that decision. Operators may enable only
`COIN_WITHDRAWAL_REQUESTS_ENABLED=true` (with `EXCHANGE_RATE_PROVIDER=coinbase`) and
`COIN_INTERNAL_TRADING_ENABLED=true`. The former creates a rate-backed, review-only request and
reserves Coins; it never broadcasts. The latter executes only against the internal Coin ledger and
keeps real/CLOB execution disabled. `GET /api/money/supported-assets` returns the effective gates
and explicitly reports that deposit crediting, withdrawal broadcast, external trading, and
outbound funds provider calls remain disabled.

## Coin ownership and invariants

PostgreSQL is authoritative for authenticated balances, reserves, deposits, withdrawals, trades,
positions, settlements, and reconciliation. `coin_ledger_entries` is immutable history;
`coin_accounts` is a locked available/reserved cache derived by the database posting function.

All authoritative JSON money integers are decimal strings:

```json
{
  "availableCoinMicros": "12500000",
  "reservedCoinMicros": "2500000",
  "estimatedUsdtAtomic": "9985000"
}
```

TypeScript `bigint` and PostgreSQL `BIGINT` own arithmetic. JavaScript `number`, `parseFloat`, and
binary floating point are display-only. Ledger entries require an idempotency key, source, reason,
and entity reference. Full-payload replay comparison, row locking, and negative-balance checks
protect each posting.

`money_system_state.active_system` is the global fence:

- `legacy`: normal Coin posting fails closed;
- `migrating`: legacy writes are fenced and only migration credits are allowed;
- `coin`: Coin is authoritative and legacy money writes remain fenced.

There is no dual-write or memory/legacy fallback for authenticated money routes. A missing or
invalid cutover row also fails closed.

See [docs/coins-architecture.md](docs/coins-architecture.md) for units, ledger constraints,
lifecycle details, rates, rounding, migration, and recovery.

## Implemented money APIs

User routes:

- `GET /api/money/supported-assets`
- `GET /api/coins/balance`
- `GET /api/coins/ledger`
- `GET /api/wallets/me`
- `POST /api/wallets/deposit-intents`
- `GET /api/wallets/deposits`
- `POST /api/wallets/withdrawal-quotes`
- `POST /api/wallets/withdrawal-requests`
- `GET /api/wallets/withdrawal-requests`
- `GET /api/wallets/withdrawal-requests/:id`
- `POST /api/wallets/withdrawal-requests/:id/cancel`
- `POST /api/trading/quote`
- `POST /api/trading/orders`
- `POST /api/trading/trades` (Coin buy compatibility route; requires `Idempotency-Key`)
- `GET /api/trading/positions`
- `GET /api/trading/trades`
- `GET /api/portfolio`

Signed provider callback:

- `POST /api/wallets/webhooks/deposits` — exact raw Fireblocks V2 JSON plus
  `Fireblocks-Webhook-Signature`; this is not a user payment-proof endpoint.

Finance-admin routes:

- `GET /api/admin/money/users/:userId`
- `POST /api/admin/money/users/:userId/corrections`
- `GET /api/admin/money/deposits`
- `GET /api/admin/money/deposits/:id`
- `POST /api/admin/money/deposits/:id/retry`
- `GET /api/admin/money/withdrawals`
- `POST /api/admin/money/withdrawals/:id/approve`
- `POST /api/admin/money/withdrawals/:id/reject`
- `POST /api/admin/money/withdrawals/:id/retry`
- `POST /api/admin/markets/:id/resolve`
- `POST /api/admin/markets/:id/cancel`

Coin-backed compatibility aliases remain available for older admin clients:
`GET /api/admin/wallet-withdrawals`,
`POST /api/admin/wallet-withdrawals/:id/reject`, and
`GET /api/admin/wallet-deposit-requests`. The old deposit approve/reject mutations return `410`;
the aliases never restore a legacy balance owner.

Admin approval moves a withdrawal only to `approved_for_review`; it does not send a provider
transaction. Corrections append explicit compensating Coin entries and never rewrite history.

Retired paths do not fall back to the old owner:

- legacy `/api/ledger/*` user-money routes are not registered;
- the unsigned legacy deposit webhook returns `410`;
- legacy manual admin deposit-credit routes return `410`;
- `POST /api/portfolio/reset` returns `410`;
- legacy money writes are database-fenced after cutover.

## Lifecycle summary

### Deposit

A deposit intent records an informational `expectedUsdtAtomic` string. When
`REAL_MONEY_DEPOSIT_PROVIDER=fireblocks`, the raw Fireblocks request is verified as a detached
RS512 JWS from `Fireblocks-Webhook-Signature` using the official JWKS configured for the Fireblocks
region. Provider event identity and chain-transfer identity are independently deduplicated, while
immutable event evidence, amounts, fees, address, contract, confirmations, and payload hash are
persisted.

Only configured USDT/TRON transfers to an owned address can progress. Payload conflicts, ambiguous
intents, wrong contract/network, decreasing confirmations, and other inconsistent evidence fail
closed. The current rejected launch artifact keeps deposit intents and credits disabled and makes
`COIN_DEPOSIT_CREDITS_ENABLED=true` fail startup, including when the signed webhook, provider,
rate, and contract prerequisites are complete. A future reviewed code change must wire an
explicitly approved artifact before those operational prerequisites can be evaluated for
enablement.

### Withdrawal

A withdrawal quote snapshots an indicative rate and returns integer-string amounts. Consuming the
quote atomically posts `withdrawal_reserve`, moving Coins from available to reserved. Cancellation
or rejection can post `withdrawal_release` only before any ambiguous external outcome.

Creation requires `COIN_WITHDRAWAL_REQUESTS_ENABLED=true` and a configured exchange-rate provider.
Admin approval remains `approved_for_review`. There is no Fireblocks broadcast action. Unknown or
incomplete provider evidence keeps the reserve locked. The internal outcome reconciler may consume
separately verified completion/failure evidence, but it never initiates the provider call.

### Trade and settlement

Buy orders reserve stake plus the rounded-up 2% fee. A completed or partial fill atomically commits
the trade, position, debit, fee, unused-reserve release, audit record, and outbox event. Sell
orders reduce the position, credit proceeds, and debit the fee. Ambiguous venue outcomes move to
`manual_review`; retries of `execution_pending` do not resubmit.

Provider fills must reconcile exact integer amount/share/price/fee relationships. Active sells are
unique per position, and trade finalization and settlement share a market lock. Market cancel and
no-winner resolution commit refund entries, position cleanup, settlement, audit, and outbox state
together. Winner payout credits fail closed until authoritative external CLOB funding evidence is
persisted and verified. This cutover does not provide that evidence and is not real-money launch
approval.

## Local development

Install dependencies and start the API and web app:

```bash
npm install
npm run dev:api
npm run dev:web
```

Copy `.env.example` to `.env`. Keep `APP_MODE=local`. With `DATABASE_URL` empty, non-money local
features can use their development repositories; authenticated Coin routes fail closed. Schema
migration alone deliberately leaves `money_system_state` in `legacy`, so it is not enough to enable
Coin routes. To exercise them, use a disposable test-scoped database (for example
`mpulse_coins_dev_test`), complete the dry-run/apply rehearsal below with `DATABASE_URL` unset, and
only then start the API with `DATABASE_URL` pointing to that already cut-over test database. Never
manually update the fence.

Do not commit credentials. The included Fireblocks integration verifies signed inbound webhooks and
stores review evidence, but cannot credit Coins or broadcast. No Fireblocks private key, source
vault, or broadcast configuration belongs in this app.

## Sparse migration plan and cutover rehearsal

The checked migration plan is intentionally sparse: existing migrations `001` through `016`, then
`031_coins_ledger_cutover.sql`, `032_money_outbox_worker.sql`, and
`033_production_coin_cutover_evidence.sql`, followed by
`034_seal_production_coin_cutover_snapshot.sql`. Migration `031` creates the Coin schema, immutable
guards, global fences, provider evidence, withdrawals, trading, settlement, outbox, cutover, and
reconciliation tables. Migration `032` adds durable leases, fencing tokens, retry/dead-letter
state, and claim indexes. Migration `033` adds immutable pre-cutover snapshots and completion
evidence. Migration `034` seals per-user snapshot rows once completion is recorded. None of the
schema migrations copies balances.

Validate the explicit plan:

```bash
npm run migration:plan-check
```

The durable outbox supports an always-on loop and a bounded Vercel Cron drain. Enabling either
requires `MONEY_OUTBOX_DELIVERY_MODE=structured_log`; the built-in sink records only safe event
metadata and never the payload or idempotency key. Cron draining additionally requires a 32+
character `CRON_SECRET` and `Authorization: Bearer <CRON_SECRET>`. The Hobby-compatible schedule
runs once per day; reconciliation allows a 26-hour pending/failed delivery window (24 hours plus
two hours of scheduler/startup margin). Dead-letter events remain immediate discrepancies.

The data migration is test-only and requires a dedicated test-scoped target:

```bash
DATABASE_URL=postgresql:///mpulse_coins_test \
  DATABASE_SSL=false \
  npm run db:migrate

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  npm run coins:migration:dry-run

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  COINS_MIGRATION_APPLY=true \
  npm run coins:migration:apply

# The second apply must be a no-op.
DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  COINS_MIGRATION_APPLY=true \
  npm run coins:migration:apply

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  npm run coins:reconcile
```

The CLI rejects production context, maintenance databases, non-test-scoped targets, and a target
matching `DATABASE_URL`. It checks pending legacy operations and exact totals before changing the
fence.

For the single authorized release,
`releases/2026-07-25-coins-v1-production-cutover.json` gates a separate post-deploy production
operation:

```bash
npm run coins:production-cutover
```

`npm run vercel-build` does **not** invoke that command. It runs a read-only environment preflight
through `getConfig()` and then compiles, so a failed build cannot move the production money fence.
After the new artifact is deployed, an operator may temporarily enable
`PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=true`. Authenticated
`GET /api/ops/production-coin-cutover/identity` returns only the safe host/port/database/fingerprint
needed to verify the target. After the marker is pinned and the reviewed artifact is redeployed,
authenticated `POST /api/ops/production-coin-cutover` invokes the guarded wrapper. Both endpoints
require the production Vercel runtime and `Authorization: Bearer <CRON_SECRET>`.

The wrapper requires the marked `mpulse.vercel.app` project, verified TLS, and the exact
principal-bound `DATABASE_URL` fingerprint committed in the release marker; it rejects
`TEST_DATABASE_URL`. Transaction-scoped advisory locks remain valid through a transaction pooler.
The wrapper applies the schema plan, inspects legacy state, atomically stores an in-database
per-user balance snapshot, applies the Coin migration, reconciles, and records immutable completion
evidence. Pending or invalid legacy data and any reconciliation discrepancy fail the operation.
Repeating the same marked release verifies the sealed evidence and performs no second migration.

The detailed operator sequence, expected output, reconciliation categories, and incident handling
are in [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Verification

Run the repository checks:

```bash
npm run typecheck
npm run typecheck:vercel
npm run typecheck:web
npm run typecheck:scripts
npm run test
npm run test:web
TEST_DATABASE_URL=postgresql:///mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  NODE_ENV=test \
  npm run test:postgres
npm run secrets:audit
npm run migration:plan-check
npm run security:audit
npm run build
```

The PostgreSQL test target must be dedicated and test-scoped. A green result is merge evidence
only. It does not authorize deployment, Fireblocks operations, or real-money launch.
