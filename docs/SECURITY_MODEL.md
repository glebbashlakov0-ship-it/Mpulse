# Security Model

## Core Decision

The frontend is not trusted. It can be changed by users, inspected, replayed, or called directly.
Any value coming from the browser is treated as a request, not as truth.

## What Belongs On The Backend

- balance calculations;
- position updates;
- trade execution;
- price validation;
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

## Current local Status

Real funds are not supported. The current backend can run with Postgres/Supabase when
`DATABASE_URL` is set, and falls back to memory repositories when DB is disabled. Auth
users/sessions/settings, audit, ledger, and wallet core state can use Postgres, but local
trading remains local infrastructure:

- quote/order endpoints (`/api/trading/quote`, `/api/trading/orders`) calculate local price,
  shares, cost/proceeds, position updates, and PnL on the backend;
- local orders require the normalized market to be active/live and not closed/archived, with a
  usable price; upstream `restricted` and `accepting_orders` flags are not used as local blockers
  because no real Polymarket order or funds move;
- local buy/sell supports partial position reduction and idempotency keys through
  `Idempotency-Key` or `idempotencyKey`;
- local portfolio, positions, trades, and idempotency memory reset on API restart only in dev/test
  without DB. When `DATABASE_URL` is enabled, authenticated portfolio/trading state uses
  Postgres-backed ledger entries, trades, and positions. DB mode requires auth for stateful
  portfolio/trading routes instead of falling back to guest memory state;
- users and sessions reset on API restart when DB is disabled;
- session tokens are stored only as hashes in the DB, never as raw tokens;
- position, trade, comments, and market visibility tables are schema local and are not
  real-money flows;
- a backend-only ledger service now exists for local finance core with memory fallback and
  Postgres persistence when `DATABASE_URL` is enabled. It derives balances from immutable entries,
  rejects negative/zero amounts, requires user-scoped idempotency keys for writes, rejects
  same-key ledger payload mismatches with `IDEMPOTENCY_KEY_REUSE_MISMATCH`, rejects insufficient
  debit/hold/release-like operations, and exposes authenticated local endpoints at
  `/api/ledger/balance`, `/api/ledger/entries`, and `/api/ledger/credits`;
- Postgres ledger writes run inside a DB transaction and take a user-scoped advisory lock before
  idempotency lookup, normalized payload comparison, balance calculation, insufficient-balance
  checks, and entry insertion;
- `/api/ledger/credits` is a command to create a ledger credit entry. It is not a deposit
  endpoint, not a blockchain webhook, not wallet, and not proof of external funds;
- compliance core endpoints now exist at `/api/compliance/me`,
  `/api/compliance/accept-terms`, and `/api/compliance/eligibility`. They require auth, use
  Postgres when `DATABASE_URL` is enabled, and use memory fallback only in dev/test without DB;
- compliance profile data is self-declared local data only: `countryCode`, `dateOfBirth`,
  backend-derived `kycStatus`, `amlStatus`, `riskLevel`, and `verificationProvider:
  self_declared`. The frontend cannot set `kycStatus: approved`;
- the backend validates age, country code, legal consent version strings, and a static local
  blocked-country list. These checks inform `canTradeMock` eligibility but do not turn on
  real-money flows; `canTradeLocal` remains a compatibility alias for older frontend code;
- `canUseRealMoney` is always `false`. There is no real KYC provider, sanctions provider, document
  verification, legal approval, document/passport image storage, withdrawals, wallet, or
  settlement. Deposit recognition core can credit ledger only from confirmed USDT/TRON
  webhook events after backend safety gates;
- wallet core endpoints now exist at `GET /api/wallets/me`,
  `POST /api/wallets/deposit-intents`, `GET /api/wallets/deposits`,
  `POST /api/wallets/withdrawal-requests`, `GET /api/wallets/withdrawal-requests`, and
  `POST /api/wallets/webhooks/deposits`. They are backend-only core APIs backed by memory
  fallback or Postgres when `DATABASE_URL` is enabled and `LocalWalletProvider`; user wallet
  endpoints require auth, and the local webhook requires a dev secret;
- wallet core responses include `mode: "wallet_review_only"` and an explicit
  warning. There are no withdrawals, private keys, seed phrases, mnemonics, wallet signing,
  TronGrid/TronWeb network calls, settlement, or outbound transfers;
- deposit webhook core uses `WalletDepositProvider`; `LocalWalletProvider` parses local
  payloads and `ReadOnlyTronDepositProvider` is a read-only parser for future provider/wallet
  webhook payloads. The code does not poll TRON, generate addresses from private keys, or sign
  transactions;
- `/api/wallets/webhooks/deposits` requires `WALLET_DEPOSIT_WEBHOOK_SECRET` and the matching
  `X-Deposit-Webhook-Secret` request header before it records deposit events or audit logs. It accepts
  only USDT/TRON, validates recipient address ownership, rejects amount <= 0 / unsupported
  asset-network / unknown wallet, stores `wallet_deposit_events`, waits for
  `WALLET_DEPOSIT_MIN_CONFIRMATIONS`, and credits ledger once with
  `deposit:${txHash}:${logIndex}` idempotency. Duplicate webhook calls must not double-credit
  balance;
- deposit webhook payloads must include an explicit `logIndex` or unique provider event id
  (`eventId`/`providerEventId`). A `txHash` without an event key returns `INVALID_WEBHOOK_EVENT`;
  the parser must not fall back to a shared `"0"` log index for provider events;
- deposit webhook replay is accepted only when the normalized event fingerprint matches the
  original event. If the same `txHash + logIndex` arrives with a different amount, recipient,
  asset/network, or stable provider payload, the API returns 409, marks the deposit event
  `manual_review`, skips ledger credit, and records `wallet.deposit_rejected`;
- canonical deposit fingerprints use the runtime SHA-256 stable algorithm. Legacy md5
  fingerprints backfilled by `008_wallet_deposit_event_fingerprint.sql` are accepted only as a
  compatibility path, and only when the existing stored event normalized with the current algorithm
  matches the incoming webhook payload;
- if compliance/user state is blocked, a confirmed deposit event is saved but ledger credit is
  skipped. Raw provider payload is stored server-side for audit/reconciliation but is not returned
  from `GET /api/wallets/deposits`;
- Postgres deposit event persistence also enforces `wallet_deposit_events.amount > 0` through
  `009_wallet_deposit_event_amount_check.sql`, so zero or negative deposit amounts cannot be stored
  even if service validation is bypassed;
- withdrawal withdrawal requests require auth, a user-scoped idempotency key, a basic TRON address
  shape, positive amount, and explicit core marking. They call compliance eligibility, but
  because `canUseRealMoney` is always `false`, responses return `realTransferBlocked: true` with
  `TRANSFERS_UNAVAILABLE` and do not move funds;
- withdrawal idempotency keys are bound to the normalized request fingerprint
  asset/network/destination/amount. Reusing a key with a different payload is rejected with
  `IDEMPOTENCY_KEY_REUSE_MISMATCH` instead of returning the old request;
- the frontend/API cannot set withdrawal status to `approved`, `broadcast_pending`, `broadcasted`,
  or other admin/provider-owned lifecycle states. Admin Core can reject a withdrawal request
  for review, but real approval and real broadcast are not implemented;
- admin core endpoints exist at `GET /api/admin/users`, `GET /api/admin/audit-logs`,
  `GET /api/admin/wallet-withdrawals`, `POST /api/admin/wallet-withdrawals/:id/reject`,
  `POST /api/admin/markets/:id/hide`, and `POST /api/admin/markets/:id/unhide`. They require
  authenticated admin roles through backend `requireAdmin` / `requireAdminRole(...)`; ordinary
  authenticated users receive 403. Roles are backend/DB-owned (`user`, `support`,
  `compliance_admin`, `finance_admin`, `super_admin`) and cannot be assigned by frontend register
  or settings payloads;
- admin withdrawal review is local. Rejecting a withdrawal changes only the core
  withdrawal status and records audit; responses include `realTransferBlocked: true` and
  `mode: "wallet_review_only"`. It does not perform real approval, wallet,
  broadcast, settlement, ledger debit, or transfer;
- admin market hide/unhide uses Postgres-backed admin visibility rules when `DATABASE_URL` is
  enabled and memory core rules only in dev/test without DB, limited to reasons `legal_risk`,
  `compliance`, `sensitive_topic`, and `manual_review`;
- wallet rows, deposit intents, deposit events, withdrawal requests, provider events, withdrawal
  idempotency fingerprints, compliance profile/consents, watchlist rows, trades, positions, and
  ledger entries persist in Postgres when `DATABASE_URL` is enabled; memory fallback remains only
  for dev/test without DB;
- local order execution is still not real-money execution. Its authenticated DB path persists
  ledger/trade/position state, but a future follow-up must compose those writes into one atomic
  DB transaction across repositories before broader production trading;
- there are no withdrawals, private keys, wallet, TRON network calls, settlement, or outbound
  transfer flows.

The auth local uses hashed passwords, HttpOnly SameSite cookie sessions, and an in-memory rate limit
for register/login/settings endpoints. Session tokens must not be stored in localStorage or exposed
to frontend JavaScript.

The production readiness core adds explicit config guardrails without enabling real money:
`APP_MODE` must remain `local`; production startup rejects placeholder session/webhook
secrets, `SESSION_COOKIE_SECURE=false`, missing `DATABASE_URL`, and empty/wildcard
`CORS_ALLOWED_ORIGINS`. `buildApp` also fails fast if an explicit production config omits
`DATABASE_URL`, so critical runtime state cannot silently choose memory fallback. `GET /api/health`
is a non-secret liveness check. `GET /api/ready` checks
database availability, the backend market data layer, and critical config flags without returning
secret values. A failing readiness check must be treated as not deployable/servable.

The in-memory auth rate limit is local-only. Production must replace it with a Redis-backed,
edge-level, or reverse-proxy rate limit that works across API processes and deployments.

The initial database migration includes `ledger_entries`, `wallets`, `trades`, and `positions` so
future work has a safer shape. `002_ledger_core.sql` tightens `ledger_entries` with normal
ledger fields and constraints, `004_wallets_usdt_core.sql` prepares
`wallet_deposit_intents`, `wallet_withdrawal_requests`, and `wallet_provider_events`, and
`005_wallet_withdrawal_idempotency_fingerprint.sql` adds a withdrawal request fingerprint.
`006_admin_core.sql` prepares user roles, `approved_for_review` withdrawal status, and
admin market visibility rules. `007_wallet_deposit_events.sql` adds deposit event persistence and
`tx_hash + log_index` idempotency. `008_wallet_deposit_event_fingerprint.sql` adds event
fingerprints and `manual_review` for replay payload mismatches; runtime keeps replay compatibility
with its legacy md5 backfill through current SHA-256 stable normalization checks.
`009_wallet_deposit_event_amount_check.sql` adds a positive amount check to
`wallet_deposit_events`. Their presence does not enable withdrawals, settlement, wallet,
private-key storage, TRON network calls, admin real-money approval, or provider reconciliation.
Broader real money still requires legal/KYC/AML/security decisions, production idempotency, audit
coverage, monitoring, backup/restore, reconciliation, provider/wallet review, and a reviewed
finance operating model.

DB-backed auth has been smoke-tested against Supabase for register, login, me, logout, session
cookie handling, and auth audit rows. Logout records its audit event before deleting the session row
so the audit log can keep a valid `session_id` reference. Trading quote/order/rejected events also
go through the audit service and write to `audit_logs` when DB is enabled.

The mobile header now exposes auth navigation through a menu, so Log In, Sign Up, Portfolio, and
Profile are available on small screens. This is navigation only; authorization decisions still
belong to the backend.

## Before Broader Real Money

Do not add production deposit provider integration, USDT withdrawals, or real-money trading until
these exist:

- authenticated users;
- legal/security-reviewed wallet, deposit, withdrawal, and wallet operating model on top of the
  database-backed core;
- immutable ledger entries;
- reviewed ledger balance semantics for trading, settlement, provider events, and reconciliation;
- database-backed wallet/deposit/withdrawal repositories with production idempotency and provider
  event handling;
- idempotency keys for payment events;
- rate limits;
- request validation schemas;
- audit logs;
- compliance profile/consent persistence with real KYC/AML/sanctions provider decisions;
- persistent users and sessions;
- email verification, password recovery, 2FA, roles, and permissions;
- device/session management;
- admin separation;
- secret management;
- monitoring and alerting;
- readiness monitoring and alerting for `/api/ready`, DB connectivity, webhook mismatch/manual
  review counts, and audit log volume;
- legal/KYC/AML/sanctions review.

Never add TronGrid/TronWeb network calls, real TRON private-key generation, seed/mnemonic storage,
wallet signing, real withdrawal broadcasting, or production blockchain webhooks inside the
local wallet layer.

## Frontend Rule For Developers

If a frontend value affects money, shares, position ownership, or permissions, it must be recomputed
or verified by the backend before it changes state.

Frontend calculations are allowed only for presentation and previews. They must never be accepted as
the final value for balances, positions, trades, settlement, deposits, withdrawals, or permissions.
The current trading ticket may display estimated shares, available shares, or disabled states, but
the backend recalculates and validates every quote/order before state changes.

The local ledger UI/API rule is the same: the frontend may request a ledger credit amount for
development tooling, but it must never submit a replacement balance. The backend creates ledger
entries and derives balances.
