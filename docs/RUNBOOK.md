# Market Pulse Runbook

Market Pulse is still `local`: no real money, real withdrawals, wallet signing, private
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
values are normalized and matched against `market.topics` or `market.category`. Detail history
currently includes synthetic fallback chart points when durable `market_snapshots` are empty;
production should replace this with a snapshot worker and persisted history.

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
`wallet.deposit_*`, `wallet.rejected`, and `admin.*`.

## Production Follow-Ups

- Add monitoring/alerting for `/api/ready`, DB connectivity, webhook mismatch/manual-review counts,
  and audit log volume.
- Add deployment, backup/restore, rollback, and incident runbooks.
- Replace in-memory rate limits with Redis, edge, or reverse-proxy limits.
- Keep real withdrawals, private keys, wallet signing, settlement, and real trading out until a
  separate legal/security/finance decision is made.
