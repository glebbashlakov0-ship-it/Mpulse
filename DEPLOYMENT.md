# Deployment

This project is ready to deploy to Vercel as a Vite SPA plus a Node.js serverless API.

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
WALLET_DEPOSIT_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret
APP_BASE_URL=https://your-domain.vercel.app
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

## Local Verification

Run these before deploying:

```bash
npm run check
npm run build
npm run build:web
```
