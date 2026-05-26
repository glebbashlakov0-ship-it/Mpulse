# Pulse Market

Backend and frontend local for a Polymarket-style prediction market product. The app currently uses
public Polymarket market data and local-only trading.

## Project knowledge

- [Knowledge base](Claude.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Runbook](docs/RUNBOOK.md)

## What exists now

- React/Vite/TypeScript frontend in `web/` styled with Tailwind CSS utilities; `styles.css`
  contains only the Tailwind import
- Product frontend market discovery controls for backend-owned search, primary nav category/topic
  shortcuts, category/topic, sort, status, min/max volume, and closing date filters, synced to URL
  query params
- Compact Polymarket-like Pulse Market cards with `displayImage`/image/icon/category fallback
  handling, deterministic fallback pools for repeated upstream images, multi-outcome odds, and
  tested card/detail outcome action labels
- Market detail screen with prices, volume/liquidity, dates, rules, related markets with
  related-owned image/icon/fallback visuals, local ticket, and chart-safe `history.price_history`;
  binary charts use backend-fetched Polymarket CLOB history first, local snapshots second, and
  synthetic fallback only when both are unavailable; large CLOB histories are downsampled for
  responsive SVG rendering
- Local portfolio screen with cash, equity, positions value, local PnL, open positions, trade
  history, loading/error/empty states, and backend reset/trade refresh
- Mobile-safe frontend pass across home, cards, market detail, portfolio, profile, and admin
  core screens; `web/src/styles.css` remains Tailwind-only
- trading Logic local with backend quote/order endpoints, buy/sell, partial position reduction,
  idempotency keys, backend-returned PnL summary, user-scoped trade history, and trading audit
  events
- Auth local with hashed passwords, HttpOnly SameSite cookie sessions, CSRF tokens for browser
  state-changing requests, email verification, password reset, 2FA setup QR/backup codes,
  session/device management, auth rate limits, login/sign-up/logout UI, mobile auth menu, and
  profile settings
- Postgres/Supabase database core behind `DATABASE_URL`, with SQL migrations, a DB client,
  repository interfaces/adapters, and memory fallback when DB is disabled
- Initial tables for users, sessions, settings, markets, outcomes, snapshots, categories,
  wallets, positions, trades, ledger entries, audit logs, comments, and market visibility rules
- Audit log core for auth register/login/logout/settings and trading events
- Backend-only Finance & Ledger Core with memory fallback and Postgres persistence behind
  `DATABASE_URL`, ledger-derived balances, required idempotency keys, insufficient-balance checks,
  idempotency payload mismatch protection, transaction-safe Postgres writes, and local audit
  events
- Authenticated local ledger endpoints: `GET /api/ledger/balance`, `GET /api/ledger/entries`,
  and `POST /api/ledger/credits`; ledger credit is not a real deposit
- Authenticated compliance core endpoints for self-declared local profile data, legal consent
  versions, and eligibility checks; runtime uses Postgres when `DATABASE_URL` is enabled and
  memory fallback only in dev/test without DB; real-money eligibility is always disabled
- Authenticated portfolio/trading state uses Postgres-backed ledger, trades, and positions when
  `DATABASE_URL` is enabled. Guest/local memory trading remains dev/test only; DB mode requires
  auth for stateful portfolio/trading routes instead of falling back to memory.
- Wallets & USDT TRC-20 Core endpoints backed by memory fallback or Postgres when
  `DATABASE_URL` is enabled: authenticated local wallet wallet, deposit intent, deposit event
  list, withdrawal request create/list, provider events, provider abstraction, `WalletDepositProvider`,
  and a dev-secret protected local/provider deposit webhook. Confirmed USDT/TRON deposits can credit
  ledger after safety gates and idempotency; this is not wallet, not withdrawals, not private-key
  storage, and not blockchain polling.
- Admin Core with backend-owned roles (`user`, `support`, `compliance_admin`,
  `finance_admin`, `super_admin`), role-specific env allowlists, least-privilege
  `/api/admin/*` guards, users/audit/withdrawal/market moderation endpoints, and a basic
  `#admin` frontend page. It is local: no real withdrawal approval, wallet, broadcast, ledger
  debit, settlement, or real-money action.
- Production readiness core: `GET /api/health`, `GET /api/ready`, strict env validation,
  explicit `APP_MODE=local`, production secure-cookie/CORS/DB/webhook guardrails, and a
  CI workflow for backend typecheck, web typecheck, backend tests, frontend tests, and web build
- Supabase DB auth smoke test passed: migrations applied, `/health` reported `database: enabled`,
  curl register/login/me/logout succeeded with cookie sessions, and auth/settings/audit rows were
  verified in Postgres
- `GET /health`
- `GET /api/health`
- `GET /api/ready`
- `GET /api/events`
- `GET /api/events/:id`
- `GET /api/markets`
- `GET /api/markets/:id` returns the normalized market detail shape, including
  `prices`, `dates`, `volume_detail`, normalized outcomes, `related_markets`, and
  `history.snapshots` / `history.price_history`. For binary markets the backend builds
  `history.price_history` from Polymarket CLOB Yes/No token history when available, then falls
  back to local snapshots, then to synthetic fallback.
- `POST /api/markets/:id/snapshots/collect` collects the current Polymarket prices into
  `market_snapshots` for real chart history
- `GET /api/categories`
- `GET /api/tags` returns the normalized category list for backwards compatibility
- `GET /api/search?q=bitcoin` returns normalized markets, not raw upstream results
- `GET /api/market-snapshots/schema`
- `POST /api/trading/quote`
- `POST /api/trading/orders`
- `GET /api/trading/positions`
- `GET /api/trading/trades`
- `GET /api/ledger/balance`
- `GET /api/ledger/entries`
- `POST /api/ledger/credits`
- `GET /api/compliance/me`
- `PATCH /api/compliance/me`
- `POST /api/compliance/accept-terms`
- `GET /api/compliance/eligibility`
- `GET /api/wallets/me`
- `POST /api/wallets/deposit-intents`
- `GET /api/wallets/deposits`
- `POST /api/wallets/withdrawal-requests`
- `GET /api/wallets/withdrawal-requests`
- `POST /api/wallets/webhooks/deposits`
- `GET /api/auth/csrf`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:id`
- `POST /api/auth/sessions/revoke-others`
- `POST /api/auth/sessions/revoke-all`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/auth/2fa`
- `POST /api/auth/2fa/setup`
- `POST /api/auth/2fa/confirm`
- `POST /api/auth/2fa/disable`
- `POST /api/auth/2fa/backup-codes/regenerate`
- `GET /api/admin/users`
- `GET /api/admin/audit-logs`
- `GET /api/admin/wallet-withdrawals`
- `POST /api/admin/wallet-withdrawals/:id/reject`
- `POST /api/admin/markets/:id/hide`
- `POST /api/admin/markets/:id/unhide`
- `GET /api/portfolio`
- `POST /api/trading/trades`
- `POST /api/portfolio/reset`
- `PATCH /api/users/me/settings`

The app can run without a database for dev/test. When `DATABASE_URL` is absent, the API logs that
DB is disabled and falls back to memory repositories. Production startup fails fast without
`DATABASE_URL`, and DB mode does not silently fall back to guest memory state for portfolio/trading
routes. When `DATABASE_URL` is set and migrations are applied, auth users/sessions/settings, audit
logs, compliance profiles/consents, ledger entries, wallet rows, deposit intents, deposit events,
withdrawal requests, wallet provider events, watchlist rows, trades, and positions use Postgres.
Market data still comes from `https://gamma-api.polymarket.com`; binary chart history can also
come from backend-only `https://clob.polymarket.com/prices-history` calls using Gamma
`clobTokenIds`. Responses are cached in backend memory where configured and normalized into the
API response shape.

All Polymarket traffic stays on the backend. Frontend market list/detail/search/category flows use
the API response shapes only.

Stable market fields are `id`, `slug`, `title`, `description`, `category`, `category_label`,
`topics`, `image`, `icon`, `outcomes`, `volume`, `liquidity`, `starts_at`, `ends_at`, `status`,
and `source`. Detail responses also include `prices`, `dates`, `volume_detail`,
`related_markets`, and `history`.

Market list/detail metadata includes `lastSyncedAt`, `isStale`, `sourceStatus`, and `warnings`.
When Polymarket is temporarily unavailable, the backend returns stale cache where possible; without
stale cache it returns a controlled `UPSTREAM_UNAVAILABLE` error instead of raw upstream payload.

Important rule: the frontend is untrusted. Balances, positions, trades, wallet state, and future
real-money logic must be owned by the backend.

## Run locally

API:

```bash
npm install
npm run dev:api
```

Default URL:

```txt
http://localhost:4000
```

Frontend:

```bash
npm run dev:web
```

Default URL:

```txt
http://localhost:5173
```

Example:

```bash
curl 'http://localhost:4000/api/markets?limit=5&active=true&closed=false'
curl 'http://localhost:4000/api/health'
curl 'http://localhost:4000/api/ready'
```

`/api/health` is a simple non-secret liveness check. `/api/ready` checks DB availability, the
backend market data layer, and critical configuration flags; it returns HTTP 503 until the DB and
required guardrails are configured.

Backend-owned search/filter/sort:

```bash
curl 'http://localhost:4000/api/markets?search=bitcoin&category=crypto&sort=relevance&limit=12'
curl 'http://localhost:4000/api/markets?topic=crypto&sort=volume&limit=12'
curl 'http://localhost:4000/api/markets?sort=closing_soon&min_volume=10000&active=true&closed=false'
curl 'http://localhost:4000/api/markets?status=live&min_volume=10000&max_volume=500000&closing_before=2026-12-31T00:00:00.000Z'
```

`topic=all` is treated as no filter. Other topic values are normalized and matched against
`market.topics`, with `market.category` as a fallback match.
Malformed numeric params such as `limit=abc`, `offset=abc`, `min_volume=abc`, or
`max_volume=abc` return a controlled `INVALID_QUERY` response.

Categories/topics:

```txt
Politics, Sports, Crypto, Tech, Finance, Geopolitics, Culture, Economy, Weather, Elections, Other
```

Market detail:

```bash
curl 'http://localhost:4000/api/markets/540817'
```

Market detail chart source order:

1. Polymarket CLOB Yes/No token price history for binary markets.
2. Local `market_snapshots` rows collected by the snapshot collector.
3. Synthetic fallback from current prices only when both real sources are unavailable.

trading quote/order:

```bash
curl -X POST 'http://localhost:4000/api/trading/quote' \
  -H 'Content-Type: application/json' \
  --data '{"marketId":"540817","side":"yes","action":"buy","amount":25}'

curl -X POST 'http://localhost:4000/api/trading/orders' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: local-order-1' \
  --data '{"marketId":"540817","side":"yes","action":"buy","amount":25}'

curl -X POST 'http://localhost:4000/api/trading/orders' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: local-order-2' \
  --data '{"marketId":"540817","side":"yes","action":"sell","shares":1}'

curl 'http://localhost:4000/api/trading/trades'
```

Local/dev ledger credit and balance:

```bash
# After registering/logging in with a saved session cookie:
curl -X POST 'http://localhost:4000/api/ledger/credits' \
  -b /tmp/mp-cookies.txt \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: local-ledger-credit-1' \
  --data '{"amount":25}'

curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/ledger/balance'
curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/ledger/entries'
```

These ledger endpoints are authenticated local tooling. ledger credit creates a backend ledger
entry; it is not a real deposit, blockchain transfer, wallet event, or USDT payment. Its response
includes `complianceMode: "ledger_restricted"` because compliance gates are advisory for local
tooling and real-money flows are disabled.

Compliance core:

```bash
curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/compliance/me'

curl -X PATCH 'http://localhost:4000/api/compliance/me' \
  -b /tmp/mp-cookies.txt \
  -H 'Content-Type: application/json' \
  --data '{"countryCode":"US","dateOfBirth":"1990-04-28"}'

curl -X POST 'http://localhost:4000/api/compliance/accept-terms' \
  -b /tmp/mp-cookies.txt \
  -H 'Content-Type: application/json' \
  --data '{"termsVersion":"terms-2026.04","privacyVersion":"privacy-2026.04","riskDisclosureVersion":"risk-2026.04"}'

curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/compliance/eligibility'
```

Compliance is local and persists to `user_compliance_profiles` / `user_legal_consents` when
`DATABASE_URL` is enabled; without DB it uses memory only for dev/test. The backend derives age,
country/risk status, and eligibility. `GET /api/compliance/eligibility` returns `canTradeMock`
for mock-trading readiness and keeps `canTradeLocal` as a compatibility alias; frontend cannot
set `kycStatus: approved`. There is no real
KYC provider, document storage, sanctions provider, legal approval, withdrawal, or settlement flow,
and `canUseRealMoney` is always `false`.

Wallets & USDT TRC-20 core:

```bash
curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/wallets/me'

curl -X POST 'http://localhost:4000/api/wallets/deposit-intents' \
  -b /tmp/mp-cookies.txt \
  -H 'Content-Type: application/json' \
  --data '{"expectedAmount":50,"reference":"local-deposit-form"}'

curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/wallets/deposits'

curl -X POST 'http://localhost:4000/api/wallets/withdrawal-requests' \
  -b /tmp/mp-cookies.txt \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: core-withdrawal-1' \
  --data '{"destinationAddress":"TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK","amount":10,"manualReview":true}'

curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/wallets/withdrawal-requests'

curl -X POST 'http://localhost:4000/api/wallets/webhooks/deposits' \
  -H 'Content-Type: application/json' \
  -H 'X-Deposit-Webhook-Secret: change-this-dev-only-local-webhook-secret' \
  --data '{"txHash":"local-tx-1","logIndex":"0","provider":"wallet_provider","recipientAddress":"TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK","amount":10,"asset":"USDT","network":"TRON","confirmations":20}'
```

Wallet responses include `mode: "wallet_review_only"` and a warning. The wallet
runtime uses Postgres when `DATABASE_URL` is enabled and memory fallback otherwise, uses only
`LocalWalletProvider`, validates TRON addresses by basic shape, requires idempotency for withdrawal
requests, rejects reused keys when the normalized asset/network/destination/amount differs from the
original request, and calls compliance eligibility. Because `canUseRealMoney` is always `false`,
withdrawal responses return `realTransferBlocked: true` and `TRANSFERS_UNAVAILABLE`.

`POST /api/wallets/webhooks/deposits` is the deposit core webhook. It requires
`WALLET_DEPOSIT_WEBHOOK_SECRET` on the API and the matching `X-Deposit-Webhook-Secret` request header;
without that secret the endpoint returns `MOCK_WEBHOOK_SECRET_REQUIRED` before recording anything.
It accepts only USDT/TRON, validates the recipient wallet, saves `wallet_deposit_events`, rejects
non-positive amounts/unsupported rails/unknown wallets, waits for
`WALLET_DEPOSIT_MIN_CONFIRMATIONS`, and credits ledger once with idempotency key
`deposit:${txHash}:${logIndex}`. The payload must include an explicit `logIndex` or unique provider
event id (`eventId`/`providerEventId`); a `txHash` without an event key returns
`INVALID_WEBHOOK_EVENT` instead of sharing a fallback log index. Replayed webhooks do not
double-credit balances. A replay with the same `txHash + logIndex` but a different normalized event
fingerprint returns HTTP 409 `DEPOSIT_EVENT_FINGERPRINT_MISMATCH`, moves the event to
`manual_review`, skips ledger credit, and writes `wallet.deposit_rejected`. If compliance/user state
is blocked, the event is saved but ledger credit is skipped. Canonical deposit fingerprints use the
runtime SHA-256 stable algorithm; legacy md5 fingerprints backfilled by migration `008` are accepted
for harmless replays only when the stored event normalized by the current algorithm still matches
the incoming webhook. Responses and `GET /api/wallets/deposits` do not expose raw provider
payloads.

No private keys, seeds, mnemonics, TronGrid/TronWeb network calls, wallet signing, withdrawals,
settlement, or outbound transfers are implemented.

Admin core:

```bash
# Give a local/dev user super_admin role in memory/core mode:
ADMIN_EMAILS=admin@example.com

curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/admin/users'
curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/admin/audit-logs'
curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/admin/wallet-withdrawals'

curl -X POST 'http://localhost:4000/api/admin/wallet-withdrawals/withdrawal-id/reject' \
  -b /tmp/mp-cookies.txt

curl -X POST 'http://localhost:4000/api/admin/markets/540817/hide' \
  -b /tmp/mp-cookies.txt \
  -H 'Content-Type: application/json' \
  --data '{"reason":"manual_review"}'

curl -X POST 'http://localhost:4000/api/admin/markets/540817/unhide' \
  -b /tmp/mp-cookies.txt
```

Admin endpoints require authenticated admin roles. Ordinary authenticated users receive 403.
`ADMIN_EMAILS` is a legacy super-admin allowlist. Prefer `SUPER_ADMIN_EMAILS`,
`SUPPORT_EMAILS`, `COMPLIANCE_ADMIN_EMAILS`, and `FINANCE_ADMIN_EMAILS` for role-specific local/dev
assignment. Support can read users/audit, finance can review wallet withdrawals, compliance can
hide/unhide markets, and super admin can use all admin actions.
Withdrawal review is local and returns `realTransferBlocked: true` and
`mode: "wallet_review_only"`; it never performs real approvals, real withdrawals,
wallet, broadcast, settlement, or ledger debit.

Auth:

```bash
curl -i -X POST 'http://localhost:4000/api/auth/register' \
  -H 'Content-Type: application/json' \
  --data '{"email":"local@example.com","password":"password123","displayName":"Local Trader"}'
```

Browser clients should call `GET /api/auth/csrf` first for state-changing requests. The web API
helper does this automatically and sends `X-CSRF-Token`; the backend validates that header against
the signed `mp_csrf` cookie when `CSRF_PROTECTION_ENABLED=true`.

Auth/session env:

```txt
APP_MODE=local
SESSION_SECRET=change-this-long-random-session-secret
SESSION_COOKIE_SECURE=false
CORS_ALLOWED_ORIGINS=http://localhost:5173
POLYMARKET_GAMMA_URL=https://gamma-api.polymarket.com
POLYMARKET_CLOB_URL=https://clob.polymarket.com
CSRF_PROTECTION_ENABLED=true
CSRF_COOKIE_NAME=mp_csrf
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=20
AUTH_RATE_LIMIT_BACKEND=memory
REDIS_URL=redis://default:password@localhost:6379
ADMIN_EMAILS=admin@example.com
SUPER_ADMIN_EMAILS=owner@example.com
SUPPORT_EMAILS=support@example.com
COMPLIANCE_ADMIN_EMAILS=compliance@example.com
FINANCE_ADMIN_EMAILS=finance@example.com
WALLET_DEPOSIT_WEBHOOK_SECRET=change-this-dev-only-local-webhook-secret
WALLET_DEPOSIT_MIN_CONFIRMATIONS=20
DATABASE_URL=postgres://user:password@localhost:5432/market_pulse
DATABASE_SSL=false
TEST_DATABASE_URL=postgres://user:password@localhost:5432/market_pulse_test
```

Local env is loaded automatically from `.env` through `dotenv`.

Production guardrails are intentionally strict: `APP_MODE` must remain `local`,
`SESSION_SECRET` and `WALLET_DEPOSIT_WEBHOOK_SECRET` must be non-placeholder values,
`SESSION_COOKIE_SECURE=true`, `CORS_ALLOWED_ORIGINS` must be an explicit allowlist,
`DATABASE_URL` is required, and `AUTH_RATE_LIMIT_BACKEND=memory` is rejected in production. Use
`AUTH_RATE_LIMIT_BACKEND=redis` with `REDIS_URL` for backend-enforced Redis limits, or
`AUTH_RATE_LIMIT_BACKEND=external` only when an edge/proxy/managed limiter is enforced outside the
process. This still does not make the app real-money ready.

Database migrations:

```bash
npm run db:migrate
```

If `DATABASE_URL` is not set, the API still starts in dev/test with DB disabled. Do not commit real
database credentials; keep them in local env or a secrets manager.

The trade, position, compliance, watchlist, ledger, and wallet core tables are local product
foundation. Runtime uses Postgres when `DATABASE_URL` is enabled and memory fallback only for
dev/test without DB. Authenticated portfolio/trading writes persist ledger entries, trades, and
positions through repositories, and `POST /api/portfolio/reset` clears persistent positions/trades
for that user before resetting the local ledger balance. `002_ledger_core.sql` tightens
`ledger_entries`, and the ledger service protects idempotency by comparing normalized entry fields
plus stable metadata before replaying a same-key request. `003_compliance_core.sql` adds compliance
profiles and
legal consents, and `004_wallets_usdt_core.sql` adds wallet deposit intents, withdrawal
requests, and local provider events. `005_wallet_withdrawal_idempotency_fingerprint.sql` adds a
withdrawal request fingerprint for safer idempotency-key reuse checks.
`006_admin_core.sql` prepares user roles, `approved_for_review` withdrawal status, and
admin market visibility rules. `007_wallet_deposit_events.sql` adds deposit event persistence and
`tx_hash + log_index` idempotency. `008_wallet_deposit_event_fingerprint.sql` adds deposit event
fingerprints and `manual_review` for mismatch conflicts; runtime keeps compatibility with its md5
backfill values by checking them against the current SHA-256 stable fingerprint algorithm before
accepting replays.
`009_wallet_deposit_event_amount_check.sql` adds a DB-level
`wallet_deposit_events.amount > 0` check for deposit events. Withdrawals, USDT wallet, private-key
storage, settlement, provider
reconciliation, TronGrid/TronWeb network calls, and outbound transfers are still disabled.

DB auth smoke check:

```bash
npm run db:migrate
npm run dev:api
curl http://127.0.0.1:4000/health
```

Expected health includes `"database":"enabled"` when `DATABASE_URL` is valid.

## Check

```bash
npm run check
npm test
npm run test:web
```

CI runs the core gates as separate steps: backend typecheck, web typecheck, backend tests,
frontend tests, and web build.

Optional Postgres core integration tests:

```bash
TEST_DATABASE_URL=postgres://user:password@localhost:5432/market_pulse_test npm test -- src/postgresCore.test.ts
```

## Next steps

1. Replace the local in-memory market cache with Redis.
2. Expand Postgres/Supabase migrations with translations and production-reviewed constraints for
   markets, outcomes, categories, visibility rules, and market snapshots.
3. Add transaction-level composition for trade ledger mutation plus position/trade persistence, so
   the whole local order commit is atomic across repositories.
4. Add production migration workflow, backups, monitoring, and rollback strategy.
5. Expand the market snapshot collector into a production worker fleet and use snapshots for PnL
   history and trending logic.
6. Build Arabic RTL localization, translation storage, and admin moderation workflows.
7. Add frontend component/E2E tests for market filters, detail, local trade, and portfolio flows.
8. Provision production Redis or edge/proxy rate-limit infrastructure and set
   `AUTH_RATE_LIMIT_BACKEND` accordingly.
9. Add real-money quote/trade/settlement services, fees, slippage warnings, and production ledger
   entries after compliance/security review.
10. Integrate real KYC/AML, sanctions, legal review, and admin/manual-review workflows before any
   real-money rollout.
11. Add provider reconciliation, monitoring, secure provider webhook verification, and manual
   review workflows before production deposit rollout.
12. Persist admin moderation repositories in Postgres, then add USDT TRC-20 withdrawals only after
   legal, KYC, AML, wallet, webhook verification, admin review, and production ledger decisions
   are complete.
13. Add monitoring/alerting around `/api/ready`, DB connectivity, webhook mismatch/manual-review
   counts, and audit log volume before production traffic.
