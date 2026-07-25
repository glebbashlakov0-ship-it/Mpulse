# Deployment

The application packages as a Vite SPA plus a Node.js serverless API. Real-money launch remains
**not approved**. The separately authorized Coin balance cutover uses a guarded post-deploy
workflow that defaults disabled, and no Fireblocks broadcast route exists. Supported Coin
functions are separately production-gated and default fail-closed.

## Vercel Settings

- Framework preset: Vite
- Build command: `npm run vercel-build`
- Output directory: `dist-web`
- API runtime: Vercel Node.js function rooted at `src/server.ts`

## Required Environment Variables

Add these manually in the Vercel dashboard. Do not commit real secret values.

```dotenv
APP_MODE=local
NODE_ENV=production
DATABASE_URL=postgres://user:password@host:5432/database
DATABASE_SSL=true
SESSION_SECRET=replace-with-a-long-random-production-secret
SESSION_COOKIE_SECURE=true
CORS_ALLOWED_ORIGINS=https://your-domain.vercel.app
APP_BASE_URL=https://your-domain.vercel.app
LEDGER_CREDIT_API_ENABLED=false
WALLET_DEPOSIT_WEBHOOK_ENABLED=false
ADMIN_MANUAL_DEPOSIT_APPROVAL_ENABLED=false
COIN_DEPOSIT_CREDITS_ENABLED=false
COIN_WITHDRAWAL_REQUESTS_ENABLED=false
COIN_INTERNAL_TRADING_ENABLED=false
PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=false
REAL_MONEY_DEPOSIT_PROVIDER=
EXCHANGE_RATE_PROVIDER=disabled
COINS_MIGRATION_APPLY=false
```

Without Fireblocks or CLOB, the only supported opt-ins are:

```dotenv
COIN_WITHDRAWAL_REQUESTS_ENABLED=true
COIN_INTERNAL_TRADING_ENABLED=true
EXCHANGE_RATE_PROVIDER=coinbase
```

This enables rate-backed withdrawal quotes, Coin reserve/cancel/reject in `review-only` state, and
internal simulated Coin-ledger trading. It does not broadcast a withdrawal, submit a CLOB order, or
enable any outbound custody/execution provider call. Keep `COIN_DEPOSIT_CREDITS_ENABLED=false`;
the current rejected launch artifact makes `true` a startup error even when every signed
Fireblocks, rate, and contract prerequisite is configured. There is no environment override for
that decision.

Optional production email settings:

```dotenv
RESEND_API_KEY=replace-with-resend-api-key
EMAIL_FROM_ADDRESS=Pulse Market <noreply@your-domain.com>
```

## Routing

- `/api/*` is served by the serverless Fastify handler.
- `/api/ops/production-coin-cutover/identity` and `/api/ops/production-coin-cutover` are
  authenticated ops routes registered in the single Vercel Fastify function. They remain
  unavailable while
  `PRODUCTION_COIN_CUTOVER_ENDPOINT_ENABLED=false`.
- `/health` is rewritten to `/api/health`.
- All other paths fall back to `dist-web/index.html` for the React SPA.

## Startup Diagnostics

Production guardrails stay enabled. If a required environment variable is missing or malformed,
`npm run runtime:preflight` fails the Vercel build before compilation and without connecting to the
database. The API function also fails startup and returns `STARTUP_CONFIGURATION_ERROR` with the
missing variable names. Function logs include the original startup error without printing secret
values.
Schema migration `031` alone leaves the Coin fence in `legacy`; do not manually flip it and do not
use the test-only migration CLI on a production database.

## Local Verification

Run these before deploying:

```bash
npm run check
npm run build
npm run build:web
```

A green build is merge evidence only. It is not authorization to deploy this cutover, migrate a
production balance, credit a deposit, execute a real trade, settle funded collateral, or broadcast
a withdrawal.
