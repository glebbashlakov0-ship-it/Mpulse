# Mpulse Coins money architecture

## Status and trust boundaries

The Coin cutover is implemented for PostgreSQL-backed application state, but production money
movement is **review-only and not approved**. The runtime deliberately sets deposit crediting to
disabled and does not initiate a Fireblocks withdrawal. The only external money-provider
integration in this focused cutover verifies signed inbound Fireblocks webhooks and ingests their
review evidence. It cannot credit Coins, and no withdrawal broadcast or real CLOB execution path is
reachable.

The three money domains must remain separate:

- Fireblocks owns custody addresses, signed provider events, and external USDT TRC-20 transfers.
- Mpulse owns Coin accounts, immutable Coin ledger entries, reserves, fees, trades, positions, and
  settlement.
- Polymarket CLOB owns venue prices, shares, orders, fills, collateral, and settlement evidence.

Fireblocks never stores Coins. A CLOB price, share count, or quote amount is never relabelled as a
Coin balance. The browser is an untrusted presentation client; it cannot calculate or submit a
balance, credit, debit, fee, provider status, or final exchange rate.

## Canonical units and API contract

- `1 Coin = 1 USD` as an internal accounting policy.
- `1 Coin = 1,000,000 coin micros`.
- `1 USDT = 1,000,000 usdt atomic` on the supported TRON/TRC-20 rail.
- A USDT/USD rate is stored as integer nanos:
  `1.000000000 USD per USDT = 1,000,000,000 rate nanos`.
- Authoritative amounts are PostgreSQL `BIGINT` values and TypeScript `bigint` values.
- JSON money integers are decimal **strings**, for example
  `"availableCoinMicros": "12500000"` and `"estimatedUsdtAtomic": "12450123"`.
- Human-readable decimal inputs are plain strings and accept only their declared precision.
  Coin and USDT inputs allow at most six decimals; rates allow at most nine.
- JavaScript `number`, `parseFloat`, and binary floating point are not authoritative money tools.
  Decimal price/share strings remain venue-specific and are converted at explicit boundaries.

Primary public money endpoints:

- `GET /api/money/supported-assets`
- `GET /api/coins/balance`
- `GET /api/coins/ledger?limit=100`
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
- `GET /api/portfolio`
- `GET /api/trading/positions`
- `GET /api/trading/trades`

The Coin balance, ledger, wallet, portfolio, and trading routes require authentication,
PostgreSQL, and a completed cutover. They fail closed with a `503` error when the persistent Coin
owner is unavailable. The old `/api/ledger/*` balance path and unsigned legacy deposit webhook are
not a fallback. `POST /api/wallets/webhooks/deposits` returns
`410 LEGACY_DEPOSIT_WEBHOOK_RETIRED` unless the configured deposit provider is Fireblocks.

Finance-admin endpoints include:

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

Admin approval means `approved_for_review`; it does not broadcast a transfer. Corrections require
an admin actor, reason, source entity, and idempotency key and produce compensating ledger entries.
Direct legacy admin deposit credits are retired.

## Authoritative ledger and no dual writes

`coin_accounts` caches available and reserved Coin micros. `coin_ledger_entries` is the immutable
source of truth. Every movement goes through the database function `coin_post_ledger_entry`, which:

1. checks the global cutover state;
2. creates a zero account if needed and locks that account row;
3. compares the complete payload when an idempotency key already exists;
4. rejects any negative resulting available or reserved balance;
5. updates the cached account and appends the ledger entry in one transaction.

Database triggers reject direct balance mutation, non-zero account creation, ledger update/delete,
and update/delete of rate snapshots, provider events, migration markers, and cutover runs.
Operation-specific constraints enforce the shape of credits, reserves, releases, final debits,
fees, corrections, and reversals.

`money_system_state` is the global fence:

- `legacy`: normal Coin posting is rejected with `COIN_CUTOVER_INCOMPLETE`;
- `migrating`: legacy writes are fenced and only `migration_credit` Coin entries are accepted;
- `coin`: the Coin ledger is authoritative and legacy ledger/balance writes remain fenced.

Coin posting also fails closed if the singleton state row is missing or null. A partial
configuration can never be interpreted as an active Coin cutover. Fireblocks destination
ownership is unique across `(provider, asset, network, address)` so a provider address cannot map
to two users.

There are no dual writes. After cutover, triggers reject inserts/updates/deletes in legacy
`ledger_entries` and balance changes in legacy `wallets`. Reads and writes must not silently return
to memory or legacy money state.

## Deposit lifecycle

Only USDT on TRON using the configured `USDT_TRON_CONTRACT` is accepted.

1. A Fireblocks-provisioned active `wallets` row supplies the verified TRON address.
2. `POST /api/wallets/deposit-intents` accepts `expectedUsdtAtomic` as an integer string. The
   expectation is informational and never controls the credited amount.
3. When `REAL_MONEY_DEPOSIT_PROVIDER=fireblocks`, the webhook verifier checks the detached JWS in
   `Fireblocks-Webhook-Signature` over the raw request body using RS512 and the configured official
   region-specific Fireblocks JWKS (for example, the US production endpoint is
   `https://keys.fireblocks.io/.well-known/jwks.json`). Provider event ID, payload hash, raw
   payload, provider transaction ID, chain transaction hash, event index, token contract,
   destination, amount, fees, status, and confirmations are persisted.
4. Provider events and chain-transfer coordinates are independently deduplicated. Reusing a
   provider event ID with a different payload is persisted as a conflict and routed to
   `manual_review`; it never credits Coins. A repeat chain/provider transaction must exactly match
   asset, network, provider transaction ID, chain coordinates, contract, destination, gross
   amount, both fees, and net amount. Conflicting evidence cannot mutate a credited, reversing, or
   reversed financial state.
5. Asset, network, token contract, verified intent/address, positive net amount, provider state,
   and monotonically increasing confirmations are validated.
   Multiple live intents for the same destination are ambiguous and fail closed instead of choosing
   the newest intent.
6. A valid event progresses through `detected` / `confirming`. When the confirmation threshold is
   reached, launch policy is checked before any rate or credit.
7. The server enables crediting only when `COIN_DEPOSIT_CREDITS_ENABLED=true` and the signed
   Fireblocks webhook, rate provider, and USDT TRON contract prerequisites are all configured.
   The default false gate also disables deposit-intent creation; partial configuration fails
   startup instead of exposing an unsafe rail.
8. In an explicitly enabled runtime, a fresh final rate is required. Unavailable rates use
   `pending_rate`; stale rates use `confirmed_unpriced`. An admin retry is limited to safe,
   fully-confirmed rate failures.
9. A future allowed credit would atomically store the immutable rate snapshot, append
   `crypto_deposit_credit`, update deposit/intent state, write audit data, and enqueue an outbox
   event.

Provider reversals before credit are rejected. A reversal after credit posts a
`reversed_deposit` compensating debit. If available Coins are insufficient, the deposit moves to
`reversal_pending` for manual reconciliation; history is never edited.

## Withdrawal lifecycle

1. `POST /api/wallets/withdrawal-quotes` accepts `coinAmountMicros`,
   `destinationAddress`, and an idempotency key. The service validates the TRON address and obtains
   an indicative USDT/USD quote.
2. Coin-to-USDT conversion and explicit network/provider fees produce
   `estimatedUsdtAtomic`. The quote and immutable rate snapshot expire together.
3. `POST /api/wallets/withdrawal-requests` consumes the quote and atomically posts
   `withdrawal_reserve`, moving Coins from available to reserved.
4. The request enters `pending_review` with `realTransferBlocked: true`. Admin approval only moves
   it to `approved_for_review`; `broadcastAttempted` remains false.
5. User cancellation or admin rejection posts `withdrawal_release` and moves the exact reserve
   back to available only before broadcast or after a conclusively verified provider failure.
6. Retry remains blocked while launch approval is absent. Unknown external state, a final
   amount/rate mismatch, missing transaction evidence, and every other non-conclusive provider
   result keep the reserve locked; neither user cancellation nor admin rejection can release it.
7. The internal reconciliation owner can accept a separately verified Fireblocks outcome; it does
   not initiate a provider call. A verified failure releases the reserve. A verified completion
   requires a fresh final rate, exact final amount/fee agreement, provider reference, transaction
   hash, and evidence hash before posting `withdrawal_debit` from reserved Coins.

Creation is separately gated by `COIN_WITHDRAWAL_REQUESTS_ENABLED` and requires a configured rate
provider. The public/admin routes do not expose a Fireblocks broadcast action, so an enabled
withdrawal rail remains review-only.

## Trading and settlement lifecycle

Trading requests use string fields: buys require `amountCoinMicros`; sells require a decimal
`shares` string. The order value must be between 1 and 100,000 Coins. An idempotency key is required.

For a buy, the owner transaction reserves stake plus fee with `trade_reserve`, then records
execution state. A rejected/cancelled execution releases the reserve. A completed or partial fill
atomically commits the trade, position, `trade_debit`, `fee_debit`, and any unused
`trade_release`. For a sell, execution reduces the stored position and credits proceeds with
`trade_settlement_credit`, then debits the fee from available Coins. If external execution may have
succeeded but local finalization is uncertain, the order moves to `manual_review` and its reserve
stays locked.

An `execution_pending` idempotent retry never calls the venue again. Provider fills must reconcile
in integer units: positive shares and amount, shares no greater than requested, status consistent
with full/partial fill, `amount = shares × price` within one Coin micro, and the exact 2% rounded-up
fee. Unknown statuses, invalid units, missing provider order identity, non-zero cancelled fills,
or stale local position transitions remain in manual reconciliation without releasing funds.

Sell execution has a database uniqueness guard per user/market/side while it is pending or under
manual review. Trading reserve/finalization and market settlement share the same advisory market
lock; reserve and finalization both reject an already settled market, while settlement rejects any
pending execution. `COIN_INTERNAL_TRADING_ENABLED=true` may explicitly enable this internal
simulated execution in production, but it remains policy-labelled and is not evidence of
real-money readiness. It never enables a real venue runtime. Any future venue
integration would also require an audited `launchApproval.approved` capability; provider
configuration alone must never reach the venue.

Admin market resolve/cancel is idempotent and PostgreSQL-only. Settlement row, payout rows, Coin
ledger credits, position cleanup, audit event, and outbox event commit atomically. Cancellation or a
market with no winner refunds the recorded Coin cost. A resolved winner is not credited while
external CLOB funding remains unverified: the transaction fails closed with
`SETTLEMENT_PROVIDER_FUNDING_UNVERIFIED` and leaves positions and balances unchanged. Settlement
evidence explicitly reports `providerFundingVerified: false` and `reviewOnly: true`; the
application does not yet prove or reconcile externally funded CLOB collateral, so this path is not
launch evidence.

## Rates, fees, and rounding

`EXCHANGE_RATE_PROVIDER=disabled` is the safe default. It blocks conversion instead of assuming
USDT equals USD. `EXCHANGE_RATE_PROVIDER=coinbase` calls the Coinbase Data API endpoint configured
by `EXCHANGE_RATE_COINBASE_URL` (default:
`https://api.coinbase.com/v2/exchange-rates?currency=USDT`) and reads the returned USD rate as a
decimal string. Provider responses, future timestamps, amount/purpose/kind mismatches, and expired
quotes fail closed. Coinbase documents the response contract in its
[exchange-rate API documentation](https://docs.cdp.coinbase.com/coinbase-business/track-apis/exchange-rates).

- `EXCHANGE_RATE_TTL_SECONDS` defaults to 30 seconds.
- `EXCHANGE_RATE_REQUEST_TIMEOUT_MS` defaults to 5000 milliseconds.
- Deposit USDT-to-Coin conversion rounds down to Coin micros.
- Withdrawal Coin-to-USDT conversion rounds down to USDT atomic units.
- The current withdrawal network/provider fees are explicit integer atomic values and default to
  zero unless the service is configured with reviewed values.
- Coin trading charges 200 basis points (2%) and rounds the fee up to the next Coin micro.
- Shares and prices are converted with integer multiply/divide boundaries; cost basis and displayed
  valuation round down.

No flow may invent a `1 USDT = 1 USD` rate or reconstruct a final rate from a later quote.

## Cutover migration

The checked migration plan is intentionally sparse: existing migrations `001` through `016`, then
`031_coins_ledger_cutover.sql`. Migration `031` is structural. It creates the Coin schema and
fences but does not copy balances automatically. The data policy is
`1 legacy internal dollar-equivalent unit = 1 Coin`, because the legacy ledger did not preserve
historical FX snapshots. Values with more than six decimals, negative resulting balances, unsafe
historical trade/position/settlement projections, and integer overflow block apply.

The current data-migration CLI is deliberately **TEST_DATABASE_URL-only**. It refuses a production
deployment context, a non-test database, the same target as `DATABASE_URL`, and maintenance
databases. It is validation tooling, not authorization or a production runbook:

```bash
DATABASE_URL=postgresql://localhost/mpulse_coins_test \
  DATABASE_SSL=false \
  npm run db:migrate

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql://localhost/mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  npm run coins:migration:dry-run

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql://localhost/mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  COINS_MIGRATION_APPLY=true \
  npm run coins:migration:apply

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql://localhost/mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  npm run coins:migration:dry-run

DATABASE_URL= \
  TEST_DATABASE_URL=postgresql://localhost/mpulse_coins_test \
  TEST_DATABASE_SSL=false \
  npm run coins:reconcile
```

Apply runs in a serializable transaction, takes an advisory lock, locks the legacy money/projection
tables, snapshots balances after those locks, writes a per-user marker and migration entry, converts
historical projections, verifies exact before/expected/after totals, records a cutover run, and
switches the global state to `coin`. Dry-run reports pending deposit/withdrawal counts and Coin
micros; apply is atomically blocked until all legacy pending operations are drained. Historical
share projections must fit signed `BIGINT` micros and have no more than six decimals. A second
apply is a no-op.

There is currently no production-balance apply command. Production cutover remains blocked until a
separately reviewed operator workflow covers backup/restore, exact target selection, approvals,
maintenance mode, observation, and abort criteria. Never put Coin data migration in an automatic
deployment hook.

## Reconciliation and recovery

`npm run coins:reconcile` is read-only with respect to money. It records a report and audit event,
does not repair balances, and exits with code 2 when discrepancies exist. It checks:

- Coin account cache versus ledger sums and every entry's running balance;
- credited deposits, conversion math, rate snapshots, reversals, and provider evidence;
- withdrawal reserves, releases, and terminal/final debit state;
- trade order accounting, fees, releases, execution links, and Coin projections;
- settlement payouts, totals, ledger links, and historical projection conversion;
- migration markers/cutover totals;
- post-cutover legacy writes; and
- failed or stale pending/processing outbox events.

Operational recovery uses new idempotent or compensating entries:

- Never update/delete a Coin ledger entry, rate snapshot, provider event, or migration marker.
- Never edit `coin_accounts` to make a dashboard match.
- A bad admin entry gets a reviewed opposite correction with the original source in metadata.
- A rejected/cancelled withdrawal gets a release; an unknown provider outcome keeps the reserve.
- A deposit reversal gets `reversed_deposit`; insufficient available Coins requires manual review.
- Ambiguous external trade execution keeps the reserve until provider evidence is reconciled.

Rollback after cutover does not mean re-enabling legacy writes or dual writing. Stop money routes,
keep the database read-only, reconcile, and deploy a reviewed forward fix. Any proposal to restore
legacy as authoritative requires a separate migration and finance/security approval.
