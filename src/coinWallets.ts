import { createHash, randomUUID } from "node:crypto";
import {
  CoinLedgerError,
  PostgresCoinLedgerRepository,
  type CoinBalance,
  type CoinLedgerEntry,
} from "./coins.js";
import type { Database, Queryable } from "./db.js";
import {
  ExchangeRateError,
  SUPPORTED_SETTLEMENT_ASSET,
  SUPPORTED_SETTLEMENT_NETWORK,
  validateUsdQuote,
  type ExchangeRateProvider,
  type UsdQuote,
} from "./exchangeRates.js";
import {
  coinMicros,
  coinMicrosToUsdt,
  formatAtomic,
  parseCoins,
  parseUsdt,
  serializeUsdtAtomic,
  usdtAtomic,
  usdtToCoinMicros,
  type CoinMicros,
  type UsdtAtomic,
} from "./money.js";
import type { FireblocksDepositWebhookResult } from "./realMoneyAdapters/fireblocksDepositWebhook.js";
import { isRecord, stableStringify, toIsoString } from "./utils.js";

const COIN_WALLET_PROVIDER = "fireblocks";
const REVIEW_ONLY_BLOCK_REASON = "REAL_MONEY_LAUNCH_NOT_APPROVED";
const PROVIDER_CONFIRMED_FAILED = "PROVIDER_CONFIRMED_FAILED";
const WITHDRAWAL_RESERVE_LOCKED_REASON =
  "WITHDRAWAL_RESERVE_LOCKED_PROVIDER_OUTCOME_NOT_CONFIRMED";
const DEPOSIT_IMMUTABLE_FIELDS_CONFLICT = "DEPOSIT_IMMUTABLE_FIELDS_CONFLICT";
const DEPOSIT_INTENT_AMBIGUOUS = "DEPOSIT_INTENT_AMBIGUOUS";

export type CoinDepositStatus =
  | "detected"
  | "confirming"
  | "confirmed_unpriced"
  | "pending_rate"
  | "manual_review"
  | "credited"
  | "rejected"
  | "reversal_pending"
  | "reversing"
  | "reversed";

export type CoinWithdrawalStatus =
  | "pending_review"
  | "approved_for_review"
  | "rejected"
  | "cancelled"
  | "broadcast_pending"
  | "broadcasted"
  | "failed";

export type CoinRateSnapshot = {
  id: string;
  asset: "USDT";
  network: "TRON";
  quoteCurrency: "USD";
  rateNanos: string;
  rateDecimal: string;
  source: string;
  kind: "indicative" | "final";
  purpose: "deposit_final" | "withdrawal_indicative" | "withdrawal_final";
  quotedAt: string;
  expiresAt: string;
  providerReference: string | null;
  createdAt: string;
};

export type CoinDeposit = {
  id: string;
  provider: string;
  providerEventId: string;
  providerTransactionId: string | null;
  blockchainTxHash: string;
  eventIndex: string;
  network: "TRON";
  tokenContract: string;
  destinationAddress: string;
  depositIntentId: string | null;
  userId: string | null;
  grossUsdtAtomic: string;
  networkFeeUsdtAtomic: string;
  providerFeeUsdtAtomic: string;
  netUsdtAtomic: string;
  rateSnapshotId: string | null;
  usdValueMicros: string | null;
  creditedCoinMicros: string | null;
  ledgerEntryId: string | null;
  reversalLedgerEntryId: string | null;
  requiredConfirmations: string;
  actualConfirmations: string;
  status: CoinDepositStatus;
  manualReviewReason: string | null;
  detectedAt: string;
  confirmedAt: string | null;
  creditedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoinWithdrawalQuote = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON";
  destinationAddress: string;
  coinToDebitMicros: string;
  grossUsdtAtomic: string;
  estimatedUsdtAtomic: string;
  networkFeeUsdtAtomic: string;
  providerFeeUsdtAtomic: string;
  rateSnapshot: CoinRateSnapshot;
  status: "open" | "consumed" | "expired" | "cancelled";
  expiresAt: string;
  idempotencyKey: string;
  createdAt: string;
};

export type CoinWithdrawalRequest = {
  id: string;
  userId: string;
  withdrawalQuoteId: string;
  asset: "USDT";
  network: "TRON";
  destinationAddress: string;
  coinReservedMicros: string;
  coinDebitedMicros: string | null;
  estimatedUsdtAtomic: string;
  finalUsdtAtomic: string | null;
  networkFeeUsdtAtomic: string;
  providerFeeUsdtAtomic: string;
  status: CoinWithdrawalStatus;
  reserveLedgerEntryId: string;
  finalLedgerEntryId: string | null;
  releaseLedgerEntryId: string | null;
  finalRateSnapshotId: string | null;
  fireblocksReference: string | null;
  failureState: string | null;
  reviewReason: string | null;
  reviewedByActor: string | null;
  reviewedAt: string | null;
  idempotencyKey: string;
  realTransferBlocked: boolean;
  blockReason: "TRANSFERS_UNAVAILABLE" | null;
  createdAt: string;
  updatedAt: string;
};

export type VerifiedWithdrawalProviderOutcome = {
  verified: true;
  provider: "fireblocks";
  state: "completed" | "failed" | "unknown";
  providerReference: string;
  transactionHash?: string | null;
  finalUsdtAtomic?: string | null;
  networkFeeUsdtAtomic?: string | null;
  providerFeeUsdtAtomic?: string | null;
  evidenceHash: string;
  observedAt: string;
};

export type ProcessedCoinDeposit = {
  deposit: CoinDeposit | null;
  rateSnapshot: CoinRateSnapshot | null;
  ledgerEntry: CoinLedgerEntry | null;
  idempotent: boolean;
  providerEventStored: true;
  creditBlockedReason: string | null;
  conflict?: boolean;
};

export type CoinWalletServiceOptions = {
  db: Database;
  rateProvider: ExchangeRateProvider;
  rateTtlSeconds: number;
  requiredConfirmations: number;
  usdtTronContract: string | null;
  allowDepositCredits: boolean;
  withdrawalNetworkFeeUsdtAtomic?: bigint;
  withdrawalProviderFeeUsdtAtomic?: bigint;
  now?: () => Date;
};

export class CoinWalletError extends Error {
  constructor(
    public readonly code:
      | "COIN_WALLET_DATABASE_REQUIRED"
      | "INVALID_COIN_WALLET_REQUEST"
      | "INVALID_COIN_AMOUNT"
      | "INVALID_USDT_AMOUNT"
      | "INVALID_TRON_ADDRESS"
      | "IDEMPOTENCY_KEY_REQUIRED"
      | "IDEMPOTENCY_KEY_REUSE_MISMATCH"
      | "DEPOSIT_ADDRESS_UNAVAILABLE"
      | "DEPOSIT_PROVIDER_EVENT_CONFLICT"
      | "DEPOSIT_NOT_FOUND"
      | "DEPOSIT_NOT_RETRYABLE"
      | "WITHDRAWAL_QUOTE_NOT_FOUND"
      | "WITHDRAWAL_QUOTE_EXPIRED"
      | "WITHDRAWAL_QUOTE_ALREADY_USED"
      | "WITHDRAWAL_NOT_FOUND"
      | "WITHDRAWAL_NOT_CANCELLABLE"
      | "WITHDRAWAL_NOT_REVIEWABLE"
      | "ADMIN_REASON_REQUIRED"
      | "RATE_UNAVAILABLE"
      | "RATE_STALE"
      | "COIN_CUTOVER_INCOMPLETE",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "CoinWalletError";
  }
}

type ParsedFireblocksDeposit = {
  providerEventId: string;
  providerEventType: string;
  providerTransactionId: string | null;
  blockchainTxHash: string;
  eventIndex: string;
  destinationAddress: string;
  tokenContract: string;
  asset: string;
  network: string;
  grossUsdtAtomic: UsdtAtomic;
  networkFeeUsdtAtomic: UsdtAtomic;
  providerFeeUsdtAtomic: UsdtAtomic;
  confirmations: number;
  providerStatus: string;
  confirmed: boolean;
  reversal: boolean;
  validationIssues: string[];
  payload: Record<string, unknown>;
  payloadHash: string;
};

type DepositRow = {
  id: string;
  provider: string;
  provider_event_id: string;
  provider_transaction_id: string | null;
  blockchain_tx_hash: string;
  event_index: string;
  network: "TRON";
  token_contract: string;
  destination_address: string;
  deposit_intent_id: string | null;
  user_id: string | null;
  gross_usdt_atomic: string;
  network_fee_usdt_atomic: string;
  provider_fee_usdt_atomic: string;
  net_usdt_atomic: string;
  rate_snapshot_id: string | null;
  usd_value_micros: string | null;
  credited_coin_micros: string | null;
  ledger_entry_id: string | null;
  reversal_ledger_entry_id: string | null;
  last_provider_event_id: string | null;
  required_confirmations: number | string;
  actual_confirmations: number | string;
  status: CoinDepositStatus;
  manual_review_reason: string | null;
  detected_at: Date | string;
  confirmed_at: Date | string | null;
  credited_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type RateSnapshotRow = {
  id: string;
  base_asset: "USDT";
  network: "TRON";
  quote_currency: "USD";
  rate_nanos: string;
  source: string;
  kind: "indicative" | "final";
  purpose: "deposit_final" | "withdrawal_indicative" | "withdrawal_final";
  quoted_at: Date | string;
  expires_at: Date | string;
  provider_reference: string | null;
  created_at: Date | string;
};

type QuoteRow = {
  id: string;
  user_id: string;
  asset: "USDT";
  network: "TRON";
  destination_address: string;
  coin_to_debit_micros: string;
  estimated_usdt_atomic: string;
  network_fee_usdt_atomic: string;
  provider_fee_usdt_atomic: string;
  rate_snapshot_id: string;
  status: CoinWithdrawalQuote["status"];
  expires_at: Date | string;
  idempotency_key: string;
  request_fingerprint: string;
  created_at: Date | string;
};

type WithdrawalRow = {
  id: string;
  user_id: string;
  withdrawal_quote_id: string | null;
  asset: "USDT";
  network: "TRON";
  destination_address: string;
  coin_reserved_micros: string | null;
  coin_debited_micros: string | null;
  estimated_usdt_atomic: string | null;
  final_usdt_atomic: string | null;
  network_fee_usdt_atomic: string | null;
  provider_fee_usdt_atomic: string | null;
  reserve_ledger_entry_id: string | null;
  final_ledger_entry_id: string | null;
  release_ledger_entry_id: string | null;
  final_rate_snapshot_id: string | null;
  fireblocks_reference: string | null;
  failure_state: string | null;
  review_reason: string | null;
  reviewed_by_actor: string | null;
  reviewed_at: Date | string | null;
  status: CoinWithdrawalStatus;
  idempotency_key: string;
  real_transfer_blocked: boolean;
  block_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  metadata: Record<string, unknown> | null;
};

type IntentRow = {
  id: string;
  user_id: string;
  wallet_id: string;
  address: string;
  expected_amount: string;
  status: string;
  expires_at: Date | string;
};

export type DepositImmutableComparison = {
  asset: string;
  network: string;
  providerTransactionId: string | null;
  blockchainTxHash: string;
  eventIndex: string;
  tokenContract: string;
  destinationAddress: string;
  grossUsdtAtomic: string;
  networkFeeUsdtAtomic: string;
  providerFeeUsdtAtomic: string;
  netUsdtAtomic: string;
};

type DepositImmutableConflict = {
  mismatchedFields: string[];
  stored: DepositImmutableComparison;
  received: DepositImmutableComparison;
};

type LockedOrCreatedDeposit = {
  deposit: DepositRow;
  immutableConflict: DepositImmutableConflict | null;
};

export function buildCoinWalletService(options: CoinWalletServiceOptions) {
  if (!options.db.enabled) {
    throw new CoinWalletError(
      "COIN_WALLET_DATABASE_REQUIRED",
      "Coin deposits and withdrawals require PostgreSQL.",
      503,
    );
  }
  if (!Number.isSafeInteger(options.requiredConfirmations) || options.requiredConfirmations <= 0) {
    throw new CoinWalletError(
      "INVALID_COIN_WALLET_REQUEST",
      "Deposit confirmations must be a positive integer.",
    );
  }
  const now = options.now ?? (() => new Date());
  const networkFee = usdtAtomic(options.withdrawalNetworkFeeUsdtAtomic ?? 0n);
  const providerFee = usdtAtomic(options.withdrawalProviderFeeUsdtAtomic ?? 0n);

  async function createDepositIntent(input: {
    userId: string;
    expectedUsdtAtomic: unknown;
    memo?: unknown;
  }) {
    const expected = parsePositiveUsdtAtomic(input.expectedUsdtAtomic);
    const memo = optionalText(input.memo);
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

    return options.db.transaction(async (tx) => {
      const walletResult = await tx.query<{
        id: string;
        address: string | null;
      }>(
        `select id, address
         from wallets
         where user_id = $1 and asset = 'USDT' and network = 'TRON'
           and provider = 'fireblocks' and status = 'active' and address is not null
         order by created_at desc
         limit 1
         for update`,
        [input.userId],
      );
      const wallet = walletResult.rows[0];
      if (!wallet?.address || !isValidTronAddress(wallet.address)) {
        throw new CoinWalletError(
          "DEPOSIT_ADDRESS_UNAVAILABLE",
          "A verified Fireblocks TRON deposit address is not available.",
          503,
        );
      }

      const id = randomUUID();
      const result = await tx.query<{
        id: string;
        address: string;
        expires_at: Date | string;
        created_at: Date | string;
      }>(
        `insert into wallet_deposit_intents (
           id, user_id, wallet_id, asset, network, address, expected_amount,
           status, memo, metadata, expires_at, created_at, updated_at
         ) values (
           $1, $2, $3, 'USDT', 'TRON', $4, $5::numeric, 'waiting', $6,
           $7::jsonb, $8, $9, $9
         )
         returning id, address, expires_at, created_at`,
        [
          id,
          input.userId,
          wallet.id,
          wallet.address,
          formatAtomic(expected, 6),
          memo,
          JSON.stringify({
            expectedUsdtAtomic: expected.toString(),
            settlementAsset: "USDT",
            network: "TRON",
            provider: COIN_WALLET_PROVIDER,
            reviewOnly: !options.allowDepositCredits,
          }),
          expiresAt.toISOString(),
          createdAt.toISOString(),
        ],
      );
      const row = requireRow(result.rows[0], "Deposit intent insert returned no row.");
      return {
        depositIntent: {
          id: row.id,
          userId: input.userId,
          asset: SUPPORTED_SETTLEMENT_ASSET,
          network: SUPPORTED_SETTLEMENT_NETWORK,
          address: row.address,
          expectedUsdtAtomic: expected.toString(),
          status: "waiting" as const,
          memo,
          expiresAt: toIsoString(row.expires_at),
          createdAt: toIsoString(row.created_at),
        },
        instructions: {
          asset: SUPPORTED_SETTLEMENT_ASSET,
          network: SUPPORTED_SETTLEMENT_NETWORK,
          rail: "TRC-20",
          tokenContract: options.usdtTronContract,
          address: row.address,
          requiredConfirmations: String(options.requiredConfirmations),
          doNotSubmitTransactionHash: true,
        },
        reviewOnly: !options.allowDepositCredits,
      };
    });
  }

  async function processFireblocksWebhook(
    verified: FireblocksDepositWebhookResult,
  ): Promise<ProcessedCoinDeposit> {
    const parsed = parseFireblocksDeposit(verified);
    if (parsed.asset !== "USDT") parsed.validationIssues.push("UNSUPPORTED_ASSET");
    if (parsed.network !== "TRON") parsed.validationIssues.push("UNSUPPORTED_NETWORK");
    if (!options.usdtTronContract) {
      parsed.validationIssues.push("USDT_CONTRACT_NOT_CONFIGURED");
    } else if (parsed.tokenContract !== options.usdtTronContract) {
      parsed.validationIssues.push("TOKEN_CONTRACT_MISMATCH");
    }
    parsed.validationIssues = [...new Set(parsed.validationIssues)];
    let quote: UsdQuote | null = null;
    let rateError: ExchangeRateError | null = null;

    if (
      parsed.confirmed &&
      !parsed.reversal &&
      parsed.validationIssues.length === 0 &&
      options.allowDepositCredits
    ) {
      const net = calculateNetUsdt(parsed);
      try {
        quote = validateUsdQuote(
          await options.rateProvider.getUsdQuote({
            asset: SUPPORTED_SETTLEMENT_ASSET,
            network: SUPPORTED_SETTLEMENT_NETWORK,
            amountUsdtAtomic: net,
            purpose: "deposit_final",
          }),
          {
            ttlSeconds: options.rateTtlSeconds,
            now: now(),
            expectedPurpose: "deposit_final",
            expectedKind: "final",
            expectedAmountUsdtAtomic: net,
          },
        );
      } catch (error) {
        rateError = normalizeRateError(error);
      }
    }

    return options.db.transaction(async (tx) => {
      const providerEvent = await storeProviderEvent(tx, parsed, now());
      if (providerEvent.payloadHash !== parsed.payloadHash) {
        await tx.query(
          `insert into money_provider_events (
             provider, provider_event_id, event_type, provider_transaction_id,
             payload, payload_hash, received_at, created_at
           ) values (
             'fireblocks', $1, 'PROVIDER_EVENT_ID_CONFLICT', $2, $3::jsonb, $4, $5, $5
           )
           on conflict (provider, provider_event_id) do nothing`,
          [
            `${parsed.providerEventId}:conflict:${parsed.payloadHash.slice(0, 16)}`,
            parsed.providerTransactionId,
            JSON.stringify(parsed.payload),
            parsed.payloadHash,
            now().toISOString(),
          ],
        );
        const linked = await tx.query<DepositRow>(
          `update crypto_deposits
           set status = case
                 when status in ('credited', 'reversal_pending', 'reversing', 'reversed')
                   then status
                 else 'manual_review'
               end,
               manual_review_reason = 'PROVIDER_EVENT_ID_PAYLOAD_CONFLICT',
               updated_at = now()
           where provider = 'fireblocks'
             and (
               ($1::text is not null and provider_transaction_id = $1)
               or (
                 blockchain_tx_hash = $2 and token_contract = $3
                 and event_index = $4 and destination_address = $5
               )
             )
           returning ${depositColumns}`,
          [
            parsed.providerTransactionId,
            parsed.blockchainTxHash,
            parsed.tokenContract,
            parsed.eventIndex,
            parsed.destinationAddress,
          ],
        );
        const linkedDeposit = linked.rows[0] ?? null;
        await insertAudit(tx, {
          eventType: "wallet.deposit_provider_event_conflict",
          userId: linkedDeposit?.user_id ?? null,
          metadata: {
            provider: COIN_WALLET_PROVIDER,
            providerEventId: parsed.providerEventId,
            expectedPayloadHash: providerEvent.payloadHash,
            receivedPayloadHash: parsed.payloadHash,
            manualReview: true,
          },
        });
        await insertOutbox(tx, {
          aggregateType: "provider_event",
          aggregateId: parsed.providerEventId,
          eventType: "provider_event.payload_conflict",
          idempotencyKey: `provider-event:${parsed.providerEventId}:conflict:${parsed.payloadHash}`,
          payload: {
            cryptoDepositId: linkedDeposit?.id ?? null,
            expectedPayloadHash: providerEvent.payloadHash,
            receivedPayloadHash: parsed.payloadHash,
            manualReview: true,
          },
        });
        return {
          deposit: linkedDeposit ? mapDeposit(linkedDeposit) : null,
          rateSnapshot: null,
          ledgerEntry: null,
          idempotent: false,
          providerEventStored: true,
          creditBlockedReason: "PROVIDER_EVENT_ID_PAYLOAD_CONFLICT",
          conflict: true,
        };
      }

      const lockedDeposit = await lockOrCreateDeposit(
        tx,
        parsed,
        providerEvent.id,
        options.requiredConfirmations,
        now(),
      );
      if (!lockedDeposit) {
        return {
          deposit: null,
          rateSnapshot: null,
          ledgerEntry: null,
          idempotent: providerEvent.existing,
          providerEventStored: true,
          creditBlockedReason: "INVALID_PROVIDER_EVENT",
        };
      }
      const { deposit, immutableConflict } = lockedDeposit;
      if (immutableConflict) {
        await insertAudit(tx, {
          eventType: "wallet.deposit_immutable_fields_conflict",
          userId: deposit.user_id,
          metadata: {
            cryptoDepositId: deposit.id,
            provider: COIN_WALLET_PROVIDER,
            providerEventId: parsed.providerEventId,
            providerTransactionId: parsed.providerTransactionId,
            mismatchedFields: immutableConflict.mismatchedFields,
            stored: immutableConflict.stored,
            received: immutableConflict.received,
            terminalStatusPreserved: isDepositFinancialStateImmutable(deposit.status),
            manualReview: true,
          },
        });
        await insertOutbox(tx, {
          aggregateType: "crypto_deposit",
          aggregateId: deposit.id,
          eventType: "crypto_deposit.immutable_fields_conflict",
          idempotencyKey:
            `crypto-deposit:${deposit.id}:immutable-conflict:${providerEvent.id}`,
          payload: {
            userId: deposit.user_id,
            providerEventId: parsed.providerEventId,
            mismatchedFields: immutableConflict.mismatchedFields,
            terminalStatusPreserved: isDepositFinancialStateImmutable(deposit.status),
            manualReview: true,
          },
        });
        return {
          deposit: mapDeposit(deposit),
          rateSnapshot: deposit.rate_snapshot_id
            ? await findRateSnapshot(tx, deposit.rate_snapshot_id)
            : null,
          ledgerEntry: null,
          idempotent: providerEvent.existing,
          providerEventStored: true,
          creditBlockedReason: DEPOSIT_IMMUTABLE_FIELDS_CONFLICT,
          conflict: true,
        };
      }

      if (deposit.status === "credited" && !parsed.reversal) {
        return {
          deposit: mapDeposit(deposit),
          rateSnapshot: deposit.rate_snapshot_id
            ? await findRateSnapshot(tx, deposit.rate_snapshot_id)
            : null,
          ledgerEntry: deposit.ledger_entry_id
            ? await findCoinEntry(tx, deposit.ledger_entry_id)
            : null,
          idempotent: true,
          providerEventStored: true,
          creditBlockedReason: null,
        };
      }
      if (
        (deposit.status === "reversed" || deposit.status === "reversal_pending") &&
        !parsed.reversal
      ) {
        return {
          deposit: mapDeposit(deposit),
          rateSnapshot: deposit.rate_snapshot_id
            ? await findRateSnapshot(tx, deposit.rate_snapshot_id)
            : null,
          ledgerEntry: deposit.reversal_ledger_entry_id
            ? await findCoinEntry(tx, deposit.reversal_ledger_entry_id)
            : null,
          idempotent: true,
          providerEventStored: true,
          creditBlockedReason:
            deposit.status === "reversal_pending"
              ? deposit.manual_review_reason
              : null,
        };
      }

      if (parsed.reversal) {
        return reverseDeposit(tx, deposit, parsed, now());
      }

      const validationReason = await validateDepositForCredit(tx, deposit, parsed, now());
      if (validationReason) {
        const updated = await updateDepositState(tx, {
          id: deposit.id,
          status: validationReason === "INSUFFICIENT_CONFIRMATIONS" ? "confirming" : "manual_review",
          confirmations: parsed.confirmations,
          manualReviewReason:
            validationReason === "INSUFFICIENT_CONFIRMATIONS" ? null : validationReason,
        });
        await setIntentDetected(tx, updated.deposit_intent_id);
        await insertAudit(tx, {
          eventType:
            validationReason === "INSUFFICIENT_CONFIRMATIONS"
              ? "wallet.deposit_confirming"
              : "wallet.deposit_manual_review",
          userId: updated.user_id,
          metadata: depositAuditMetadata(updated, parsed, validationReason),
        });
        await insertOutbox(tx, {
          aggregateType: "crypto_deposit",
          aggregateId: updated.id,
          eventType:
            updated.status === "confirming"
              ? "crypto_deposit.confirming"
              : "crypto_deposit.manual_review",
          idempotencyKey: `crypto-deposit:${updated.id}:${updated.status}:${parsed.providerEventId}`,
          payload: depositAuditMetadata(updated, parsed, validationReason),
        });
        return {
          deposit: mapDeposit(updated),
          rateSnapshot: null,
          ledgerEntry: null,
          idempotent: providerEvent.existing,
          providerEventStored: true,
          creditBlockedReason: validationReason,
        };
      }

      if (!options.allowDepositCredits) {
        const updated = await updateDepositState(tx, {
          id: deposit.id,
          status: "manual_review",
          confirmations: parsed.confirmations,
          manualReviewReason: REVIEW_ONLY_BLOCK_REASON,
          confirmedAt: now().toISOString(),
        });
        await setIntentDetected(tx, updated.deposit_intent_id);
        await insertAudit(tx, {
          eventType: "wallet.deposit_manual_review",
          userId: updated.user_id,
          metadata: depositAuditMetadata(updated, parsed, REVIEW_ONLY_BLOCK_REASON),
        });
        return {
          deposit: mapDeposit(updated),
          rateSnapshot: null,
          ledgerEntry: null,
          idempotent: providerEvent.existing,
          providerEventStored: true,
          creditBlockedReason: REVIEW_ONLY_BLOCK_REASON,
        };
      }

      if (!quote || rateError) {
        const reason = rateError?.code ?? "RATE_UNAVAILABLE";
        const updated = await updateDepositState(tx, {
          id: deposit.id,
          status: rateError?.code === "RATE_STALE" ? "confirmed_unpriced" : "pending_rate",
          confirmations: parsed.confirmations,
          manualReviewReason: reason,
          confirmedAt: now().toISOString(),
        });
        await setIntentDetected(tx, updated.deposit_intent_id);
        await insertAudit(tx, {
          eventType: "wallet.deposit_pending_rate",
          userId: updated.user_id,
          metadata: depositAuditMetadata(updated, parsed, reason),
        });
        await insertOutbox(tx, {
          aggregateType: "crypto_deposit",
          aggregateId: updated.id,
          eventType: "crypto_deposit.pending_rate",
          idempotencyKey: `crypto-deposit:${updated.id}:pending-rate:${parsed.providerEventId}`,
          payload: depositAuditMetadata(updated, parsed, reason),
        });
        return {
          deposit: mapDeposit(updated),
          rateSnapshot: null,
          ledgerEntry: null,
          idempotent: providerEvent.existing,
          providerEventStored: true,
          creditBlockedReason: reason,
        };
      }

      return creditDeposit(tx, deposit, quote, parsed.providerEventId, null, now());
    });
  }

  async function retryDeposit(input: {
    depositId: string;
    adminActor: string;
    reason: unknown;
  }): Promise<ProcessedCoinDeposit> {
    const reason = requiredReason(input.reason);
    const actor = requiredActor(input.adminActor);
    if (!options.allowDepositCredits) {
      throw new CoinWalletError(
        "DEPOSIT_NOT_RETRYABLE",
        "Deposit credit is blocked until real-money launch approval.",
        403,
      );
    }
    const before = await options.db.query<DepositRow>(
      `${depositSelectSql} where id = $1 limit 1`,
      [input.depositId],
    );
    const deposit = before.rows[0];
    if (!deposit) {
      throw new CoinWalletError("DEPOSIT_NOT_FOUND", "Crypto deposit was not found.", 404);
    }
    if (
      !["pending_rate", "confirmed_unpriced", "manual_review"].includes(deposit.status) ||
      (deposit.status === "manual_review" &&
        !["RATE_UNAVAILABLE", "RATE_STALE"].includes(deposit.manual_review_reason ?? "")) ||
      BigInt(deposit.actual_confirmations) < BigInt(deposit.required_confirmations) ||
      !options.usdtTronContract ||
      deposit.token_contract !== options.usdtTronContract
    ) {
      throw new CoinWalletError(
        "DEPOSIT_NOT_RETRYABLE",
        "Crypto deposit is not awaiting a safe retry.",
        409,
      );
    }
    if (!deposit.user_id || !deposit.deposit_intent_id) {
      throw new CoinWalletError(
        "DEPOSIT_NOT_RETRYABLE",
        "Crypto deposit does not have a verified user intent.",
        409,
      );
    }
    const net = usdtAtomic(BigInt(deposit.net_usdt_atomic), false);
    let quote: UsdQuote;
    try {
      quote = validateUsdQuote(
        await options.rateProvider.getUsdQuote({
          asset: SUPPORTED_SETTLEMENT_ASSET,
          network: SUPPORTED_SETTLEMENT_NETWORK,
          amountUsdtAtomic: net,
          purpose: "deposit_final",
        }),
        {
          ttlSeconds: options.rateTtlSeconds,
          now: now(),
          expectedPurpose: "deposit_final",
          expectedKind: "final",
          expectedAmountUsdtAtomic: net,
        },
      );
    } catch (error) {
      throw mapRateError(error);
    }

    return options.db.transaction(async (tx) => {
      const locked = await findDepositForUpdate(tx, input.depositId);
      if (!locked) {
        throw new CoinWalletError("DEPOSIT_NOT_FOUND", "Crypto deposit was not found.", 404);
      }
      if (locked.status === "credited") {
        return {
          deposit: mapDeposit(locked),
          rateSnapshot: locked.rate_snapshot_id
            ? await findRateSnapshot(tx, locked.rate_snapshot_id)
            : null,
          ledgerEntry: locked.ledger_entry_id
            ? await findCoinEntry(tx, locked.ledger_entry_id)
            : null,
          idempotent: true,
          providerEventStored: true,
          creditBlockedReason: null,
        };
      }
      if (
        !["pending_rate", "confirmed_unpriced", "manual_review"].includes(locked.status) ||
        (locked.status === "manual_review" &&
          !["RATE_UNAVAILABLE", "RATE_STALE"].includes(
            locked.manual_review_reason ?? "",
          ))
      ) {
        throw new CoinWalletError(
          "DEPOSIT_NOT_RETRYABLE",
          "Crypto deposit is not awaiting a safe retry.",
          409,
        );
      }
      return creditDeposit(
        tx,
        locked,
        quote,
        `admin-retry:${actor}:${input.depositId}`,
        { actor, reason },
        now(),
      );
    });
  }

  async function createWithdrawalQuote(input: {
    userId: string;
    destinationAddress: unknown;
    coinAmountMicros: unknown;
    idempotencyKey: unknown;
  }): Promise<CoinWithdrawalQuote> {
    const destinationAddress = parseTronAddress(input.destinationAddress);
    const amount = parsePositiveCoinMicros(input.coinAmountMicros);
    const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
    const fingerprint = hashJson({
      userId: input.userId,
      destinationAddress,
      coinAmountMicros: amount.toString(),
    });

    const existing = await findQuoteByIdempotency(options.db, input.userId, idempotencyKey);
    if (existing) {
      assertQuoteFingerprint(existing.quote, fingerprint);
      return mapQuoteWithSnapshot(existing.quote, existing.rate);
    }

    let quote: UsdQuote;
    try {
      quote = validateUsdQuote(
        await options.rateProvider.getUsdQuote({
          asset: SUPPORTED_SETTLEMENT_ASSET,
          network: SUPPORTED_SETTLEMENT_NETWORK,
          amountUsdtAtomic: usdtAtomic(amount),
          purpose: "withdrawal_indicative",
        }),
        {
          ttlSeconds: options.rateTtlSeconds,
          now: now(),
          expectedPurpose: "withdrawal_indicative",
          expectedKind: "indicative",
          expectedAmountUsdtAtomic: usdtAtomic(amount),
        },
      );
    } catch (error) {
      throw mapRateError(error);
    }

    const gross = coinMicrosToUsdt(amount, quote.usdRateNanos, "down");
    const totalFee = networkFee + providerFee;
    if (gross <= totalFee) {
      throw new CoinWalletError(
        "INVALID_COIN_AMOUNT",
        "Coin amount does not cover the withdrawal fees.",
      );
    }
    const estimated = usdtAtomic(gross - totalFee, false);

    return options.db.transaction(async (tx) => {
      const concurrent = await findQuoteByIdempotency(tx, input.userId, idempotencyKey, true);
      if (concurrent) {
        assertQuoteFingerprint(concurrent.quote, fingerprint);
        return mapQuoteWithSnapshot(concurrent.quote, concurrent.rate);
      }

      const rateSnapshot = await insertRateSnapshot(tx, quote);
      const id = randomUUID();
      const result = await tx.query<QuoteRow>(
        `insert into withdrawal_quotes (
           id, user_id, asset, network, destination_address,
           coin_to_debit_micros, estimated_usdt_atomic,
           network_fee_usdt_atomic, provider_fee_usdt_atomic, rate_snapshot_id,
           status, expires_at, idempotency_key, request_fingerprint, created_at
         ) values (
           $1, $2, 'USDT', 'TRON', $3, $4::bigint, $5::bigint,
           $6::bigint, $7::bigint, $8, 'open', $9, $10, $11, $12
         )
         returning ${quoteColumns}`,
        [
          id,
          input.userId,
          destinationAddress,
          amount.toString(),
          estimated.toString(),
          networkFee.toString(),
          providerFee.toString(),
          rateSnapshot.id,
          quote.expiresAt,
          idempotencyKey,
          fingerprint,
          now().toISOString(),
        ],
      );
      const saved = requireRow(result.rows[0], "Withdrawal quote insert returned no row.");
      await insertAudit(tx, {
        eventType: "wallet.withdrawal_quote_created",
        userId: input.userId,
        metadata: {
          withdrawalQuoteId: saved.id,
          coinAmountMicros: saved.coin_to_debit_micros,
          estimatedUsdtAtomic: saved.estimated_usdt_atomic,
          networkFeeUsdtAtomic: saved.network_fee_usdt_atomic,
          providerFeeUsdtAtomic: saved.provider_fee_usdt_atomic,
          rateSnapshotId: saved.rate_snapshot_id,
          reviewOnly: true,
        },
      });
      return mapQuoteWithSnapshot(saved, rateSnapshot);
    });
  }

  async function confirmWithdrawal(input: {
    userId: string;
    quoteId: unknown;
    idempotencyKey: unknown;
  }): Promise<{ withdrawalRequest: CoinWithdrawalRequest; balance: CoinBalance; idempotent: boolean }> {
    const quoteId = requiredUuidLike(input.quoteId, "Withdrawal quote id is required.");
    const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);

    return options.db.transaction(async (tx) => {
      const existing = await findWithdrawalByIdempotency(tx, input.userId, idempotencyKey, true);
      if (existing) {
        if (existing.withdrawal_quote_id !== quoteId) {
          throw new CoinWalletError(
            "IDEMPOTENCY_KEY_REUSE_MISMATCH",
            "Idempotency key was used for another withdrawal quote.",
            409,
          );
        }
        return {
          withdrawalRequest: mapWithdrawal(existing),
          balance: await new PostgresCoinLedgerRepository(tx).getBalance(input.userId),
          idempotent: true,
        };
      }

      const quoteResult = await tx.query<QuoteRow>(
        `select ${quoteColumns}
         from withdrawal_quotes
         where id = $1 and user_id = $2
         for update`,
        [quoteId, input.userId],
      );
      const quote = quoteResult.rows[0];
      if (!quote) {
        throw new CoinWalletError(
          "WITHDRAWAL_QUOTE_NOT_FOUND",
          "Withdrawal quote was not found.",
          404,
        );
      }
      if (quote.status === "consumed") {
        throw new CoinWalletError(
          "WITHDRAWAL_QUOTE_ALREADY_USED",
          "Withdrawal quote was already consumed.",
          409,
        );
      }
      if (quote.status !== "open" || Date.parse(toIsoString(quote.expires_at)) <= now().getTime()) {
        if (quote.status === "open") {
          await tx.query(`update withdrawal_quotes set status = 'expired' where id = $1`, [quote.id]);
        }
        throw new CoinWalletError(
          "WITHDRAWAL_QUOTE_EXPIRED",
          "Withdrawal quote has expired.",
          409,
        );
      }

      const requestId = randomUUID();
      const coins = new PostgresCoinLedgerRepository(tx);
      const reserveEntry = await coins.postEntry({
        userId: input.userId,
        operationType: "withdrawal_reserve",
        availableDeltaCoinMicros: -BigInt(quote.coin_to_debit_micros),
        reservedDeltaCoinMicros: BigInt(quote.coin_to_debit_micros),
        idempotencyKey: `withdrawal:${requestId}:reserve`,
        sourceType: "withdrawal_request",
        sourceId: requestId,
        reason: "withdrawal_requested",
        rateSnapshotId: quote.rate_snapshot_id,
        auditMetadata: {
          withdrawalQuoteId: quote.id,
          destinationAddress: quote.destination_address,
          estimatedUsdtAtomic: quote.estimated_usdt_atomic,
          reviewOnly: true,
        },
      });

      const metadata = {
        coinReservedMicros: quote.coin_to_debit_micros,
        estimatedUsdtAtomic: quote.estimated_usdt_atomic,
        networkFeeUsdtAtomic: quote.network_fee_usdt_atomic,
        providerFeeUsdtAtomic: quote.provider_fee_usdt_atomic,
        withdrawalQuoteId: quote.id,
        reserveLedgerEntryId: reserveEntry.id,
        reviewOnly: true,
        source: "coin_withdrawal",
      };
      const result = await tx.query<WithdrawalRow>(
        `insert into wallet_withdrawal_requests (
           id, user_id, asset, network, destination_address, amount, status,
           idempotency_key, provider, real_transfer_blocked, block_reason,
           metadata, request_fingerprint, withdrawal_quote_id, coin_reserved_micros,
           estimated_usdt_atomic, network_fee_usdt_atomic, provider_fee_usdt_atomic,
           reserve_ledger_entry_id, created_at, updated_at
         ) values (
           $1, $2, 'USDT', 'TRON', $3, $4::numeric, 'pending_review',
           $5, 'internal_wallet', true, 'TRANSFERS_UNAVAILABLE',
           $6::jsonb, $7, $8, $9::bigint, $10::bigint, $11::bigint, $12::bigint,
           $13, $14, $14
         )
         returning ${withdrawalColumns}`,
        [
          requestId,
          input.userId,
          quote.destination_address,
          formatAtomic(BigInt(quote.estimated_usdt_atomic), 6),
          idempotencyKey,
          JSON.stringify(metadata),
          hashJson({ quoteId: quote.id, idempotencyKey }),
          quote.id,
          quote.coin_to_debit_micros,
          quote.estimated_usdt_atomic,
          quote.network_fee_usdt_atomic,
          quote.provider_fee_usdt_atomic,
          reserveEntry.id,
          now().toISOString(),
        ],
      );
      const saved = requireRow(result.rows[0], "Withdrawal request insert returned no row.");
      await tx.query(`update withdrawal_quotes set status = 'consumed' where id = $1`, [quote.id]);
      await insertAudit(tx, {
        eventType: "wallet.withdrawal_coin_reserved",
        userId: input.userId,
        metadata: {
          withdrawalRequestId: saved.id,
          withdrawalQuoteId: quote.id,
          reserveLedgerEntryId: reserveEntry.id,
          coinReservedMicros: quote.coin_to_debit_micros,
          availableAfterCoinMicros: reserveEntry.availableAfterCoinMicros,
          reservedAfterCoinMicros: reserveEntry.reservedAfterCoinMicros,
          reviewOnly: true,
        },
      });
      await insertOutbox(tx, {
        aggregateType: "withdrawal",
        aggregateId: saved.id,
        eventType: "withdrawal.pending_review",
        idempotencyKey: `withdrawal:${saved.id}:pending-review`,
        payload: {
          userId: input.userId,
          coinReservedMicros: quote.coin_to_debit_micros,
          estimatedUsdtAtomic: quote.estimated_usdt_atomic,
          reviewOnly: true,
        },
      });
      return {
        withdrawalRequest: mapWithdrawal(saved),
        balance: await coins.getBalance(input.userId),
        idempotent: false,
      };
    });
  }

  async function cancelWithdrawal(input: {
    userId: string;
    withdrawalId: string;
    reason?: unknown;
  }) {
    return releaseWithdrawal({
      withdrawalId: input.withdrawalId,
      userId: input.userId,
      targetStatus: "cancelled",
      actor: null,
      reason: optionalReason(input.reason) ?? "user_cancelled",
    });
  }

  async function rejectWithdrawal(input: {
    withdrawalId: string;
    adminActor: string;
    reason: unknown;
  }) {
    return releaseWithdrawal({
      withdrawalId: input.withdrawalId,
      userId: null,
      targetStatus: "rejected",
      actor: requiredActor(input.adminActor),
      reason: requiredReason(input.reason),
    });
  }

  async function approveWithdrawalForReview(input: {
    withdrawalId: string;
    adminActor: string;
    reason: unknown;
  }) {
    const actor = requiredActor(input.adminActor);
    const reason = requiredReason(input.reason);
    return options.db.transaction(async (tx) => {
      const request = await findWithdrawalForUpdate(tx, input.withdrawalId);
      if (!request) {
        throw new CoinWalletError("WITHDRAWAL_NOT_FOUND", "Withdrawal was not found.", 404);
      }
      if (request.status === "approved_for_review") {
        return {
          withdrawalRequest: mapWithdrawal(request),
          idempotent: true,
          broadcastAttempted: false as const,
          reviewOnly: true as const,
        };
      }
      if (request.status !== "pending_review") {
        throw new CoinWalletError(
          "WITHDRAWAL_NOT_REVIEWABLE",
          "Withdrawal is not pending review.",
          409,
        );
      }
      const result = await tx.query<WithdrawalRow>(
        `update wallet_withdrawal_requests
         set status = 'approved_for_review', review_reason = $2,
             reviewed_by_actor = $3, reviewed_at = $4, updated_at = $4,
             metadata = metadata || $5::jsonb
         where id = $1
         returning ${withdrawalColumns}`,
        [
          request.id,
          reason,
          actor,
          now().toISOString(),
          JSON.stringify({
            reviewOnly: true,
            broadcastAttempted: false,
            adminActor: actor,
            reviewReason: reason,
          }),
        ],
      );
      const updated = requireRow(result.rows[0], "Withdrawal review update returned no row.");
      await insertAudit(tx, {
        eventType: "admin.withdrawal_approved_for_review",
        userId: updated.user_id,
        metadata: {
          withdrawalRequestId: updated.id,
          adminActor: actor,
          reason,
          coinReservedMicros: updated.coin_reserved_micros,
          broadcastAttempted: false,
          reviewOnly: true,
        },
      });
      await insertOutbox(tx, {
        aggregateType: "withdrawal",
        aggregateId: updated.id,
        eventType: "withdrawal.approved_for_review",
        idempotencyKey: `withdrawal:${updated.id}:approved-for-review`,
        payload: {
          userId: updated.user_id,
          adminActor: actor,
          broadcastAttempted: false,
          reviewOnly: true,
        },
      });
      return {
        withdrawalRequest: mapWithdrawal(updated),
        idempotent: false,
        broadcastAttempted: false as const,
        reviewOnly: true as const,
      };
    });
  }

  async function safeRetryWithdrawal(input: {
    withdrawalId: string;
    adminActor: string;
    reason: unknown;
  }) {
    const request = await options.db.query<WithdrawalRow>(
      `${withdrawalSelectSql} where id = $1 limit 1`,
      [input.withdrawalId],
    );
    const row = request.rows[0];
    if (!row) {
      throw new CoinWalletError("WITHDRAWAL_NOT_FOUND", "Withdrawal was not found.", 404);
    }
    if (row.status === "approved_for_review") {
      return {
        withdrawalRequest: mapWithdrawal(row),
        idempotent: true,
        broadcastAttempted: false as const,
        reviewOnly: true as const,
        retryBlockedReason: REVIEW_ONLY_BLOCK_REASON,
      };
    }
    if (row.status === "failed") {
      return {
        withdrawalRequest: mapWithdrawal(row),
        idempotent: true,
        broadcastAttempted: false as const,
        reviewOnly: true as const,
        retryBlockedReason: withdrawalRetryBlockedReason(row.failure_state),
      };
    }
    const result = await approveWithdrawalForReview(input);
    return { ...result, retryBlockedReason: REVIEW_ONLY_BLOCK_REASON };
  }

  async function reconcileVerifiedWithdrawalOutcome(input: {
    withdrawalId: string;
    outcome: VerifiedWithdrawalProviderOutcome;
  }) {
    const outcome = validateVerifiedWithdrawalOutcome(input.outcome);
    const initialResult = await options.db.query<WithdrawalRow>(
      `${withdrawalSelectSql}
       where id = $1 and withdrawal_quote_id is not null
       limit 1`,
      [input.withdrawalId],
    );
    const initial = initialResult.rows[0];
    if (!initial) {
      throw new CoinWalletError("WITHDRAWAL_NOT_FOUND", "Withdrawal was not found.", 404);
    }

    let finalQuote: UsdQuote | null = null;
    let expectedFinalUsdtAtomic: UsdtAtomic | null = null;
    let finalNetworkFee = usdtAtomic(BigInt(initial.network_fee_usdt_atomic ?? "0"));
    let finalProviderFee = usdtAtomic(BigInt(initial.provider_fee_usdt_atomic ?? "0"));
    let providerFinalAmount: UsdtAtomic | null = null;
    let finalQuoteError: CoinWalletError | null = null;

    if (outcome.state === "completed") {
      try {
        const reserved = coinMicros(BigInt(initial.coin_reserved_micros ?? "0"), false);
        finalNetworkFee = parseOptionalAtomicFee(
          outcome.networkFeeUsdtAtomic,
          finalNetworkFee,
        );
        finalProviderFee = parseOptionalAtomicFee(
          outcome.providerFeeUsdtAtomic,
          finalProviderFee,
        );
        providerFinalAmount = parsePositiveUsdtAtomic(outcome.finalUsdtAtomic);
        finalQuote = validateUsdQuote(
          await options.rateProvider.getUsdQuote({
            asset: SUPPORTED_SETTLEMENT_ASSET,
            network: SUPPORTED_SETTLEMENT_NETWORK,
            amountUsdtAtomic: usdtAtomic(reserved),
            purpose: "withdrawal_final",
          }),
          {
            ttlSeconds: options.rateTtlSeconds,
            now: now(),
            expectedPurpose: "withdrawal_final",
            expectedKind: "final",
            expectedAmountUsdtAtomic: usdtAtomic(reserved),
          },
        );
        const gross = coinMicrosToUsdt(reserved, finalQuote.usdRateNanos, "down");
        const fees = finalNetworkFee + finalProviderFee;
        if (gross <= fees) {
          throw new CoinWalletError(
            "INVALID_USDT_AMOUNT",
            "Final withdrawal fees consume the entire amount.",
            409,
          );
        }
        expectedFinalUsdtAtomic = usdtAtomic(gross - fees, false);
      } catch (error) {
        finalQuoteError =
          error instanceof CoinWalletError ? error : mapRateError(error);
      }
    }

    return options.db.transaction(async (tx) => {
      const request = await findWithdrawalForUpdate(tx, input.withdrawalId);
      if (!request) {
        throw new CoinWalletError("WITHDRAWAL_NOT_FOUND", "Withdrawal was not found.", 404);
      }
      if (request.final_ledger_entry_id) {
        return {
          withdrawalRequest: mapWithdrawal(request),
          idempotent: true,
          providerCallInitiated: false as const,
          ledgerEntry: await findCoinEntry(tx, request.final_ledger_entry_id),
        };
      }

      if (outcome.state === "unknown") {
        const updated = await recordWithdrawalFailureState(tx, {
          request,
          outcome,
          failureState: "PROVIDER_STATE_UNKNOWN",
          releaseReserve: false,
          currentTime: now(),
        });
        return {
          ...updated,
          providerCallInitiated: false as const,
          reserveHeld: true as const,
        };
      }

      if (outcome.state === "failed") {
        const updated = await recordWithdrawalFailureState(tx, {
          request,
          outcome,
          failureState: PROVIDER_CONFIRMED_FAILED,
          releaseReserve: true,
          currentTime: now(),
        });
        return {
          ...updated,
          providerCallInitiated: false as const,
          reserveHeld: false as const,
        };
      }

      if (
        finalQuoteError ||
        !finalQuote ||
        !expectedFinalUsdtAtomic ||
        !providerFinalAmount ||
        expectedFinalUsdtAtomic !== providerFinalAmount ||
        !outcome.transactionHash
      ) {
        const mismatchReason = finalQuoteError
          ? finalQuoteError.code
          : !outcome.transactionHash
            ? "PROVIDER_TRANSACTION_HASH_REQUIRED"
            : "FINAL_AMOUNT_RATE_MISMATCH";
        const updated = await recordWithdrawalFailureState(tx, {
          request,
          outcome,
          failureState: mismatchReason,
          releaseReserve: false,
          currentTime: now(),
        });
        return {
          ...updated,
          accepted: false as const,
          providerCallInitiated: false as const,
          reserveHeld: true as const,
        };
      }
      if (request.release_ledger_entry_id) {
        const updated = await recordWithdrawalFailureState(tx, {
          request,
          outcome,
          failureState: "PROVIDER_COMPLETED_AFTER_RESERVE_RELEASE",
          releaseReserve: false,
          currentTime: now(),
        });
        return {
          ...updated,
          accepted: false as const,
          providerCallInitiated: false as const,
          reserveHeld: false as const,
        };
      }

      const reserved = BigInt(request.coin_reserved_micros ?? "0");
      const snapshot = await insertRateSnapshot(tx, finalQuote);
      const coins = new PostgresCoinLedgerRepository(tx);
      const debit = await coins.postEntry({
        userId: request.user_id,
        operationType: "withdrawal_debit",
        availableDeltaCoinMicros: 0n,
        reservedDeltaCoinMicros: -reserved,
        idempotencyKey: `withdrawal:${request.id}:final-debit`,
        sourceType: "withdrawal_request",
        sourceId: request.id,
        externalReference: outcome.providerReference,
        rateSnapshotId: snapshot.id,
        reason: "verified_provider_withdrawal_completed",
        auditMetadata: {
          provider: outcome.provider,
          providerReference: outcome.providerReference,
          transactionHash: outcome.transactionHash,
          evidenceHash: outcome.evidenceHash,
          observedAt: outcome.observedAt,
          providerCallInitiated: false,
          externallyObserved: true,
        },
      });
      const result = await tx.query<WithdrawalRow>(
        `update wallet_withdrawal_requests
         set status = 'broadcasted', provider = $11,
             real_transfer_blocked = false, block_reason = null,
             coin_debited_micros = $2::bigint, final_usdt_atomic = $3::bigint,
             network_fee_usdt_atomic = $4::bigint, provider_fee_usdt_atomic = $5::bigint,
             final_rate_snapshot_id = $6, fireblocks_reference = $7,
             final_ledger_entry_id = $8, failure_state = null, updated_at = $9,
             metadata = metadata || $10::jsonb
         where id = $1
         returning ${withdrawalColumns}`,
        [
          request.id,
          reserved.toString(),
          expectedFinalUsdtAtomic.toString(),
          finalNetworkFee.toString(),
          finalProviderFee.toString(),
          snapshot.id,
          outcome.providerReference,
          debit.id,
          outcome.observedAt,
          JSON.stringify({
            source: "real_withdrawal_broadcast",
            providerWithdrawalId: outcome.providerReference,
            txHash: outcome.transactionHash,
            providerEvidenceHash: outcome.evidenceHash,
            providerOutcomeObservedAt: outcome.observedAt,
            providerCallInitiated: false,
            externallyObserved: true,
          }),
          outcome.provider,
        ],
      );
      const updated = requireRow(result.rows[0], "Final withdrawal debit returned no row.");
      await insertAudit(tx, {
        eventType: "wallet.withdrawal_verified_completed",
        userId: request.user_id,
        metadata: {
          withdrawalRequestId: request.id,
          finalLedgerEntryId: debit.id,
          finalRateSnapshotId: snapshot.id,
          coinDebitedMicros: reserved.toString(),
          finalUsdtAtomic: expectedFinalUsdtAtomic.toString(),
          fireblocksReference: outcome.providerReference,
          transactionHash: outcome.transactionHash,
          providerCallInitiated: false,
          externallyObserved: true,
        },
      });
      await insertOutbox(tx, {
        aggregateType: "withdrawal",
        aggregateId: request.id,
        eventType: "withdrawal.verified_completed",
        idempotencyKey: `withdrawal:${request.id}:verified-completed`,
        payload: {
          userId: request.user_id,
          finalLedgerEntryId: debit.id,
          finalRateSnapshotId: snapshot.id,
          finalUsdtAtomic: expectedFinalUsdtAtomic.toString(),
          transactionHash: outcome.transactionHash,
        },
      });
      return {
        withdrawalRequest: mapWithdrawal(updated),
        balance: await coins.getBalance(request.user_id),
        ledgerEntry: debit,
        rateSnapshot: snapshot,
        idempotent: false,
        accepted: true as const,
        providerCallInitiated: false as const,
        reserveHeld: false as const,
      };
    });
  }

  async function createCorrection(input: {
    userId: string;
    deltaCoinMicros: unknown;
    idempotencyKey: unknown;
    adminActor: string;
    reason: unknown;
    relatedEntityType: unknown;
    relatedEntityId: unknown;
  }) {
    const delta = parseSignedCoinDelta(input.deltaCoinMicros);
    const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
    const actor = requiredActor(input.adminActor);
    const reason = requiredReason(input.reason);
    const relatedEntityType = requiredText(input.relatedEntityType, "Related entity type is required.");
    const relatedEntityId = requiredText(input.relatedEntityId, "Related entity id is required.");
    const requestedAuditId = randomUUID();

    return options.db.transaction(async (tx) => {
      const coins = new PostgresCoinLedgerRepository(tx);
      const entry = await coins.postEntry({
        userId: input.userId,
        operationType: delta > 0n ? "correction_credit" : "correction_debit",
        availableDeltaCoinMicros: delta,
        idempotencyKey,
        sourceType: relatedEntityType,
        sourceId: relatedEntityId,
        reason,
        adminActor: actor,
        auditMetadata: {
          auditId: requestedAuditId,
          adminActor: actor,
          relatedEntityType,
          relatedEntityId,
          compensatingCorrection: true,
        },
      });
      const auditId =
        typeof entry.auditMetadata.auditId === "string"
          ? entry.auditMetadata.auditId
          : requestedAuditId;
      await tx.query(
        `insert into audit_logs (id, event_type, user_id, metadata, created_at)
         values ($1, 'admin.coin_correction', $2, $3::jsonb, $4)
         on conflict (id) do nothing`,
        [
          auditId,
          input.userId,
          JSON.stringify({
            adminActor: actor,
            reason,
            relatedEntityType,
            relatedEntityId,
            coinLedgerEntryId: entry.id,
            deltaCoinMicros: entry.availableDeltaCoinMicros,
            beforeBalance: {
              availableCoinMicros: (
                BigInt(entry.availableAfterCoinMicros) - BigInt(entry.availableDeltaCoinMicros)
              ).toString(),
              reservedCoinMicros: (
                BigInt(entry.reservedAfterCoinMicros) - BigInt(entry.reservedDeltaCoinMicros)
              ).toString(),
            },
            afterBalance: {
              availableCoinMicros: entry.availableAfterCoinMicros,
              reservedCoinMicros: entry.reservedAfterCoinMicros,
            },
            compensatingCorrection: true,
          }),
          now().toISOString(),
        ],
      );
      await insertOutbox(tx, {
        aggregateType: "coin_account",
        aggregateId: input.userId,
        eventType: "coin_account.corrected",
        idempotencyKey: `coin-correction:${entry.id}`,
        payload: {
          auditId,
          adminActor: actor,
          coinLedgerEntryId: entry.id,
          deltaCoinMicros: entry.availableDeltaCoinMicros,
        },
      });
      return {
        auditId,
        ledgerEntry: entry,
        balance: await coins.getBalance(input.userId),
      };
    });
  }

  async function getWithdrawal(userId: string, withdrawalId: string) {
    const result = await options.db.query<WithdrawalRow>(
      `${withdrawalSelectSql} where id = $1 and user_id = $2 limit 1`,
      [withdrawalId, userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new CoinWalletError("WITHDRAWAL_NOT_FOUND", "Withdrawal was not found.", 404);
    }
    return mapWithdrawal(row);
  }

  async function getDepositAddress(userId: string) {
    const result = await options.db.query<{
      id: string;
      address: string;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `select id, address, created_at, updated_at
       from wallets
       where user_id = $1 and asset = 'USDT' and network = 'TRON'
         and provider = 'fireblocks' and status = 'active' and address is not null
       order by created_at desc
       limit 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row || !isValidTronAddress(row.address)) {
      throw new CoinWalletError(
        "DEPOSIT_ADDRESS_UNAVAILABLE",
        "A verified Fireblocks TRON deposit address is not available.",
        503,
      );
    }
    return {
      wallet: {
        id: row.id,
        userId,
        asset: SUPPORTED_SETTLEMENT_ASSET,
        network: SUPPORTED_SETTLEMENT_NETWORK,
        provider: "fireblocks" as const,
        address: row.address,
        status: "active" as const,
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
      },
      instructions: {
        rail: "TRC-20" as const,
        tokenContract: options.usdtTronContract,
        requiredConfirmations: String(options.requiredConfirmations),
        doNotSubmitTransactionHash: true,
      },
      reviewOnly: !options.allowDepositCredits,
    };
  }

  async function listWithdrawals(userId: string) {
    const result = await options.db.query<WithdrawalRow>(
      `${withdrawalSelectSql} where user_id = $1 order by created_at desc limit 200`,
      [userId],
    );
    return result.rows.map(mapWithdrawal);
  }

  async function listDeposits(userId: string) {
    const result = await options.db.query<DepositRow>(
      `${depositSelectSql} where user_id = $1 order by created_at desc limit 200`,
      [userId],
    );
    return result.rows.map(mapDeposit);
  }

  async function getAdminMoneyUser(userId: string) {
    const coins = new PostgresCoinLedgerRepository(options.db);
    const [balance, ledger, deposits, withdrawals] = await Promise.all([
      coins.getBalance(userId),
      coins.listEntries(userId, 200),
      listDeposits(userId),
      listWithdrawals(userId),
    ]);
    return { userId, balance, ledger, deposits, withdrawals };
  }

  async function listAdminDeposits(limit = 100) {
    const result = await options.db.query<DepositRow>(
      `${depositSelectSql} order by created_at desc limit $1`,
      [clampLimit(limit)],
    );
    return result.rows.map(mapDeposit);
  }

  async function getAdminDepositDetail(depositId: string) {
    const result = await options.db.query<DepositRow>(
      `${depositSelectSql} where id = $1 limit 1`,
      [depositId],
    );
    const deposit = result.rows[0];
    if (!deposit) {
      throw new CoinWalletError("DEPOSIT_NOT_FOUND", "Crypto deposit was not found.", 404);
    }
    const providerEvent = deposit.last_provider_event_id
      ? await options.db.query<{
          id: string;
          provider: string;
          provider_event_id: string;
          event_type: string;
          provider_transaction_id: string | null;
          payload: Record<string, unknown>;
          payload_hash: string;
          received_at: Date | string;
        }>(
          `select id, provider, provider_event_id, event_type, provider_transaction_id,
                  payload, payload_hash, received_at
           from money_provider_events where id = $1 limit 1`,
          [deposit.last_provider_event_id],
        )
      : null;
    const event = providerEvent?.rows[0] ?? null;
    return {
      deposit: mapDeposit(deposit),
      providerEvent: event
        ? {
            id: event.id,
            provider: event.provider,
            providerEventId: event.provider_event_id,
            eventType: event.event_type,
            providerTransactionId: event.provider_transaction_id,
            payload: event.payload,
            payloadHash: event.payload_hash,
            receivedAt: toIsoString(event.received_at),
          }
        : null,
      rateSnapshot: deposit.rate_snapshot_id
        ? await findRateSnapshot(options.db, deposit.rate_snapshot_id)
        : null,
      ledgerEntry: deposit.ledger_entry_id
        ? await findCoinEntry(options.db, deposit.ledger_entry_id)
        : null,
      reversalLedgerEntry: deposit.reversal_ledger_entry_id
        ? await findCoinEntry(options.db, deposit.reversal_ledger_entry_id)
        : null,
    };
  }

  async function listAdminWithdrawals(limit = 100) {
    const result = await options.db.query<WithdrawalRow>(
      `${withdrawalSelectSql} order by created_at desc limit $1`,
      [clampLimit(limit)],
    );
    return result.rows.map(mapWithdrawal);
  }

  async function releaseWithdrawal(input: {
    withdrawalId: string;
    userId: string | null;
    targetStatus: "cancelled" | "rejected";
    actor: string | null;
    reason: string;
  }) {
    return options.db.transaction(async (tx) => {
      const request = await findWithdrawalForUpdate(tx, input.withdrawalId, input.userId);
      if (!request) {
        throw new CoinWalletError("WITHDRAWAL_NOT_FOUND", "Withdrawal was not found.", 404);
      }
      if (request.status === input.targetStatus && request.release_ledger_entry_id) {
        return {
          withdrawalRequest: mapWithdrawal(request),
          balance: await new PostgresCoinLedgerRepository(tx).getBalance(request.user_id),
          idempotent: true,
        };
      }
      if (!canReleaseWithdrawalReserve(request.status, request.failure_state)) {
        throw new CoinWalletError(
          "WITHDRAWAL_NOT_CANCELLABLE",
          "Withdrawal reserve stays locked until the provider failure is conclusively verified.",
          409,
        );
      }
      if (
        !["pending_review", "approved_for_review", "failed"].includes(request.status) ||
        request.final_ledger_entry_id ||
        request.status === "broadcasted"
      ) {
        throw new CoinWalletError(
          "WITHDRAWAL_NOT_CANCELLABLE",
          "Withdrawal reserve cannot be released in its current state.",
          409,
        );
      }
      const reserved = BigInt(request.coin_reserved_micros ?? "0");
      if (reserved <= 0n || !request.reserve_ledger_entry_id) {
        throw new CoinWalletError(
          "WITHDRAWAL_NOT_CANCELLABLE",
          "Withdrawal does not have an active Coin reserve.",
          409,
        );
      }
      const coins = new PostgresCoinLedgerRepository(tx);
      const existingRelease =
        request.status === "failed" &&
        request.failure_state === PROVIDER_CONFIRMED_FAILED &&
        request.release_ledger_entry_id
          ? await findCoinEntry(tx, request.release_ledger_entry_id)
          : null;
      const release =
        existingRelease ??
        (await coins.postEntry({
          userId: request.user_id,
          operationType: "withdrawal_release",
          availableDeltaCoinMicros: reserved,
          reservedDeltaCoinMicros: -reserved,
          idempotencyKey: `withdrawal:${request.id}:release`,
          sourceType: "withdrawal_request",
          sourceId: request.id,
          reason: input.reason,
          adminActor: input.actor,
          auditMetadata: {
            targetStatus: input.targetStatus,
            adminActor: input.actor,
            reserveLedgerEntryId: request.reserve_ledger_entry_id,
          },
        }));
      const result = await tx.query<WithdrawalRow>(
        `update wallet_withdrawal_requests
         set status = $2, real_transfer_blocked = true,
             block_reason = 'TRANSFERS_UNAVAILABLE',
             release_ledger_entry_id = $3, review_reason = $4,
             reviewed_by_actor = coalesce($5, reviewed_by_actor),
             reviewed_at = case when $5::text is null then reviewed_at else $6 end,
             updated_at = $6,
             metadata = metadata || $7::jsonb
         where id = $1
         returning ${withdrawalColumns}`,
        [
          request.id,
          input.targetStatus,
          release.id,
          input.reason,
          input.actor,
          now().toISOString(),
          JSON.stringify({
            coinReleaseLedgerEntryId: release.id,
            releaseReason: input.reason,
            adminActor: input.actor,
          }),
        ],
      );
      const updated = requireRow(result.rows[0], "Withdrawal release update returned no row.");
      await insertAudit(tx, {
        eventType:
          input.targetStatus === "cancelled"
            ? "wallet.withdrawal_cancelled"
            : "admin.withdrawal_rejected",
        userId: request.user_id,
        metadata: {
          withdrawalRequestId: request.id,
          adminActor: input.actor,
          reason: input.reason,
          releaseLedgerEntryId: release.id,
          coinReleasedMicros: reserved.toString(),
          availableAfterCoinMicros: release.availableAfterCoinMicros,
          reservedAfterCoinMicros: release.reservedAfterCoinMicros,
          reviewOnly: true,
        },
      });
      await insertOutbox(tx, {
        aggregateType: "withdrawal",
        aggregateId: request.id,
        eventType: `withdrawal.${input.targetStatus}`,
        idempotencyKey: `withdrawal:${request.id}:${input.targetStatus}`,
        payload: {
          userId: request.user_id,
          coinReleasedMicros: reserved.toString(),
          releaseLedgerEntryId: release.id,
        },
      });
      return {
        withdrawalRequest: mapWithdrawal(updated),
        balance: await coins.getBalance(request.user_id),
        idempotent: false,
      };
    });
  }

  async function withCutoverReady<T>(operation: () => Promise<T>): Promise<T> {
    const state = await options.db.query<{ active_system: string }>(
      `select active_system
       from money_system_state
       where singleton = true`,
    );
    if (state.rows[0]?.active_system !== "coin") {
      throw new CoinWalletError(
        "COIN_CUTOVER_INCOMPLETE",
        "Coin money operations are unavailable until the controlled cutover completes.",
        503,
      );
    }
    return operation();
  }

  return {
    createDepositIntent: (input: Parameters<typeof createDepositIntent>[0]) =>
      withCutoverReady(() => createDepositIntent(input)),
    processFireblocksWebhook: (
      input: Parameters<typeof processFireblocksWebhook>[0],
    ) => withCutoverReady(() => processFireblocksWebhook(input)),
    retryDeposit: (input: Parameters<typeof retryDeposit>[0]) =>
      withCutoverReady(() => retryDeposit(input)),
    createWithdrawalQuote: (
      input: Parameters<typeof createWithdrawalQuote>[0],
    ) => withCutoverReady(() => createWithdrawalQuote(input)),
    confirmWithdrawal: (input: Parameters<typeof confirmWithdrawal>[0]) =>
      withCutoverReady(() => confirmWithdrawal(input)),
    cancelWithdrawal: (input: Parameters<typeof cancelWithdrawal>[0]) =>
      withCutoverReady(() => cancelWithdrawal(input)),
    rejectWithdrawal: (input: Parameters<typeof rejectWithdrawal>[0]) =>
      withCutoverReady(() => rejectWithdrawal(input)),
    approveWithdrawalForReview: (
      input: Parameters<typeof approveWithdrawalForReview>[0],
    ) => withCutoverReady(() => approveWithdrawalForReview(input)),
    safeRetryWithdrawal: (
      input: Parameters<typeof safeRetryWithdrawal>[0],
    ) => withCutoverReady(() => safeRetryWithdrawal(input)),
    reconcileVerifiedWithdrawalOutcome: (
      input: Parameters<typeof reconcileVerifiedWithdrawalOutcome>[0],
    ) => withCutoverReady(() => reconcileVerifiedWithdrawalOutcome(input)),
    createCorrection: (input: Parameters<typeof createCorrection>[0]) =>
      withCutoverReady(() => createCorrection(input)),
    getDepositAddress: (userId: string) =>
      withCutoverReady(() => getDepositAddress(userId)),
    getWithdrawal: (userId: string, withdrawalId: string) =>
      withCutoverReady(() => getWithdrawal(userId, withdrawalId)),
    listWithdrawals: (userId: string) =>
      withCutoverReady(() => listWithdrawals(userId)),
    listDeposits: (userId: string) =>
      withCutoverReady(() => listDeposits(userId)),
    getAdminMoneyUser: (userId: string) =>
      withCutoverReady(() => getAdminMoneyUser(userId)),
    listAdminDeposits: (limit?: number) =>
      withCutoverReady(() => listAdminDeposits(limit)),
    getAdminDepositDetail: (depositId: string) =>
      withCutoverReady(() => getAdminDepositDetail(depositId)),
    listAdminWithdrawals: (limit?: number) =>
      withCutoverReady(() => listAdminWithdrawals(limit)),
    reviewOnly: true as const,
    providerName: options.rateProvider.providerName,
  };
}

export type CoinWalletService = ReturnType<typeof buildCoinWalletService>;

async function storeProviderEvent(
  tx: Queryable,
  parsed: ParsedFireblocksDeposit,
  receivedAt: Date,
) {
  const id = randomUUID();
  const inserted = await tx.query<{ id: string; payload_hash: string }>(
    `insert into money_provider_events (
       id, provider, provider_event_id, event_type, provider_transaction_id,
       payload, payload_hash, received_at, created_at
     ) values ($1, 'fireblocks', $2, $3, $4, $5::jsonb, $6, $7, $7)
     on conflict (provider, provider_event_id) do nothing
     returning id, payload_hash`,
    [
      id,
      parsed.providerEventId,
      parsed.providerEventType,
      parsed.providerTransactionId,
      JSON.stringify(parsed.payload),
      parsed.payloadHash,
      receivedAt.toISOString(),
    ],
  );
  const created = inserted.rows[0];
  if (created) {
    return { id: created.id, payloadHash: created.payload_hash, existing: false };
  }
  const existing = await tx.query<{ id: string; payload_hash: string }>(
    `select id, payload_hash
     from money_provider_events
     where provider = 'fireblocks' and provider_event_id = $1
     limit 1`,
    [parsed.providerEventId],
  );
  const row = requireRow(existing.rows[0], "Provider event conflict returned no row.");
  return { id: row.id, payloadHash: row.payload_hash, existing: true };
}

async function lockOrCreateDeposit(
  tx: Queryable,
  parsed: ParsedFireblocksDeposit,
  providerEventId: string,
  requiredConfirmations: number,
  currentTime: Date,
): Promise<LockedOrCreatedDeposit | null> {
  const chainKey = [
    parsed.network || "unknown",
    parsed.blockchainTxHash,
    parsed.tokenContract,
    parsed.eventIndex,
    parsed.destinationAddress,
  ].join(":");
  await tx.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [chainKey]);

  const values: unknown[] = [
    parsed.blockchainTxHash,
    parsed.tokenContract,
    parsed.eventIndex,
    parsed.destinationAddress,
    parsed.providerTransactionId,
  ];
  const existing = await tx.query<DepositRow>(
    `${depositSelectSql}
     where (
       network = 'TRON' and blockchain_tx_hash = $1 and token_contract = $2
       and event_index = $3 and destination_address = $4
     )
     or (
       provider = 'fireblocks' and $5::text is not null and provider_transaction_id = $5
     )
     order by created_at asc
     limit 1
     for update`,
    values,
  );
  const row = existing.rows[0];
  if (row) {
    const immutableConflict = compareDepositImmutableFields(row, parsed);
    const conflict = immutableConflict !== null;
    const status =
      conflict && !isDepositFinancialStateImmutable(row.status)
        ? "manual_review"
        : row.status;
    const updated = await tx.query<DepositRow>(
      `update crypto_deposits
       set provider_event_id = $2,
           provider_transaction_id = case
             when $7::text is null then coalesce(provider_transaction_id, $3)
             else provider_transaction_id
           end,
           fireblocks_transaction_id = case
             when $7::text is null then coalesce(fireblocks_transaction_id, $3)
             else fireblocks_transaction_id
           end,
           last_provider_event_id = $4,
           actual_confirmations = greatest(actual_confirmations, $5),
           status = $6,
           manual_review_reason = case
             when $7::text is null then manual_review_reason else $7
           end,
           updated_at = $8
       where id = $1
       returning ${depositColumns}`,
      [
        row.id,
        parsed.providerEventId,
        parsed.providerTransactionId,
        providerEventId,
        parsed.confirmations,
        status,
        conflict ? DEPOSIT_IMMUTABLE_FIELDS_CONFLICT : null,
        currentTime.toISOString(),
      ],
    );
    return {
      deposit: requireRow(updated.rows[0], "Crypto deposit update returned no row."),
      immutableConflict,
    };
  }

  const intentMatch = await findDepositIntent(tx, parsed, currentTime);
  const intent = intentMatch.intent;
  const net = calculateNetUsdt(parsed);
  const id = randomUUID();
  const invalidReason =
    parsed.validationIssues[0] ?? intentMatch.manualReviewReason;
  const status: CoinDepositStatus = invalidReason ? "manual_review" : "detected";
  const result = await tx.query<DepositRow>(
    `insert into crypto_deposits (
       id, provider, provider_event_id, provider_transaction_id,
       fireblocks_transaction_id, blockchain_tx_hash, event_index, network,
       token_contract, destination_address, deposit_intent_id, user_id,
       gross_usdt_atomic, network_fee_usdt_atomic, provider_fee_usdt_atomic,
       net_usdt_atomic, last_provider_event_id, required_confirmations,
       actual_confirmations, status, manual_review_reason, idempotency_key,
       detected_at, created_at, updated_at
     ) values (
       $1, 'fireblocks', $2, $3, $3, $4, $5, 'TRON', $6, $7, $8, $9,
       $10::bigint, $11::bigint, $12::bigint, $13::bigint, $14, $15, $16,
       $17, $18, $19, $20, $20, $20
     )
     returning ${depositColumns}`,
    [
      id,
      parsed.providerEventId,
      parsed.providerTransactionId,
      parsed.blockchainTxHash,
      parsed.eventIndex,
      parsed.tokenContract,
      parsed.destinationAddress,
      intent?.id ?? null,
      intent?.user_id ?? null,
      parsed.grossUsdtAtomic.toString(),
      parsed.networkFeeUsdtAtomic.toString(),
      parsed.providerFeeUsdtAtomic.toString(),
      net.toString(),
      providerEventId,
      requiredConfirmations,
      parsed.confirmations,
      status,
      invalidReason,
      `crypto-deposit:${hashText(chainKey)}`,
      currentTime.toISOString(),
    ],
  );
  const deposit = result.rows[0];
  return deposit ? { deposit, immutableConflict: null } : null;
}

async function findDepositIntent(
  tx: Queryable,
  parsed: ParsedFireblocksDeposit,
  currentTime: Date,
) {
  if (
    parsed.asset !== "USDT" ||
    parsed.network !== "TRON" ||
    !parsed.destinationAddress ||
    parsed.validationIssues.includes("INVALID_DESTINATION_ADDRESS")
  ) {
    return { intent: null, manualReviewReason: null };
  }
  const result = await tx.query<IntentRow>(
    `select id, user_id, wallet_id, address,
            trunc(expected_amount * 1000000)::bigint::text as expected_amount,
            status, expires_at
     from wallet_deposit_intents
     where address = $1 and asset = 'USDT' and network = 'TRON'
       and status in ('waiting', 'detected')
       and expires_at > $2
     order by created_at desc
     limit 2
     for update`,
    [parsed.destinationAddress, currentTime.toISOString()],
  );
  const selection = selectUnambiguousDepositIntent(result.rows);
  return {
    intent: selection.value,
    manualReviewReason: selection.ambiguous ? DEPOSIT_INTENT_AMBIGUOUS : null,
  };
}

async function validateDepositForCredit(
  tx: Queryable,
  deposit: DepositRow,
  parsed: ParsedFireblocksDeposit,
  currentTime: Date,
) {
  if (
    deposit.manual_review_reason === DEPOSIT_IMMUTABLE_FIELDS_CONFLICT ||
    deposit.manual_review_reason === DEPOSIT_INTENT_AMBIGUOUS
  ) {
    return deposit.manual_review_reason;
  }
  if (parsed.validationIssues.length > 0) {
    return parsed.validationIssues[0] ?? "INVALID_PROVIDER_EVENT";
  }
  if (parsed.asset !== "USDT") return "UNSUPPORTED_ASSET";
  if (parsed.network !== "TRON") return "UNSUPPORTED_NETWORK";
  if (!isValidTronAddress(parsed.destinationAddress)) return "INVALID_DESTINATION_ADDRESS";
  if (!deposit.deposit_intent_id || !deposit.user_id) return "DEPOSIT_INTENT_MISSING_OR_EXPIRED";
  const effectiveConfirmations =
    BigInt(parsed.confirmations) > BigInt(deposit.actual_confirmations)
      ? BigInt(parsed.confirmations)
      : BigInt(deposit.actual_confirmations);
  if (effectiveConfirmations < BigInt(deposit.required_confirmations)) {
    return "INSUFFICIENT_CONFIRMATIONS";
  }
  const wasAlreadyConfirmed =
    deposit.confirmed_at !== null ||
    ["confirmed_unpriced", "pending_rate", "credited", "reversal_pending", "reversed"].includes(
      deposit.status,
    );
  if (!parsed.confirmed && !wasAlreadyConfirmed) return "PROVIDER_STATUS_NOT_CONFIRMED";
  if (deposit.net_usdt_atomic === "0") return "INVALID_NET_AMOUNT";

  const intentResult = await tx.query<IntentRow>(
    `select id, user_id, wallet_id, address,
            trunc(expected_amount * 1000000)::bigint::text as expected_amount,
            status, expires_at
     from wallet_deposit_intents where id = $1 for update`,
    [deposit.deposit_intent_id],
  );
  const intent = intentResult.rows[0];
  if (!intent || Date.parse(toIsoString(intent.expires_at)) <= currentTime.getTime()) {
    return "DEPOSIT_INTENT_MISSING_OR_EXPIRED";
  }
  if (
    intent.user_id !== deposit.user_id ||
    intent.address !== deposit.destination_address ||
    !["waiting", "detected"].includes(intent.status)
  ) {
    return "DEPOSIT_INTENT_MISMATCH";
  }
  if (!/^\d+$/.test(intent.expected_amount)) {
    return "DEPOSIT_INTENT_AMOUNT_INVALID";
  }
  if (BigInt(intent.expected_amount).toString() !== deposit.gross_usdt_atomic) {
    return "DEPOSIT_AMOUNT_MISMATCH";
  }
  return null;
}

async function creditDeposit(
  tx: Queryable,
  deposit: DepositRow,
  quote: UsdQuote,
  providerEventId: string,
  admin: { actor: string; reason: string } | null,
  currentTime: Date,
): Promise<ProcessedCoinDeposit> {
  if (!deposit.user_id || !deposit.deposit_intent_id) {
    throw new CoinWalletError(
      "DEPOSIT_NOT_RETRYABLE",
      "Deposit cannot be credited without a verified user intent.",
      409,
    );
  }
  if (deposit.status === "credited") {
    return {
      deposit: mapDeposit(deposit),
      rateSnapshot: deposit.rate_snapshot_id
        ? await findRateSnapshot(tx, deposit.rate_snapshot_id)
        : null,
      ledgerEntry: deposit.ledger_entry_id
        ? await findCoinEntry(tx, deposit.ledger_entry_id)
        : null,
      idempotent: true,
      providerEventStored: true,
      creditBlockedReason: null,
    };
  }

  const net = usdtAtomic(BigInt(deposit.net_usdt_atomic), false);
  validateUsdQuote(quote, {
    ttlSeconds: Math.max(
      1,
      Math.floor((Date.parse(quote.expiresAt) - Date.parse(quote.quotedAt)) / 1000),
    ),
    now: currentTime,
    expectedPurpose: "deposit_final",
    expectedKind: "final",
    expectedAmountUsdtAtomic: net,
  });
  const credited = usdtToCoinMicros(net, quote.usdRateNanos, "down");
  if (credited <= 0n) {
    throw new CoinWalletError("INVALID_COIN_AMOUNT", "Deposit converts to zero Coins.", 409);
  }
  const snapshot = await insertRateSnapshot(tx, quote);
  const ledger = await new PostgresCoinLedgerRepository(tx).postEntry({
    userId: deposit.user_id,
    operationType: "crypto_deposit_credit",
    availableDeltaCoinMicros: credited,
    idempotencyKey: `crypto-deposit:${deposit.id}:credit`,
    sourceType: "crypto_deposit",
    sourceId: deposit.id,
    externalReference: deposit.blockchain_tx_hash,
    rateSnapshotId: snapshot.id,
    reason: admin?.reason ?? "confirmed_usdt_deposit",
    auditMetadata: {
      provider: deposit.provider,
      providerEventId,
      providerTransactionId: deposit.provider_transaction_id,
      blockchainTxHash: deposit.blockchain_tx_hash,
      eventIndex: deposit.event_index,
      tokenContract: deposit.token_contract,
      destinationAddress: deposit.destination_address,
      grossUsdtAtomic: deposit.gross_usdt_atomic,
      netUsdtAtomic: deposit.net_usdt_atomic,
      rateSnapshotId: snapshot.id,
      adminActor: admin?.actor ?? null,
    },
  });
  const result = await tx.query<DepositRow>(
    `update crypto_deposits
     set status = 'credited', rate_snapshot_id = $2,
         usd_value_micros = $3::bigint, credited_coin_micros = $3::bigint,
         ledger_entry_id = $4, manual_review_reason = null,
         confirmed_at = coalesce(confirmed_at, $5), credited_at = $5, updated_at = $5
     where id = $1
     returning ${depositColumns}`,
    [deposit.id, snapshot.id, credited.toString(), ledger.id, currentTime.toISOString()],
  );
  const updated = requireRow(result.rows[0], "Crypto deposit credit update returned no row.");
  await tx.query(
    `update wallet_deposit_intents
     set status = 'credited',
         metadata = metadata || $2::jsonb,
         updated_at = $3
     where id = $1`,
    [
      deposit.deposit_intent_id,
      JSON.stringify({
        cryptoDepositId: deposit.id,
        creditedCoinMicros: credited.toString(),
        rateSnapshotId: snapshot.id,
      }),
      currentTime.toISOString(),
    ],
  );
  await insertAudit(tx, {
    eventType: "wallet.deposit_coin_credited",
    userId: deposit.user_id,
    metadata: {
      cryptoDepositId: deposit.id,
      providerEventId,
      ledgerEntryId: ledger.id,
      rateSnapshotId: snapshot.id,
      grossUsdtAtomic: deposit.gross_usdt_atomic,
      netUsdtAtomic: deposit.net_usdt_atomic,
      creditedCoinMicros: credited.toString(),
      availableAfterCoinMicros: ledger.availableAfterCoinMicros,
      reservedAfterCoinMicros: ledger.reservedAfterCoinMicros,
      adminActor: admin?.actor ?? null,
    },
  });
  await insertOutbox(tx, {
    aggregateType: "crypto_deposit",
    aggregateId: deposit.id,
    eventType: "crypto_deposit.credited",
    idempotencyKey: `crypto-deposit:${deposit.id}:credited`,
    payload: {
      userId: deposit.user_id,
      creditedCoinMicros: credited.toString(),
      ledgerEntryId: ledger.id,
      rateSnapshotId: snapshot.id,
    },
  });
  return {
    deposit: mapDeposit(updated),
    rateSnapshot: snapshot,
    ledgerEntry: ledger,
    idempotent: false,
    providerEventStored: true,
    creditBlockedReason: null,
  };
}

async function reverseDeposit(
  tx: Queryable,
  deposit: DepositRow,
  parsed: ParsedFireblocksDeposit,
  currentTime: Date,
): Promise<ProcessedCoinDeposit> {
  if (deposit.status === "reversed" && deposit.reversal_ledger_entry_id) {
    return {
      deposit: mapDeposit(deposit),
      rateSnapshot: deposit.rate_snapshot_id
        ? await findRateSnapshot(tx, deposit.rate_snapshot_id)
        : null,
      ledgerEntry: await findCoinEntry(tx, deposit.reversal_ledger_entry_id),
      idempotent: true,
      providerEventStored: true,
      creditBlockedReason: null,
    };
  }
  const canRetryCreditedReversal = [
    "credited",
    "reversal_pending",
    "reversing",
  ].includes(deposit.status);
  if (!canRetryCreditedReversal || !deposit.user_id || !deposit.credited_coin_micros) {
    const updated = await updateDepositState(tx, {
      id: deposit.id,
      status: "rejected",
      confirmations: parsed.confirmations,
      manualReviewReason: "PROVIDER_REVERSAL_BEFORE_CREDIT",
    });
    await insertAudit(tx, {
      eventType: "wallet.deposit_reversed_before_credit",
      userId: updated.user_id,
      metadata: depositAuditMetadata(updated, parsed, "PROVIDER_REVERSAL_BEFORE_CREDIT"),
    });
    return {
      deposit: mapDeposit(updated),
      rateSnapshot: null,
      ledgerEntry: null,
      idempotent: false,
      providerEventStored: true,
      creditBlockedReason: "PROVIDER_REVERSAL_BEFORE_CREDIT",
    };
  }

  const amount = BigInt(deposit.credited_coin_micros);
  const account = await tx.query<{ available_coin_micros: string }>(
    `select available_coin_micros::text
     from coin_accounts where user_id = $1 for update`,
    [deposit.user_id],
  );
  if (BigInt(account.rows[0]?.available_coin_micros ?? "0") < amount) {
    const updated = await updateDepositState(tx, {
      id: deposit.id,
      status: "reversal_pending",
      confirmations: parsed.confirmations,
      manualReviewReason: "REVERSAL_INSUFFICIENT_AVAILABLE_COINS",
    });
    await insertAudit(tx, {
      eventType: "wallet.deposit_reversal_pending",
      userId: deposit.user_id,
      metadata: depositAuditMetadata(
        updated,
        parsed,
        "REVERSAL_INSUFFICIENT_AVAILABLE_COINS",
      ),
    });
    await insertOutbox(tx, {
      aggregateType: "crypto_deposit",
      aggregateId: deposit.id,
      eventType: "crypto_deposit.reversal_pending",
      idempotencyKey: `crypto-deposit:${deposit.id}:reversal-pending`,
      payload: {
        userId: deposit.user_id,
        creditedCoinMicros: amount.toString(),
        reason: "REVERSAL_INSUFFICIENT_AVAILABLE_COINS",
      },
    });
    return {
      deposit: mapDeposit(updated),
      rateSnapshot: deposit.rate_snapshot_id
        ? await findRateSnapshot(tx, deposit.rate_snapshot_id)
        : null,
      ledgerEntry: null,
      idempotent: false,
      providerEventStored: true,
      creditBlockedReason: "REVERSAL_INSUFFICIENT_AVAILABLE_COINS",
    };
  }

  const ledger = await new PostgresCoinLedgerRepository(tx).postEntry({
    userId: deposit.user_id,
    operationType: "reversed_deposit",
    availableDeltaCoinMicros: -amount,
    idempotencyKey: `crypto-deposit:${deposit.id}:reversal`,
    sourceType: "crypto_deposit",
    sourceId: deposit.id,
    externalReference: deposit.blockchain_tx_hash,
    rateSnapshotId: deposit.rate_snapshot_id,
    reason: "provider_reversal_or_chain_reorg",
    auditMetadata: {
      providerEventId: parsed.providerEventId,
      providerStatus: parsed.providerStatus,
      originalLedgerEntryId: deposit.ledger_entry_id,
    },
  });
  const result = await tx.query<DepositRow>(
    `update crypto_deposits
     set status = 'reversed', reversal_ledger_entry_id = $2,
         manual_review_reason = 'PROVIDER_REVERSAL_OR_REORG', updated_at = $3
     where id = $1
     returning ${depositColumns}`,
    [deposit.id, ledger.id, currentTime.toISOString()],
  );
  const updated = requireRow(result.rows[0], "Crypto deposit reversal returned no row.");
  await insertAudit(tx, {
    eventType: "wallet.deposit_coin_reversed",
    userId: deposit.user_id,
    metadata: {
      cryptoDepositId: deposit.id,
      providerEventId: parsed.providerEventId,
      originalLedgerEntryId: deposit.ledger_entry_id,
      reversalLedgerEntryId: ledger.id,
      reversedCoinMicros: amount.toString(),
      availableAfterCoinMicros: ledger.availableAfterCoinMicros,
    },
  });
  await insertOutbox(tx, {
    aggregateType: "crypto_deposit",
    aggregateId: deposit.id,
    eventType: "crypto_deposit.reversed",
    idempotencyKey: `crypto-deposit:${deposit.id}:reversed`,
    payload: {
      userId: deposit.user_id,
      reversalLedgerEntryId: ledger.id,
      reversedCoinMicros: amount.toString(),
    },
  });
  return {
    deposit: mapDeposit(updated),
    rateSnapshot: deposit.rate_snapshot_id
      ? await findRateSnapshot(tx, deposit.rate_snapshot_id)
      : null,
    ledgerEntry: ledger,
    idempotent: false,
    providerEventStored: true,
    creditBlockedReason: null,
  };
}

async function insertRateSnapshot(
  tx: Queryable,
  quote: UsdQuote,
): Promise<CoinRateSnapshot> {
  const result = await tx.query<RateSnapshotRow>(
    `insert into exchange_rate_snapshots (
       base_asset, network, quote_currency, rate_nanos, source, kind, purpose,
       quoted_at, expires_at, provider_reference, raw_metadata
     ) values (
       'USDT', 'TRON', 'USD', $1::bigint, $2, $3, $4, $5, $6, $7, $8::jsonb
     )
     returning ${rateColumns}`,
    [
      quote.usdRateNanos.toString(),
      quote.source,
      quote.kind,
      quote.purpose,
      quote.quotedAt,
      quote.expiresAt,
      null,
      JSON.stringify({
        requestedAmountUsdtAtomic: quote.amountUsdtAtomic.toString(),
        rateDecimal: quote.rateDecimal,
      }),
    ],
  );
  return mapRateSnapshot(
    requireRow(result.rows[0], "Exchange-rate snapshot insert returned no row."),
  );
}

async function recordWithdrawalFailureState(
  tx: Queryable,
  input: {
    request: WithdrawalRow;
    outcome: VerifiedWithdrawalProviderOutcome;
    failureState: string;
    releaseReserve: boolean;
    currentTime: Date;
  },
) {
  const reserved = BigInt(input.request.coin_reserved_micros ?? "0");
  const coins = new PostgresCoinLedgerRepository(tx);
  let release: CoinLedgerEntry | null = null;
  if (
    input.releaseReserve &&
    !input.request.release_ledger_entry_id &&
    !input.request.final_ledger_entry_id &&
    reserved > 0n
  ) {
    release = await coins.postEntry({
      userId: input.request.user_id,
      operationType: "withdrawal_release",
      availableDeltaCoinMicros: reserved,
      reservedDeltaCoinMicros: -reserved,
      idempotencyKey: `withdrawal:${input.request.id}:provider-failure-release`,
      sourceType: "withdrawal_request",
      sourceId: input.request.id,
      externalReference: input.outcome.providerReference,
      reason: "verified_provider_withdrawal_failed",
      auditMetadata: {
        provider: input.outcome.provider,
        providerReference: input.outcome.providerReference,
        evidenceHash: input.outcome.evidenceHash,
        providerCallInitiated: false,
      },
    });
  }
  const result = await tx.query<WithdrawalRow>(
    `update wallet_withdrawal_requests
     set status = 'failed', provider = $7,
         real_transfer_blocked = false, block_reason = null,
         failure_state = $2, fireblocks_reference = $3,
         release_ledger_entry_id = coalesce(release_ledger_entry_id, $4),
         updated_at = $5,
         metadata = metadata || $6::jsonb
     where id = $1
     returning ${withdrawalColumns}`,
    [
      input.request.id,
      input.failureState,
      input.outcome.providerReference,
      release?.id ?? null,
      input.outcome.observedAt,
      JSON.stringify({
        source: "real_withdrawal_broadcast",
        providerWithdrawalId: input.outcome.providerReference,
        providerOutcomeState: input.outcome.state,
        providerEvidenceHash: input.outcome.evidenceHash,
        providerOutcomeObservedAt: input.outcome.observedAt,
        providerCallInitiated: false,
        reserveReleased: Boolean(release),
      }),
      input.outcome.provider,
    ],
  );
  const updated = requireRow(result.rows[0], "Withdrawal provider state update returned no row.");
  await insertAudit(tx, {
    eventType: "wallet.withdrawal_provider_state_recorded",
    userId: input.request.user_id,
    metadata: {
      withdrawalRequestId: input.request.id,
      providerState: input.outcome.state,
      failureState: input.failureState,
      providerReference: input.outcome.providerReference,
      evidenceHash: input.outcome.evidenceHash,
      releaseLedgerEntryId: release?.id ?? null,
      coinReleasedMicros: release ? reserved.toString() : "0",
      providerCallInitiated: false,
    },
  });
  await insertOutbox(tx, {
    aggregateType: "withdrawal",
    aggregateId: input.request.id,
    eventType: "withdrawal.provider_state_recorded",
    idempotencyKey: `withdrawal:${input.request.id}:provider-state:${input.outcome.evidenceHash}`,
    payload: {
      userId: input.request.user_id,
      state: input.outcome.state,
      failureState: input.failureState,
      releaseLedgerEntryId: release?.id ?? null,
    },
  });
  return {
    withdrawalRequest: mapWithdrawal(updated),
    balance: await coins.getBalance(input.request.user_id),
    ledgerEntry: release,
    idempotent: false,
  };
}

function validateVerifiedWithdrawalOutcome(
  value: VerifiedWithdrawalProviderOutcome,
): VerifiedWithdrawalProviderOutcome {
  if (value.verified !== true || value.provider !== "fireblocks") {
    throw new CoinWalletError(
      "INVALID_COIN_WALLET_REQUEST",
      "Withdrawal provider outcome must be verified by the Fireblocks adapter.",
    );
  }
  requiredText(value.providerReference, "Provider reference is required.");
  if (!/^[a-f0-9]{64}$/.test(value.evidenceHash)) {
    throw new CoinWalletError(
      "INVALID_COIN_WALLET_REQUEST",
      "Provider evidence hash must be a SHA-256 hex string.",
    );
  }
  if (!Number.isFinite(Date.parse(value.observedAt))) {
    throw new CoinWalletError(
      "INVALID_COIN_WALLET_REQUEST",
      "Provider outcome timestamp is invalid.",
    );
  }
  return value;
}

function parseOptionalAtomicFee(value: string | null | undefined, fallback: UsdtAtomic) {
  if (value === undefined || value === null) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new CoinWalletError(
      "INVALID_USDT_AMOUNT",
      "Provider fee must be a non-negative integer atomic string.",
    );
  }
  return usdtAtomic(assertPgBigint(BigInt(value)));
}

async function findRateSnapshot(
  tx: Queryable,
  id: string,
): Promise<CoinRateSnapshot | null> {
  const result = await tx.query<RateSnapshotRow>(
    `select ${rateColumns} from exchange_rate_snapshots where id = $1 limit 1`,
    [id],
  );
  return result.rows[0] ? mapRateSnapshot(result.rows[0]) : null;
}

async function findCoinEntry(
  tx: Queryable,
  id: string,
): Promise<CoinLedgerEntry | null> {
  const result = await tx.query<{
    user_id: string;
  }>(`select user_id from coin_ledger_entries where id = $1 limit 1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  const entries = await new PostgresCoinLedgerRepository(tx).listEntries(row.user_id, 500);
  return entries.find((entry) => entry.id === id) ?? null;
}

async function findDepositForUpdate(tx: Queryable, id: string) {
  const result = await tx.query<DepositRow>(
    `${depositSelectSql} where id = $1 for update`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function updateDepositState(
  tx: Queryable,
  input: {
    id: string;
    status: CoinDepositStatus;
    confirmations: number;
    manualReviewReason: string | null;
    confirmedAt?: string;
  },
) {
  const result = await tx.query<DepositRow>(
    `update crypto_deposits
     set status = $2,
         actual_confirmations = greatest(actual_confirmations, $3),
         manual_review_reason = $4,
         confirmed_at = coalesce(confirmed_at, $5::timestamptz),
         updated_at = now()
     where id = $1
     returning ${depositColumns}`,
    [
      input.id,
      input.status,
      input.confirmations,
      input.manualReviewReason,
      input.confirmedAt ?? null,
    ],
  );
  return requireRow(result.rows[0], "Crypto deposit state update returned no row.");
}

async function setIntentDetected(tx: Queryable, intentId: string | null) {
  if (!intentId) return;
  await tx.query(
    `update wallet_deposit_intents
     set status = case when status = 'waiting' then 'detected' else status end,
         updated_at = now()
     where id = $1 and status in ('waiting', 'detected')`,
    [intentId],
  );
}

async function findQuoteByIdempotency(
  db: Queryable,
  userId: string,
  idempotencyKey: string,
  forUpdate = false,
) {
  const result = await db.query<QuoteRow>(
    `select ${quoteColumns}
     from withdrawal_quotes
     where user_id = $1 and idempotency_key = $2
     limit 1
     ${forUpdate ? "for update" : ""}`,
    [userId, idempotencyKey],
  );
  const quote = result.rows[0];
  if (!quote) return null;
  const rateResult = await db.query<RateSnapshotRow>(
    `select ${rateColumns} from exchange_rate_snapshots where id = $1 limit 1`,
    [quote.rate_snapshot_id],
  );
  return {
    quote,
    rate: mapRateSnapshot(
      requireRow(rateResult.rows[0], "Withdrawal quote rate snapshot was not found."),
    ),
  };
}

function assertQuoteFingerprint(quote: QuoteRow, fingerprint: string) {
  if (quote.request_fingerprint !== fingerprint) {
    throw new CoinWalletError(
      "IDEMPOTENCY_KEY_REUSE_MISMATCH",
      "Idempotency key was used for a different withdrawal quote.",
      409,
    );
  }
}

async function findWithdrawalByIdempotency(
  tx: Queryable,
  userId: string,
  idempotencyKey: string,
  forUpdate = false,
) {
  const result = await tx.query<WithdrawalRow>(
    `${withdrawalSelectSql}
     where user_id = $1 and idempotency_key = $2 and withdrawal_quote_id is not null
     limit 1
     ${forUpdate ? "for update" : ""}`,
    [userId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function findWithdrawalForUpdate(
  tx: Queryable,
  withdrawalId: string,
  userId: string | null = null,
) {
  const result = await tx.query<WithdrawalRow>(
    `${withdrawalSelectSql}
     where id = $1 and withdrawal_quote_id is not null
       and ($2::uuid is null or user_id = $2)
     limit 1
     for update`,
    [withdrawalId, userId],
  );
  return result.rows[0] ?? null;
}

async function insertAudit(
  tx: Queryable,
  input: {
    eventType: string;
    userId: string | null;
    metadata: Record<string, unknown>;
  },
) {
  const id = randomUUID();
  await tx.query(
    `insert into audit_logs (id, event_type, user_id, metadata, created_at)
     values ($1, $2, $3, $4::jsonb, now())`,
    [id, input.eventType, input.userId, JSON.stringify({ ...input.metadata, auditId: id })],
  );
  return id;
}

async function insertOutbox(
  tx: Queryable,
  input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
) {
  await tx.query(
    `insert into money_outbox_events (
       aggregate_type, aggregate_id, event_type, idempotency_key, payload
     ) values ($1, $2, $3, $4, $5::jsonb)
     on conflict (idempotency_key) do nothing`,
    [
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      input.idempotencyKey,
      JSON.stringify(input.payload),
    ],
  );
}

function parseFireblocksDeposit(
  verified: FireblocksDepositWebhookResult,
): ParsedFireblocksDeposit {
  const payload = isRecord(verified.payload) ? verified.payload : {};
  const data = firstRecord(payload.data, payload.transaction, payload.resource) ?? payload;
  const networkRecord = firstArrayRecord(data.networkRecords);
  const amountInfo = firstRecord(data.amountInfo, data.amount) ?? {};
  const feeInfo = firstRecord(data.feeInfo, data.fee) ?? {};
  const destination = firstRecord(data.destination, data.destinations) ?? {};
  const providerStatus = firstString(data.status, payload.status).toUpperCase();
  const payloadHash = hashJson(payload);
  const providerEventId =
    firstString(payload.eventId, payload.notificationId, payload.id) ||
    verified.transactionId ||
    `unidentified:${payloadHash}`;
  const providerTransactionId =
    verified.transactionId || firstString(data.id, data.transactionId) || null;
  const blockchainTxHash =
    firstString(
      data.txHash,
      data.transactionHash,
      data.blockchainTxId,
      networkRecord?.txHash,
      networkRecord?.transactionHash,
    ) || `missing:${providerEventId}`;
  const rawEventIndex = firstString(
    data.eventIndex,
    data.logIndex,
    networkRecord?.eventIndex,
    networkRecord?.logIndex,
  );
  const eventIndex = rawEventIndex || `missing:${providerEventId}`;
  const destinationAddress = firstString(
    data.destinationAddress,
    data.toAddress,
    data.recipientAddress,
    destination.address,
    destination.oneTimeAddress,
    networkRecord?.destinationAddress,
    networkRecord?.toAddress,
  );
  const tokenContract = firstString(
    data.tokenContract,
    data.tokenContractAddress,
    data.contractAddress,
    networkRecord?.tokenContract,
    networkRecord?.contractAddress,
  );
  const assetId = firstString(data.assetId, data.asset, payload.assetId).toUpperCase();
  const asset = assetId.includes("USDT") ? "USDT" : assetId;
  const rawNetwork = firstString(
    data.network,
    payload.network,
    networkRecord?.network,
    data.assetId,
  ).toUpperCase();
  const network =
    rawNetwork.includes("TRON") || rawNetwork.includes("TRX") ? "TRON" : rawNetwork;
  const validationIssues: string[] = [];
  const grossUsdtAtomic = parseProviderUsdtAmount(
    firstDefined(amountInfo.amount, amountInfo.requestedAmount, data.amount),
    "INVALID_GROSS_USDT_AMOUNT",
    validationIssues,
  );
  const networkFeeUsdtAtomic = parseProviderUsdtAmount(
    firstDefined(feeInfo.networkFee, data.networkFee),
    "INVALID_NETWORK_FEE",
    validationIssues,
    true,
  );
  const providerFeeUsdtAtomic = parseProviderUsdtAmount(
    firstDefined(feeInfo.serviceFee, feeInfo.providerFee, data.providerFee),
    "INVALID_PROVIDER_FEE",
    validationIssues,
    true,
  );
  const confirmations = parseConfirmations(
    firstDefined(data.numOfConfirmations, data.confirmations, networkRecord?.confirmations),
  );
  if (!rawEventIndex) validationIssues.push("EVENT_INDEX_REQUIRED");
  if (blockchainTxHash.startsWith("missing:")) validationIssues.push("TX_HASH_REQUIRED");
  if (!destinationAddress || !isValidTronAddress(destinationAddress)) {
    validationIssues.push("INVALID_DESTINATION_ADDRESS");
  }
  if (!tokenContract) validationIssues.push("TOKEN_CONTRACT_REQUIRED");
  if (!providerEventId || providerEventId.startsWith("unidentified:")) {
    validationIssues.push("PROVIDER_EVENT_ID_REQUIRED");
  }
  const reversal =
    ["CANCELLED", "CANCELED", "REJECTED", "FAILED", "REVERTED", "REORGED"].includes(
      providerStatus,
    ) ||
    /REVERS|REORG/.test(firstString(payload.eventType, payload.type).toUpperCase());
  const confirmed = ["COMPLETED", "CONFIRMED"].includes(providerStatus);

  return {
    providerEventId,
    providerEventType:
      verified.eventType || firstString(payload.eventType, payload.type) || "UNKNOWN",
    providerTransactionId,
    blockchainTxHash,
    eventIndex,
    destinationAddress,
    tokenContract,
    asset,
    network,
    grossUsdtAtomic,
    networkFeeUsdtAtomic,
    providerFeeUsdtAtomic,
    confirmations,
    providerStatus,
    confirmed,
    reversal,
    validationIssues: [...new Set(validationIssues)],
    payload,
    payloadHash,
  };
}

function parseProviderUsdtAmount(
  value: unknown,
  issue: string,
  issues: string[],
  allowMissing = false,
) {
  if (value === undefined || value === null || value === "") {
    if (!allowMissing) issues.push(issue);
    return usdtAtomic(0n);
  }
  if (typeof value !== "string") {
    issues.push(issue);
    return usdtAtomic(0n);
  }
  try {
    return parseUsdt(value.trim(), allowMissing);
  } catch {
    issues.push(issue);
    return usdtAtomic(0n);
  }
}

function calculateNetUsdt(parsed: {
  grossUsdtAtomic: UsdtAtomic;
  networkFeeUsdtAtomic: UsdtAtomic;
  providerFeeUsdtAtomic: UsdtAtomic;
}) {
  const fees = parsed.networkFeeUsdtAtomic + parsed.providerFeeUsdtAtomic;
  return usdtAtomic(parsed.grossUsdtAtomic > fees ? parsed.grossUsdtAtomic - fees : 0n);
}

function compareDepositImmutableFields(
  row: DepositRow,
  parsed: ParsedFireblocksDeposit,
): DepositImmutableConflict | null {
  const stored: DepositImmutableComparison = {
    asset: SUPPORTED_SETTLEMENT_ASSET,
    network: row.network,
    providerTransactionId: row.provider_transaction_id,
    blockchainTxHash: row.blockchain_tx_hash,
    eventIndex: row.event_index,
    tokenContract: row.token_contract,
    destinationAddress: row.destination_address,
    grossUsdtAtomic: BigInt(row.gross_usdt_atomic).toString(),
    networkFeeUsdtAtomic: BigInt(row.network_fee_usdt_atomic).toString(),
    providerFeeUsdtAtomic: BigInt(row.provider_fee_usdt_atomic).toString(),
    netUsdtAtomic: BigInt(row.net_usdt_atomic).toString(),
  };
  const received: DepositImmutableComparison = {
    asset: parsed.asset,
    network: parsed.network,
    providerTransactionId: parsed.providerTransactionId,
    blockchainTxHash: parsed.blockchainTxHash,
    eventIndex: parsed.eventIndex,
    tokenContract: parsed.tokenContract,
    destinationAddress: parsed.destinationAddress,
    grossUsdtAtomic: parsed.grossUsdtAtomic.toString(),
    networkFeeUsdtAtomic: parsed.networkFeeUsdtAtomic.toString(),
    providerFeeUsdtAtomic: parsed.providerFeeUsdtAtomic.toString(),
    netUsdtAtomic: calculateNetUsdt(parsed).toString(),
  };
  const mismatchedFields = immutableDepositMismatchFields(stored, received);
  return mismatchedFields.length > 0
    ? { mismatchedFields, stored, received }
    : null;
}

function immutableDepositMismatchFields(
  stored: DepositImmutableComparison,
  received: DepositImmutableComparison,
) {
  const comparableFields: Array<keyof DepositImmutableComparison> = [
    "asset",
    "network",
    "blockchainTxHash",
    "eventIndex",
    "tokenContract",
    "destinationAddress",
    "grossUsdtAtomic",
    "networkFeeUsdtAtomic",
    "providerFeeUsdtAtomic",
    "netUsdtAtomic",
  ];
  if (stored.providerTransactionId && received.providerTransactionId) {
    comparableFields.push("providerTransactionId");
  }
  const mismatchedFields = comparableFields.filter(
    (field) => stored[field] !== received[field],
  );
  return mismatchedFields;
}

function isDepositFinancialStateImmutable(status: CoinDepositStatus) {
  return ["credited", "reversal_pending", "reversing", "reversed"].includes(status);
}

function selectUnambiguousDepositIntent<T>(rows: readonly T[]) {
  return rows.length === 1
    ? { value: rows[0] ?? null, ambiguous: false }
    : { value: null, ambiguous: rows.length > 1 };
}

function canReleaseWithdrawalReserve(
  status: CoinWithdrawalStatus,
  failureState: string | null,
) {
  return status !== "failed" || failureState === PROVIDER_CONFIRMED_FAILED;
}

function withdrawalRetryBlockedReason(failureState: string | null) {
  return failureState === PROVIDER_CONFIRMED_FAILED
    ? REVIEW_ONLY_BLOCK_REASON
    : WITHDRAWAL_RESERVE_LOCKED_REASON;
}

export const coinWalletSafetyTestUtils = {
  canReleaseWithdrawalReserve,
  immutableDepositMismatchFields,
  isDepositFinancialStateImmutable,
  selectUnambiguousDepositIntent,
  withdrawalRetryBlockedReason,
} as const;

function normalizeRateError(error: unknown) {
  if (error instanceof ExchangeRateError) return error;
  return new ExchangeRateError("RATE_UNAVAILABLE", "Exchange rate is unavailable.");
}

function mapRateError(error: unknown) {
  const normalized = normalizeRateError(error);
  return new CoinWalletError(
    normalized.code === "RATE_STALE" ? "RATE_STALE" : "RATE_UNAVAILABLE",
    normalized.message,
    503,
  );
}

function mapDeposit(row: DepositRow): CoinDeposit {
  return {
    id: row.id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    providerTransactionId: row.provider_transaction_id,
    blockchainTxHash: row.blockchain_tx_hash,
    eventIndex: row.event_index,
    network: row.network,
    tokenContract: row.token_contract,
    destinationAddress: row.destination_address,
    depositIntentId: row.deposit_intent_id,
    userId: row.user_id,
    grossUsdtAtomic: BigInt(row.gross_usdt_atomic).toString(),
    networkFeeUsdtAtomic: BigInt(row.network_fee_usdt_atomic).toString(),
    providerFeeUsdtAtomic: BigInt(row.provider_fee_usdt_atomic).toString(),
    netUsdtAtomic: BigInt(row.net_usdt_atomic).toString(),
    rateSnapshotId: row.rate_snapshot_id,
    usdValueMicros:
      row.usd_value_micros === null ? null : BigInt(row.usd_value_micros).toString(),
    creditedCoinMicros:
      row.credited_coin_micros === null
        ? null
        : BigInt(row.credited_coin_micros).toString(),
    ledgerEntryId: row.ledger_entry_id,
    reversalLedgerEntryId: row.reversal_ledger_entry_id,
    requiredConfirmations: String(row.required_confirmations),
    actualConfirmations: String(row.actual_confirmations),
    status: row.status,
    manualReviewReason: row.manual_review_reason,
    detectedAt: toIsoString(row.detected_at),
    confirmedAt: row.confirmed_at ? toIsoString(row.confirmed_at) : null,
    creditedAt: row.credited_at ? toIsoString(row.credited_at) : null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapRateSnapshot(row: RateSnapshotRow): CoinRateSnapshot {
  const rateNanos = BigInt(row.rate_nanos);
  return {
    id: row.id,
    asset: row.base_asset,
    network: row.network,
    quoteCurrency: row.quote_currency,
    rateNanos: rateNanos.toString(),
    rateDecimal: formatAtomic(rateNanos, 9),
    source: row.source,
    kind: row.kind,
    purpose: row.purpose,
    quotedAt: toIsoString(row.quoted_at),
    expiresAt: toIsoString(row.expires_at),
    providerReference: row.provider_reference,
    createdAt: toIsoString(row.created_at),
  };
}

function mapQuoteWithSnapshot(
  row: QuoteRow,
  rateSnapshot: CoinRateSnapshot,
): CoinWithdrawalQuote {
  const estimated = BigInt(row.estimated_usdt_atomic);
  const networkFee = BigInt(row.network_fee_usdt_atomic);
  const providerFee = BigInt(row.provider_fee_usdt_atomic);
  return {
    id: row.id,
    userId: row.user_id,
    asset: row.asset,
    network: row.network,
    destinationAddress: row.destination_address,
    coinToDebitMicros: BigInt(row.coin_to_debit_micros).toString(),
    grossUsdtAtomic: (estimated + networkFee + providerFee).toString(),
    estimatedUsdtAtomic: estimated.toString(),
    networkFeeUsdtAtomic: networkFee.toString(),
    providerFeeUsdtAtomic: providerFee.toString(),
    rateSnapshot,
    status: row.status,
    expiresAt: toIsoString(row.expires_at),
    idempotencyKey: row.idempotency_key,
    createdAt: toIsoString(row.created_at),
  };
}

function mapWithdrawal(row: WithdrawalRow): CoinWithdrawalRequest {
  if (
    !row.withdrawal_quote_id ||
    !row.coin_reserved_micros ||
    !row.estimated_usdt_atomic ||
    !row.reserve_ledger_entry_id
  ) {
    throw new CoinWalletError(
      "INVALID_COIN_WALLET_REQUEST",
      "Withdrawal is not backed by a Coin reserve.",
      500,
    );
  }
  const reviewOnlyStatus = [
    "pending_review",
    "approved_for_review",
    "rejected",
    "cancelled",
  ].includes(row.status);
  const validTransferPolicy = reviewOnlyStatus
    ? row.real_transfer_blocked === true && row.block_reason === "TRANSFERS_UNAVAILABLE"
    : row.real_transfer_blocked === false &&
      row.block_reason === null &&
      row.metadata?.source === "real_withdrawal_broadcast";
  if (!validTransferPolicy) {
    throw new CoinWalletError(
      "INVALID_COIN_WALLET_REQUEST",
      "Coin withdrawal escaped review-only policy.",
      500,
    );
  }
  return {
    id: row.id,
    userId: row.user_id,
    withdrawalQuoteId: row.withdrawal_quote_id,
    asset: row.asset,
    network: row.network,
    destinationAddress: row.destination_address,
    coinReservedMicros: BigInt(row.coin_reserved_micros).toString(),
    coinDebitedMicros:
      row.coin_debited_micros === null ? null : BigInt(row.coin_debited_micros).toString(),
    estimatedUsdtAtomic: BigInt(row.estimated_usdt_atomic).toString(),
    finalUsdtAtomic:
      row.final_usdt_atomic === null ? null : BigInt(row.final_usdt_atomic).toString(),
    networkFeeUsdtAtomic: BigInt(row.network_fee_usdt_atomic ?? "0").toString(),
    providerFeeUsdtAtomic: BigInt(row.provider_fee_usdt_atomic ?? "0").toString(),
    status: row.status,
    reserveLedgerEntryId: row.reserve_ledger_entry_id,
    finalLedgerEntryId: row.final_ledger_entry_id,
    releaseLedgerEntryId: row.release_ledger_entry_id,
    finalRateSnapshotId: row.final_rate_snapshot_id,
    fireblocksReference: row.fireblocks_reference,
    failureState: row.failure_state,
    reviewReason: row.review_reason,
    reviewedByActor: row.reviewed_by_actor,
    reviewedAt: row.reviewed_at ? toIsoString(row.reviewed_at) : null,
    idempotencyKey: row.idempotency_key,
    realTransferBlocked: row.real_transfer_blocked,
    blockReason:
      row.block_reason === "TRANSFERS_UNAVAILABLE" ? "TRANSFERS_UNAVAILABLE" : null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function depositAuditMetadata(
  deposit: DepositRow,
  parsed: ParsedFireblocksDeposit,
  reason: string,
) {
  return {
    cryptoDepositId: deposit.id,
    provider: deposit.provider,
    providerEventId: parsed.providerEventId,
    providerTransactionId: parsed.providerTransactionId,
    blockchainTxHash: deposit.blockchain_tx_hash,
    eventIndex: deposit.event_index,
    tokenContract: deposit.token_contract,
    destinationAddress: deposit.destination_address,
    grossUsdtAtomic: deposit.gross_usdt_atomic,
    netUsdtAtomic: deposit.net_usdt_atomic,
    actualConfirmations: String(deposit.actual_confirmations),
    requiredConfirmations: String(deposit.required_confirmations),
    status: deposit.status,
    reason,
    manualReview: deposit.status === "manual_review",
  };
}

function parsePositiveCoinMicros(value: unknown): CoinMicros {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) {
    throw new CoinWalletError(
      "INVALID_COIN_AMOUNT",
      "coinAmountMicros must be a positive integer string.",
    );
  }
  const amount = assertPgBigint(BigInt(value.trim()));
  return coinMicros(amount, false);
}

function parsePositiveUsdtAtomic(value: unknown): UsdtAtomic {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) {
    throw new CoinWalletError(
      "INVALID_USDT_AMOUNT",
      "expectedUsdtAtomic must be a positive integer string.",
    );
  }
  const amount = assertPgBigint(BigInt(value.trim()));
  return usdtAtomic(amount, false);
}

function parseSignedCoinDelta(value: unknown) {
  if (typeof value !== "string" || !/^-?[1-9]\d*$/.test(value.trim())) {
    throw new CoinWalletError(
      "INVALID_COIN_AMOUNT",
      "deltaCoinMicros must be a non-zero signed integer string.",
    );
  }
  return assertPgBigint(BigInt(value.trim()), true);
}

function assertPgBigint(value: bigint, signed = false) {
  const min = signed ? -9_223_372_036_854_775_808n : 0n;
  const max = 9_223_372_036_854_775_807n;
  if (value < min || value > max) {
    throw new CoinWalletError(
      "INVALID_COIN_AMOUNT",
      "Money amount is outside the PostgreSQL BIGINT range.",
    );
  }
  return value;
}

function parseIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CoinWalletError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key is required.",
    );
  }
  if (value.trim().length > 200) {
    throw new CoinWalletError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key is too long.",
    );
  }
  return value.trim();
}

function parseTronAddress(value: unknown) {
  if (typeof value !== "string" || !isValidTronAddress(value.trim())) {
    throw new CoinWalletError(
      "INVALID_TRON_ADDRESS",
      "Destination must be a valid TRON Base58Check address.",
    );
  }
  return value.trim();
}

export function isValidTronAddress(value: string) {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return false;
  const decoded = decodeBase58(value);
  if (!decoded || decoded.length !== 25 || decoded[0] !== 0x41) return false;
  const body = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const expected = createHash("sha256")
    .update(createHash("sha256").update(body).digest())
    .digest()
    .subarray(0, 4);
  return checksum.equals(expected);
}

function decodeBase58(value: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let numeric = 0n;
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) return null;
    numeric = numeric * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (numeric > 0n) {
    bytes.unshift(Number(numeric & 0xffn));
    numeric >>= 8n;
  }
  let leadingZeros = 0;
  while (value[leadingZeros] === "1") leadingZeros += 1;
  return Buffer.from([...new Array<number>(leadingZeros).fill(0), ...bytes]);
}

function requiredReason(value: unknown) {
  const reason = requiredText(value, "Admin reason is required.");
  if (reason.length < 5) {
    throw new CoinWalletError(
      "ADMIN_REASON_REQUIRED",
      "Admin reason must contain at least five characters.",
    );
  }
  return reason;
}

function optionalReason(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, "Reason must be a string.");
}

function requiredActor(value: unknown) {
  return requiredText(value, "Admin actor is required.");
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CoinWalletError("INVALID_COIN_WALLET_REQUEST", message);
  }
  return value.trim();
}

function optionalText(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new CoinWalletError(
      "INVALID_COIN_WALLET_REQUEST",
      "Optional text fields must be strings.",
    );
  }
  return value.trim() || null;
}

function requiredUuidLike(value: unknown, message: string) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    throw new CoinWalletError("INVALID_COIN_WALLET_REQUEST", message);
  }
  return value.trim();
}

function parseConfirmations(value: unknown) {
  const text =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : "0";
  if (!/^\d+$/.test(text)) return 0;
  const parsed = BigInt(text);
  return parsed > 2_147_483_647n ? 2_147_483_647 : Number(parsed);
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (isRecord(value)) return value;
    if (Array.isArray(value)) {
      const record = value.find(isRecord);
      if (record) return record;
    }
  }
  return null;
}

function firstArrayRecord(value: unknown) {
  return Array.isArray(value) ? value.find(isRecord) ?? null : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null);
}

function hashJson(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}

function clampLimit(value: number) {
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(value, 500)) : 100;
}

const depositColumns = `
  id, provider, provider_event_id, provider_transaction_id,
  blockchain_tx_hash, event_index, network, token_contract, destination_address,
  deposit_intent_id, user_id, gross_usdt_atomic::text,
  network_fee_usdt_atomic::text, provider_fee_usdt_atomic::text,
  net_usdt_atomic::text, rate_snapshot_id, usd_value_micros::text,
  credited_coin_micros::text, ledger_entry_id, reversal_ledger_entry_id,
  last_provider_event_id,
  required_confirmations, actual_confirmations, status, manual_review_reason,
  detected_at, confirmed_at, credited_at, created_at, updated_at`;

const depositSelectSql = `select ${depositColumns} from crypto_deposits`;

const rateColumns = `
  id, base_asset, network, quote_currency, rate_nanos::text, source, kind,
  purpose, quoted_at, expires_at, provider_reference, created_at`;

const quoteColumns = `
  id, user_id, asset, network, destination_address,
  coin_to_debit_micros::text, estimated_usdt_atomic::text,
  network_fee_usdt_atomic::text, provider_fee_usdt_atomic::text,
  rate_snapshot_id, status, expires_at, idempotency_key, request_fingerprint,
  created_at`;

const withdrawalColumns = `
  id, user_id, withdrawal_quote_id, asset, network, destination_address,
  coin_reserved_micros::text, coin_debited_micros::text,
  estimated_usdt_atomic::text, final_usdt_atomic::text,
  network_fee_usdt_atomic::text, provider_fee_usdt_atomic::text,
  reserve_ledger_entry_id, final_ledger_entry_id, release_ledger_entry_id,
  final_rate_snapshot_id, fireblocks_reference, failure_state, review_reason,
  reviewed_by_actor, reviewed_at, status, idempotency_key,
  real_transfer_blocked, block_reason, created_at, updated_at, metadata`;

const withdrawalSelectSql =
  `select ${withdrawalColumns} from wallet_withdrawal_requests`;
