# Real Money Launch Approval

## Decision

- Money-movement decision: **not approved**
- Runtime posture: **review-only**
- Deposit Coin credit: **disabled by default and requires guarded explicit opt-in**
- Fireblocks withdrawal broadcast: **not implemented in public/admin routes**
- Production Coin migration: **not implemented**
- Deployment in this change: **none**
- Updated: 2026-07-25

This is a denial/status record, not an approval artifact. Mpulse Coins are an internal accounting
unit (`1 Coin = 1 USD`, `1 Coin = 1,000,000` micros), not a blockchain token. The Coin ledger,
Fireblocks custody, and Polymarket CLOB are separate systems with separate controls.

All Coin feature flags default to false. Deposit credits additionally require the signed Fireblocks
webhook gate/provider, an exchange-rate provider, and the USDT TRON contract; a partial opt-in fails
startup. A review-only withdrawal request can reserve Coins and reach `approved_for_review`, but no
public or admin route initiates a Fireblocks transaction. Explicitly enabled internal Coin trading
uses simulated local execution and never loads a CLOB runtime. Market cancellation and no-winner
refunds can return recorded Coin cost basis, but winner redemption credits fail closed until
authoritative external CLOB funding evidence is persisted and verified. None of these controls may
be bypassed by database edits, manual ledger inserts, provider environment variables, or UI
changes.

## Allowed review scope

- Review and test the PostgreSQL Coin schema and immutable ledger.
- Exercise string-based Coin APIs and UI presentation.
- Run balance migration and reconciliation only against a dedicated disposable test database.
- Verify signed Fireblocks deposit webhooks using non-production fixtures.
- Record provider evidence and withdrawal requests in review-only states.
- Use idempotent admin corrections as explicit compensating Coin entries.
- Exercise local simulated trading only where the backend labels and permits it.

A green check, schema migration, no-op apply, or zero-discrepancy reconciliation is merge evidence
only. It is not authorization to receive, credit, trade, settle, or withdraw real funds.

## Explicitly prohibited

- Crediting Coins from real deposits.
- Sending a Fireblocks transaction from this application.
- Adding Fireblocks private keys, source vault IDs, broadcast credentials, or live secrets to the
  repository.
- Treating `approved_for_review` as provider approval.
- Funding or enabling a real Polymarket CLOB execution wallet.
- Treating USDT as USD without a fresh immutable rate snapshot.
- Re-enabling legacy ledger writes, dual-writing money, or falling back to in-memory money state.
- Applying the current balance cutover CLI to production; it intentionally accepts only a
  dedicated `TEST_DATABASE_URL`.
- Editing or deleting ledger/provider/migration history instead of using reviewed compensating
  entries.
- Deploying this change as part of the review.

## Safe environment posture

```txt
APP_MODE=local
LEDGER_CREDIT_API_ENABLED=false
WALLET_DEPOSIT_WEBHOOK_ENABLED=false
ADMIN_MANUAL_DEPOSIT_APPROVAL_ENABLED=false
COIN_DEPOSIT_CREDITS_ENABLED=false
COIN_WITHDRAWAL_REQUESTS_ENABLED=false
COIN_INTERNAL_TRADING_ENABLED=false
REAL_MONEY_DEPOSIT_PROVIDER=
EXCHANGE_RATE_PROVIDER=disabled
COINS_MIGRATION_APPLY=false
```

`REAL_MONEY_DEPOSIT_PROVIDER=fireblocks` enables signed inbound-webhook verification and
review-evidence ingestion. It does not enable a Coin credit or any outbound provider call.
`FIREBLOCKS_WEBHOOK_JWKS_URL` must point to the official endpoint for the configured Fireblocks
region; `https://keys.fireblocks.io/.well-known/jwks.json` is the US production example. The
verifier expects a detached JWS in `Fireblocks-Webhook-Signature` using RS512. Configuring a JWKS or
the Coinbase exchange-rate source does not approve a credit, withdrawal, trade, migration, or
deployment.

## Conditions for a future decision

A future approval requires a new dated artifact with named legal, security, finance, and operations
approvers. Do not change this decision merely because technical checks pass. At minimum:

- [ ] Coin migration dry-run reviewed with exact available/reserved totals
- [ ] Production-specific cutover workflow implemented; the current test-only CLI is insufficient
- [ ] Backup/restore rehearsal, maintenance window, observation, abort, and forward recovery approved
- [ ] Legacy-to-Coin fence and no-dual-write behavior independently reviewed
- [ ] Coin ledger concurrency, idempotency, negative-balance, and immutable-history tests passed
- [ ] Deposit provider-event and chain-transfer deduplication tested under concurrency
- [ ] Fireblocks raw-body detached-JWS verification, replay, conflict, regional JWKS, and key rotation tested
- [ ] TRON network, USDT contract, address ownership, confirmation, and reorg policy approved
- [ ] Coinbase USDT/USD source, TTL, outage, stale quote, and manipulation policy approved
- [ ] Deposit credit enablement wired to a separately audited launch capability
- [ ] Withdrawal quote, reserve, release, final-rate, final-debit, and unknown-state paths tested
- [ ] Pre-broadcast final fee/rate snapshot and verified Fireblocks request evidence implemented
- [ ] Fireblocks broadcast owner, key custody, transaction policy, limits, allowlists, and reconciliation approved
- [ ] Trading reserve/fill/partial-fill/cancel/manual-review accounting reconciled
- [ ] Authoritative Polymarket order/fill receipts implemented and reconciled
- [ ] CLOB credentials, funded collateral proof, execution evidence, and provider reconciliation approved
- [ ] Winner-redemption receipt, funded payout amount, and idempotent settlement linkage persisted and verified
- [ ] Market resolve/cancel payout and refund accounting independently reconciled
- [ ] Durable outbox lease/retry/dead-letter code is implemented; downstream handlers, alerting,
      replay procedure, monitoring, and named ownership are approved
- [ ] Admin corrections have permissions, limits, four-eyes review, and an incident procedure
- [ ] AML, sanctions, region/account-risk, legal disclosure, and incident ownership approved
- [ ] Alerts cover cutover state, discrepancies, provider conflicts, stale rates, reversals,
      unknown withdrawals, locked trade reserves, and failed/stuck outbox events
- [ ] Non-production provider rehearsal completed with evidence retained
- [ ] The exact release commit has all required checks and reconciliation evidence attached

## Approval record

No legal, security, finance, or operations sign-off authorizing production money movement is
recorded here.

Status remains **not approved**. Launch approval remains false.
