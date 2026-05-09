# Market Pulse Project Memory

This file is a short handoff note for developers and AI assistants. The broader product plan lives
in [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md), security rules live in
[docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md), and operations notes live in
[docs/RUNBOOK.md](docs/RUNBOOK.md).

## Product

Market Pulse is an Arabic-first prediction market interface inspired by Polymarket. The app serves
normalized public market data, account flows, portfolio screens, trading APIs, wallet records,
ledger balances, compliance checks, and admin review tools.

Real payment and withdrawal availability depends on product, legal, compliance, and infrastructure
approval. User-facing copy should stay clear and product-oriented.

## Stack

- Backend: Node.js, TypeScript, Fastify.
- Frontend: React, Vite, TypeScript, Tailwind CSS.
- Market data source: Polymarket Gamma API.
- Database: Postgres/Supabase through `DATABASE_URL`; memory repositories are used when the DB is
  disabled.
- Cache: backend in-memory cache today; Redis is the likely next production cache.
- Payment rail currently modeled in the product: USDT on TRON/TRC-20.

## Current Features

- Public market/event proxy API over Polymarket Gamma.
- Normalized market list/detail APIs with filtering, search, sorting, pagination, stale-cache
  fallback, controlled upstream errors, and source metadata.
- Category/topic catalog through `GET /api/categories`.
- Stable market images using upstream media first and deterministic curated category fallbacks.
- Market detail pages with outcomes, prices, volume/liquidity, dates, rules, related markets, and
  chart data.
- Frontend discovery filters are synced with URL query params.
- Account auth with email/password, HttpOnly SameSite sessions, profile settings, email
  verification, password reset, two-factor setup/status, and rate limiting.
- Portfolio and trading APIs with quotes, orders, positions, trades, idempotency, and audit events.
- Production Data Layer guardrails: production startup fails fast without `DATABASE_URL`, and DB
  mode requires auth for stateful portfolio/trading routes instead of falling back to guest memory
  state.
- Authenticated portfolio/trading state persists to Postgres repositories when `DATABASE_URL` is
  enabled: ledger entries, trades, positions, and user-scoped history survive API restart after
  migrations are applied. Dev/test without DB still uses memory fallback.
- Ledger service with immutable entries, derived balances, idempotency protection, and Postgres
  repository support.
- Wallet APIs for user wallet, deposit instructions, deposit events, withdrawal requests, and
  deposit webhook ingestion.
- Compliance APIs for profile, terms acceptance, and trading eligibility; eligibility exposes
  backend-derived `canTradeMock` and keeps `canTradeLocal` as a compatibility alias.
- Compliance profile and legal consent runtime uses Postgres when `DATABASE_URL` is enabled;
  memory fallback is dev/test only.
- Watchlist APIs persist account watchlists to `user_watchlist` when `DATABASE_URL` is enabled;
  frontend header count and `/watchlist` load through the API for authenticated users.
- Admin APIs for user summaries, audit logs, withdrawal review, market visibility controls, and
  role-gated access.
- CI covers backend typecheck, frontend typecheck, backend tests, frontend tests, and web build.

## API Map

Market data:

- `GET /health`
- `GET /api/health`
- `GET /api/ready`
- `GET /api/events`
- `GET /api/events/:id`
- `GET /api/markets`
- `GET /api/markets/:id`
- `GET /api/categories`
- `GET /api/market-snapshots/schema`
- `GET /api/tags`
- `GET /api/search`

Trading and portfolio:

- `POST /api/trading/quote`
- `POST /api/trading/orders`
- `GET /api/trading/positions`
- `GET /api/trading/trades`
- `POST /api/portfolio/reset`

Ledger:

- `GET /api/ledger/balance`
- `GET /api/ledger/entries`
- `POST /api/ledger/credits`

Wallet:

- `GET /api/wallets/me`
- `POST /api/wallets/deposit-intents`
- `GET /api/wallets/deposits`
- `POST /api/wallets/withdrawal-requests`
- `GET /api/wallets/withdrawal-requests`
- `POST /api/wallets/webhooks/deposits`

Compliance:

- `GET /api/compliance/me`
- `PATCH /api/compliance/me`
- `POST /api/compliance/accept-terms`
- `GET /api/compliance/eligibility`

Auth and account security:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:id`
- `POST /api/auth/sessions/revoke-others`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/auth/two-factor/status`
- `POST /api/auth/two-factor/setup`
- `POST /api/auth/two-factor/confirm`
- `POST /api/auth/two-factor/disable`

Admin:

- `GET /api/admin/users`
- `GET /api/admin/audit-logs`
- `GET /api/admin/withdrawal-requests`
- `POST /api/admin/withdrawal-requests/:id/reject`
- `GET /api/admin/hidden-markets`
- `POST /api/admin/hidden-markets`
- `DELETE /api/admin/hidden-markets/:id`

## Config

Important environment variables:

- `DATABASE_URL`
- `DATABASE_SSL`
- `HOST`
- `PORT`
- `APP_MODE=local`
- `SESSION_SECRET`
- `SESSION_COOKIE_NAME`
- `SESSION_COOKIE_SECURE`
- `SESSION_TTL_MS`
- `CORS_ALLOWED_ORIGINS`
- `WALLET_DEPOSIT_WEBHOOK_SECRET`
- `WALLET_DEPOSIT_MIN_CONFIRMATIONS`
- `ADMIN_EMAILS`

## Database

Migration files currently expected by `src/migrate.ts`:

- `001_initial_schema.sql`
- `002_ledger_core.sql`
- `003_compliance_core.sql`
- `004_wallets_usdt_core.sql`
- `005_wallet_withdrawal_idempotency_fingerprint.sql`
- `006_admin_core.sql`
- `007_wallet_deposit_events.sql`
- `008_wallet_deposit_event_fingerprint.sql`
- `009_wallet_deposit_event_amount_check.sql`
- `010_auth_verification_tokens.sql`
- `011_account_security_and_watchlist.sql`

Run migrations with `npm run db:migrate` when `DATABASE_URL` is set.

## Useful Commands

- `npm run typecheck`
- `npm run typecheck:web`
- `npm run test`
- `npm run test:web`
- `npm run build:web`
- `npm run check`

## Notes For Future Work

- Keep backend-owned filters, trading state, wallet state, ledger state, and admin review behavior
  behind typed API helpers.
- Keep user-facing copy concise and product-oriented.
- Avoid exposing raw upstream objects or internal provider payloads to the frontend.
- Preserve idempotency keys for trading orders, ledger credits, deposit ingestion, and withdrawal
  requests.
- Keep secrets out of git and never surface them through health/readiness responses.
