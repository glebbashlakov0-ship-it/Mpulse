# Pulse Market Runbook

Pulse Market is still `local`: no real money, real withdrawals, wallet signing, private
keys, settlement, or real trading.

## Local Startup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and keep `APP_MODE=local`.

3. Start the API and web app:

```bash
npm run dev:api
npm run dev:web
```

API default: `http://localhost:4000`

Web default: `http://localhost:5173`

## Database And Migrations

Set `DATABASE_URL` before running migrations:

```bash
npm run db:migrate
```

For optional Postgres core tests, use a separate test database:

```bash
TEST_DATABASE_URL=postgres://user:password@localhost:5432/market_pulse_test npm test -- src/postgresCore.test.ts
```

## Required Checks

Run the full local gate before merging:

```bash
npm run check
```

CI runs the same core gates as separate steps: backend typecheck, web typecheck, backend
tests, frontend tests, and web build.

## API Smoke Checks

```bash
curl 'http://localhost:4000/api/health'
curl 'http://localhost:4000/api/ready'
curl 'http://localhost:4000/api/markets?limit=5&active=true&closed=false'
curl 'http://localhost:4000/api/markets?search=bitcoin&category=crypto&sort=relevance&limit=5'
```

`/api/health` should return HTTP 200 with non-secret service status. `/api/ready` returns HTTP 503
until `DATABASE_URL`, the DB connection, market data layer, webhook secret, and production guardrails
are ready.

## Auth And Security Operations

Browser clients should fetch a CSRF token before unsafe requests:

```bash
curl -c /tmp/mp-cookies.txt 'http://localhost:4000/api/auth/csrf'
```

The response returns `data.csrfToken` and sets the `mp_csrf` cookie. Send that value in
`X-CSRF-Token` for `POST`, `PUT`, `PATCH`, and `DELETE` when `CSRF_PROTECTION_ENABLED=true`.
The web client helper handles this automatically.

Use role-specific local/dev allowlists instead of one shared admin list:

```txt
SUPER_ADMIN_EMAILS=owner@example.com
SUPPORT_EMAILS=support@example.com
COMPLIANCE_ADMIN_EMAILS=compliance@example.com
FINANCE_ADMIN_EMAILS=finance@example.com
```

`ADMIN_EMAILS` still works as a legacy super-admin allowlist. Production must not use the
in-process memory auth limiter. Set `AUTH_RATE_LIMIT_BACKEND=redis` with `REDIS_URL` for
backend-enforced Redis limits, or `AUTH_RATE_LIMIT_BACKEND=external` only when an edge/proxy/
managed limiter is enforced outside this process.

## Market Data Operations

All Polymarket traffic must stay server-side. Frontend calls should use `GET /api/markets`,
`GET /api/markets/:id`, `GET /api/categories`, or `GET /api/search`.

Market API responses include source metadata:

- `lastSyncedAt`
- `isStale`
- `sourceStatus`: `fresh`, `cache`, `stale`, `fallback`, or `unavailable`
- `warnings`

If Polymarket is temporarily unavailable and cache exists, the API should return stale data with
`sourceStatus: "stale"` and a warning. If no stale cache exists, detail requests return controlled
`UPSTREAM_UNAVAILABLE`; invalid filters return `INVALID_QUERY`. Malformed numeric market list
params such as `limit=abc`, `offset=abc`, `min_volume=abc`, or `max_volume=abc` must stay rejected
instead of silently falling back.

Stable categories/topics are Politics, Sports, Crypto, Tech, Finance, Geopolitics, Culture,
Economy, Weather, Elections, and Other. `GET /api/markets?topic=all` is a no-op; other topic
values are normalized and matched against `market.topics` or `market.category`.

Market detail history first reads persisted `market_snapshots` from the market repository/Postgres.
If no real snapshots exist, the API still returns a synthetic fallback with `history.is_synthetic:
true`; the frontend must treat that as a placeholder, not a live chart. Local/dev can collect one
snapshot manually with `POST /api/markets/:id/snapshots/collect` using a valid CSRF token. Periodic
collection is controlled by `MARKET_SNAPSHOT_COLLECTOR_ENABLED`,
`MARKET_SNAPSHOT_COLLECTOR_INTERVAL_MS`, and `MARKET_SNAPSHOT_COLLECTOR_MARKET_IDS`.

## Webhook Mismatch Or Manual Review

If `POST /api/wallets/webhooks/deposits` returns `DEPOSIT_EVENT_FINGERPRINT_MISMATCH` or a deposit event
enters `manual_review`:

1. Do not retry with modified payloads to force credit.
2. Check admin audit logs for `wallet.deposit_rejected`.
3. Compare `txHash`, `logIndex`, recipient, asset/network, amount, confirmations, and provider
   payload against the original provider event.
4. Keep ledger credit blocked unless a separate reviewed reconciliation workflow is implemented.

Blocked compliance deposits can be saved as confirmed but must not credit ledger.

## Audit Logs

Use an admin session:

```bash
curl -b /tmp/mp-cookies.txt 'http://localhost:4000/api/admin/audit-logs'
```

Important event types include `auth.*`, `trading.*`, `ledger.ledger_credit`, `ledger.rejected`,
`wallet.deposit_*`, `wallet.rejected`, and `admin.*`. Auth security events cover email
verification, password reset, session revocation, logout-all-devices, 2FA setup/enabled/disabled,
and backup-code regeneration.

## Production Follow-Ups

- Add monitoring/alerting for `/api/ready`, DB connectivity, webhook mismatch/manual-review counts,
  and audit log volume.
- Add deployment, backup/restore, rollback, and incident runbooks.
- Provision production Redis or edge/proxy rate-limit infrastructure and verify login/register
  throttling before production traffic.
- Keep real withdrawals, private keys, wallet signing, settlement, and real trading out until a
  separate legal/security/finance decision is made.
