# Deployment

The application packages as a Vite SPA plus a Node.js serverless API. The Coin cutover in this
branch is **not approved for production deployment or real-money launch**: there is no production
balance-migration workflow, deposit crediting is disabled, trading/settlement are production-gated,
and no Fireblocks broadcast route exists.

## Vercel Settings

- Framework preset: Vite
- Build command: `npm run vercel-build`
- Output directory: `dist-web`
- API runtime: Vercel Node.js functions from `api/[...path].ts`

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
REAL_MONEY_DEPOSIT_PROVIDER=
EXCHANGE_RATE_PROVIDER=disabled
COINS_MIGRATION_APPLY=false
```

Optional production email settings:

```dotenv
RESEND_API_KEY=replace-with-resend-api-key
EMAIL_FROM_ADDRESS=Pulse Market <noreply@your-domain.com>
```

## Routing

- `/api/*` is served by the serverless Fastify handler.
- `/health` is rewritten to `/api/health`.
- All other paths fall back to `dist-web/index.html` for the React SPA.

## Startup Diagnostics

Production guardrails stay enabled. If a required environment variable is missing or malformed,
the API function does not start the app and returns `STARTUP_CONFIGURATION_ERROR` with the missing
variable names. Function logs include the original startup error without printing secret values.
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
