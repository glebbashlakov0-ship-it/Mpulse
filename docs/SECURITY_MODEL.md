# Security Model

## Core Decision

The frontend is not trusted. It can be changed by users, inspected, replayed, or called directly.
Any value coming from the browser is treated as a request, not as truth.
Market chart history is also fetched server-side: the frontend must read normalized
`/api/markets/:id` responses, not call Polymarket Gamma or CLOB directly.

## What Belongs On The Backend

- balance calculations;
- position updates;
- trade execution;
- price validation;
- public market data and chart-history normalization;
- order limits;
- wallet state;
- deposit and withdrawal state;
- user permissions;
- market settlement rules;
- audit logs;
- compliance checks.

## What May Stay On The Frontend

- current page;
- selected tab;
- selected market card;
- search query;
- amount input before submission;
- loading/error UI;
- display formatting;
- display-only previews, as long as the backend recomputes anything that changes state.

## Current local status

Real funds are not supported. Auth and non-money local features may still use their documented
development fallbacks, but every authenticated balance, ledger, wallet, portfolio, trade, and
settlement route is PostgreSQL-only after the Coin cutover. A missing database or incomplete
cutover fails closed; money state never falls back to memory or the legacy ledger.

- `coin_ledger_entries` is the immutable source of truth. Cached available/reserved balances in
  `coin_accounts` can change only through the guarded `coin_post_ledger_entry` database function.
  Negative balances, direct edits, payload-mismatched idempotency replays, and legacy money writes
  are rejected.
- Coin and USDT authoritative values use PostgreSQL `BIGINT` / TypeScript `bigint`. JSON money
  integers are decimal strings; the browser cannot submit a replacement balance or an authoritative
  binary floating-point amount.
- Compliance profile data remains self-declared local data. The frontend cannot approve KYC, AML,
  sanctions, region eligibility, or real-money use, and `canUseRealMoney` remains false.
- The only reachable provider integration is inbound Fireblocks V2 deposit notification
  verification and review-evidence ingestion. The server verifies the detached
  `Fireblocks-Webhook-Signature` over the exact raw body with RS512 and an official region-specific
  JWKS, then persists and validates event and chain-transfer identity, USDT/TRON contract,
  destination ownership, state, amount, and confirmations.
- Provider-event ID and chain-transfer coordinates are independently idempotent. Conflicting
  evidence is persisted for `manual_review`; it cannot overwrite a credited/reversing/reversed
  financial state or create a second credit.
- The server constructs the wallet owner with `allowDepositCredits: false`. Even a valid,
  sufficiently confirmed event becomes `manual_review` with
  `REAL_MONEY_LAUNCH_NOT_APPROVED`; no rate snapshot or Coin credit is created.
- Withdrawal quotes snapshot the indicative rate and fees. Confirming a quote atomically reserves
  Coins. User cancellation, admin rejection, or a conclusively verified provider failure releases
  the exact reserve; unknown provider state keeps it locked. Admin approval is
  `approved_for_review` only.
- No public/admin route calls Fireblocks to broadcast a withdrawal. The codebase contains no
  Fireblocks private key, source vault ID, signing key, or live provider credential.
- Trade reserve, fill finalization, fees, positions, and safe settlement refunds commit atomically
  with Coin ledger movements. Provider execution is not reachable in this cutover; winner payouts
  fail closed while external CLOB funding is unverified, and settlement remains review-only.
- Finance admins can inspect money state, retry only safe review states, and post idempotent
  compensating corrections with an actor, reason, and source. Direct balance edits and legacy
  manual deposit credits are retired.
- The checked cutover CLI accepts only an isolated `TEST_DATABASE_URL`. It cannot be used as a
  production migration or launch approval mechanism.

The full units, endpoint contract, lifecycle, fence, reconciliation, and cutover details are in
[`coins-architecture.md`](coins-architecture.md). The binding launch decision is
[`real-money-launch-approval.md`](real-money-launch-approval.md).

The auth local uses hashed passwords, HttpOnly SameSite cookie sessions, CSRF protection for
state-changing browser requests, and rate limits for register/login/settings endpoints. Session
tokens must not be stored in localStorage or exposed to frontend JavaScript.

Account-security endpoints currently include email verification, password reset, session/device
listing, individual session revoke, logout-all-other-sessions, logout-all-devices, and
2FA setup/confirm/disable.
2FA setup returns an authenticator QR data URL, the raw otpauth URL, and one-time backup codes.
Backup codes can be regenerated only after a valid TOTP or existing backup code is provided.
Important events are recorded through the audit service, including login, logout, password reset,
email verification, session revocation, logout-all-devices, 2FA setup/enabled/disabled,
backup-code regeneration, settings changes, and admin actions.

CSRF uses a signed double-submit token. `GET /api/auth/csrf` sets the readable CSRF cookie and
returns the token; frontend unsafe requests send `X-CSRF-Token`. The backend rejects invalid or
missing CSRF tokens with `CSRF_TOKEN_INVALID` when `CSRF_PROTECTION_ENABLED=true`. Tests disable
CSRF by default through test config unless a test opts in.

The production readiness core adds explicit config guardrails without enabling real money:
`APP_MODE` must remain `local`; production startup rejects placeholder session secrets,
`SESSION_COOKIE_SECURE=false`, missing `DATABASE_URL`, and empty/wildcard
`CORS_ALLOWED_ORIGINS`. `buildApp` also fails fast if an explicit production config omits
`DATABASE_URL`, so critical runtime state cannot silently choose memory fallback. `GET /api/health`
is a non-secret liveness check. `GET /api/ready` checks
database availability, the backend market data layer, and critical config flags without returning
secret values. A failing readiness check must be treated as not deployable/servable.

The in-memory auth rate limit is local-only. Production config rejects
`AUTH_RATE_LIMIT_BACKEND=memory`; use `AUTH_RATE_LIMIT_BACKEND=redis` with `REDIS_URL` for
backend-enforced Redis limits, or `AUTH_RATE_LIMIT_BACKEND=external` only when edge/reverse-proxy
rate limits are enforced outside this process.

The checked migration plan is intentionally sparse: migrations `001` through `016`, then
`031_coins_ledger_cutover.sql`. Migration `031` adds the Coin accounts, immutable ledger, rate
snapshots, provider evidence, withdrawal/trading/settlement state, database fences, outbox, cutover
runs, and reconciliation surfaces. It is structural and never copies balances automatically.
The separate test-only CLI performs a dry-run/apply/no-op/reconciliation rehearsal against a
dedicated disposable database. None of those steps enables provider broadcast or production money.

DB-backed auth has been smoke-tested against Supabase for register, login, me, logout, session
cookie handling, and auth audit rows. Logout records its audit event before deleting the session row
so the audit log can keep a valid `session_id` reference. Trading quote/order/rejected events also
go through the audit service and write to `audit_logs` when DB is enabled.

The mobile header now exposes auth navigation through a menu, so Log In, Sign Up, Portfolio, and
Profile are available on small screens. This is navigation only; authorization decisions still
belong to the backend.

## Before Broader Real Money

Do not enable production deposit credits, USDT withdrawals, or real-money trading until these
exist:

- authenticated users;
- legal/security-reviewed wallet, deposit, withdrawal, and wallet operating model on top of the
  database-backed core;
- a reviewed production-specific cutover workflow, backup/restore rehearsal, observation window,
  abort criteria, and forward recovery;
- named legal, security, finance, and operations approval;
- reviewed Fireblocks custody, key, vault, policy, limit, allowlist, broadcast, and reconciliation
  ownership;
- production KYC/AML/sanctions/region decisions and incident ownership;
- authoritative venue order/fill receipts and proof/reconciliation of funded collateral;
- downstream outbox handlers, dead-letter alerting, replay controls, and operational ownership;
- rate limits;
- request validation schemas;
- audit logs;
- compliance profile/consent persistence with real KYC/AML/sanctions provider decisions;
- persistent users and sessions;
- production email delivery hardening, password recovery operations, 2FA recovery policy, roles,
  and permissions review;
- device/session management review;
- admin separation;
- secret management;
- monitoring and alerting;
- readiness monitoring and alerting for `/api/ready`, DB connectivity, webhook mismatch/manual
  review counts, and audit log volume;
- legal/KYC/AML/sanctions review.

Never add real TRON private-key generation, seed/mnemonic storage, wallet signing, or withdrawal
broadcasting inside the application without a separately reviewed custody design and explicit
launch approval.

## Frontend Rule For Developers

If a frontend value affects money, shares, position ownership, or permissions, it must be recomputed
or verified by the backend before it changes state.

Frontend calculations are allowed only for presentation and previews. They must never be accepted as
the final value for balances, positions, trades, settlement, deposits, withdrawals, or permissions.
The current trading ticket may display estimated shares, available shares, or disabled states, but
the backend recalculates and validates every quote/order before state changes.

The Coin UI/API rule is the same: the frontend may request a quote, order, withdrawal, or
admin-authorized correction, but it must never submit a replacement balance. The database appends
validated ledger entries and derives balances.
