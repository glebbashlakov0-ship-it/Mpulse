import type { Database, Queryable } from "./db.js";
import { coinMicros, serializeCoinMicros, type CoinMicros } from "./money.js";

export type CoinOperationType =
  | "crypto_deposit_credit"
  | "withdrawal_reserve"
  | "withdrawal_debit"
  | "withdrawal_release"
  | "trade_reserve"
  | "trade_debit"
  | "trade_release"
  | "trade_settlement_credit"
  | "fee_debit"
  | "refund_credit"
  | "bonus_credit"
  | "admin_credit"
  | "admin_debit"
  | "migration_credit"
  | "correction_credit"
  | "correction_debit"
  | "reversed_deposit";

export type CoinBalance = {
  userId: string;
  availableCoinMicros: string;
  reservedCoinMicros: string;
  totalCoinMicros: string;
};

export type CoinLedgerEntry = {
  id: string;
  userId: string;
  operationType: CoinOperationType;
  availableDeltaCoinMicros: string;
  reservedDeltaCoinMicros: string;
  availableAfterCoinMicros: string;
  reservedAfterCoinMicros: string;
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
  externalReference: string | null;
  rateSnapshotId: string | null;
  reason: string;
  adminUserId: string | null;
  adminActor: string | null;
  auditMetadata: Record<string, unknown>;
  createdAt: string;
};

export type PostCoinEntryInput = {
  userId: string;
  operationType: CoinOperationType;
  availableDeltaCoinMicros: bigint;
  reservedDeltaCoinMicros?: bigint;
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
  reason: string;
  externalReference?: string | null;
  rateSnapshotId?: string | null;
  adminUserId?: string | null;
  adminActor?: string | null;
  auditMetadata?: Record<string, unknown>;
};

export type CoinLedgerRepository = {
  getBalance(userId: string): Promise<CoinBalance>;
  listEntries(userId: string, limit?: number): Promise<CoinLedgerEntry[]>;
  postEntry(input: PostCoinEntryInput): Promise<CoinLedgerEntry>;
};

type CoinAccountRow = {
  user_id: string;
  available_coin_micros: string;
  reserved_coin_micros: string;
};

type CoinEntryRow = {
  id: string;
  user_id: string;
  operation_type: CoinOperationType;
  available_delta_coin_micros: string;
  reserved_delta_coin_micros: string;
  available_after_coin_micros: string;
  reserved_after_coin_micros: string;
  idempotency_key: string;
  source_type: string;
  source_id: string;
  external_reference: string | null;
  rate_snapshot_id: string | null;
  reason: string;
  admin_user_id: string | null;
  admin_actor: string | null;
  audit_metadata: Record<string, unknown> | null;
  created_at: Date | string;
};

export class CoinLedgerError extends Error {
  constructor(
    public readonly code:
      | "COIN_IDEMPOTENCY_KEY_REQUIRED"
      | "COIN_REASON_REQUIRED"
      | "COIN_SOURCE_REQUIRED"
      | "COIN_ZERO_MOVEMENT"
      | "COIN_CUTOVER_INCOMPLETE"
      | "INSUFFICIENT_COIN_BALANCE"
      | "COIN_IDEMPOTENCY_KEY_REUSE_MISMATCH"
      | "COIN_CUTOVER_INCOMPLETE",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export class PostgresCoinLedgerRepository implements CoinLedgerRepository {
  constructor(private readonly db: Queryable | Database) {}

  async getBalance(userId: string): Promise<CoinBalance> {
    await this.assertCutoverReady();
    const result = await this.db.query<CoinAccountRow>(
      `select user_id, available_coin_micros::text, reserved_coin_micros::text
       from coin_accounts where user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    const available = row ? BigInt(row.available_coin_micros) : 0n;
    const reserved = row ? BigInt(row.reserved_coin_micros) : 0n;
    return {
      userId,
      availableCoinMicros: available.toString(),
      reservedCoinMicros: reserved.toString(),
      totalCoinMicros: (available + reserved).toString(),
    };
  }

  async listEntries(userId: string, limit = 100): Promise<CoinLedgerEntry[]> {
    await this.assertCutoverReady();
    const result = await this.db.query<CoinEntryRow>(
      `select id, user_id, operation_type, available_delta_coin_micros::text,
              reserved_delta_coin_micros::text, available_after_coin_micros::text,
              reserved_after_coin_micros::text, idempotency_key, source_type,
              source_id, external_reference, rate_snapshot_id, reason, admin_user_id,
              admin_actor, audit_metadata, created_at
       from coin_ledger_entries
       where user_id = $1 order by entry_sequence desc limit $2`,
      [userId, limit],
    );
    return result.rows.map(mapEntry);
  }

  async postEntry(input: PostCoinEntryInput): Promise<CoinLedgerEntry> {
    validatePostEntry(input);
    try {
      const result = await this.db.query<CoinEntryRow>(
        `select
           id, user_id, operation_type, available_delta_coin_micros::text,
           reserved_delta_coin_micros::text, available_after_coin_micros::text,
           reserved_after_coin_micros::text, idempotency_key, source_type, source_id,
           external_reference, rate_snapshot_id, reason, admin_user_id, admin_actor,
           audit_metadata, created_at
         from coin_post_ledger_entry(
           $1, $2, $3::bigint, $4::bigint, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
         )`,
        [
          input.userId,
          input.operationType,
          input.availableDeltaCoinMicros.toString(),
          (input.reservedDeltaCoinMicros ?? 0n).toString(),
          input.idempotencyKey,
          input.sourceType,
          input.sourceId,
          input.reason,
          input.externalReference ?? null,
          input.rateSnapshotId ?? null,
          input.adminUserId ?? null,
          input.adminActor ?? null,
          JSON.stringify(input.auditMetadata ?? {}),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Coin ledger function returned no row.");
      return mapEntry(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("INSUFFICIENT_COIN_BALANCE")) {
        throw new CoinLedgerError(
          "INSUFFICIENT_COIN_BALANCE",
          "Available or reserved Coin balance is insufficient.",
          409,
        );
      }
      if (message.includes("COIN_CUTOVER_INCOMPLETE")) {
        throw new CoinLedgerError(
          "COIN_CUTOVER_INCOMPLETE",
          "Coin ledger cutover is not active.",
          503,
        );
      }
      if (message.includes("COIN_IDEMPOTENCY_KEY_REUSE_MISMATCH")) {
        throw new CoinLedgerError(
          "COIN_IDEMPOTENCY_KEY_REUSE_MISMATCH",
          "Idempotency key was already used for a different Coin movement.",
          409,
        );
      }
      if (message.includes("COIN_CUTOVER_INCOMPLETE")) {
        throw new CoinLedgerError(
          "COIN_CUTOVER_INCOMPLETE",
          "The Coin ledger is unavailable until the controlled cutover completes.",
          503,
        );
      }
      throw error;
    }
  }

  private async assertCutoverReady() {
    const result = await this.db.query<{ active_system: string }>(
      `select active_system
       from money_system_state
       where singleton = true`,
    );
    if (result.rows[0]?.active_system !== "coin") {
      throw new CoinLedgerError(
        "COIN_CUTOVER_INCOMPLETE",
        "The Coin ledger is unavailable until the controlled cutover completes.",
        503,
      );
    }
  }
}

function validatePostEntry(input: PostCoinEntryInput) {
  if (!input.idempotencyKey.trim()) {
    throw new CoinLedgerError("COIN_IDEMPOTENCY_KEY_REQUIRED", "Idempotency key is required.");
  }
  if (!input.reason.trim()) {
    throw new CoinLedgerError("COIN_REASON_REQUIRED", "Coin movement reason is required.");
  }
  if (!input.sourceType.trim()) {
    throw new CoinLedgerError("COIN_SOURCE_REQUIRED", "Coin movement source is required.");
  }
  if (!input.sourceId.trim()) {
    throw new CoinLedgerError(
      "COIN_SOURCE_REQUIRED",
      "Coin movement related entity id is required.",
    );
  }
  if (input.availableDeltaCoinMicros === 0n && (input.reservedDeltaCoinMicros ?? 0n) === 0n) {
    throw new CoinLedgerError("COIN_ZERO_MOVEMENT", "Coin movement cannot be zero.");
  }
}

function mapEntry(row: CoinEntryRow): CoinLedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    operationType: row.operation_type,
    availableDeltaCoinMicros: BigInt(row.available_delta_coin_micros).toString(),
    reservedDeltaCoinMicros: BigInt(row.reserved_delta_coin_micros).toString(),
    availableAfterCoinMicros: BigInt(row.available_after_coin_micros).toString(),
    reservedAfterCoinMicros: BigInt(row.reserved_after_coin_micros).toString(),
    idempotencyKey: row.idempotency_key,
    sourceType: row.source_type,
    sourceId: row.source_id,
    externalReference: row.external_reference,
    rateSnapshotId: row.rate_snapshot_id,
    reason: row.reason,
    adminUserId: row.admin_user_id,
    adminActor: row.admin_actor,
    auditMetadata: row.audit_metadata ?? {},
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export function reserveCoins(
  repository: PostgresCoinLedgerRepository,
  input: Omit<PostCoinEntryInput, "operationType" | "availableDeltaCoinMicros" | "reservedDeltaCoinMicros"> & {
    amountCoinMicros: CoinMicros;
  },
) {
  return repository.postEntry({
    ...input,
    operationType: "withdrawal_reserve",
    availableDeltaCoinMicros: -input.amountCoinMicros,
    reservedDeltaCoinMicros: input.amountCoinMicros,
  });
}

export function releaseReservedCoins(
  repository: PostgresCoinLedgerRepository,
  input: Omit<PostCoinEntryInput, "operationType" | "availableDeltaCoinMicros" | "reservedDeltaCoinMicros"> & {
    amountCoinMicros: CoinMicros;
  },
) {
  return repository.postEntry({
    ...input,
    operationType: "withdrawal_release",
    availableDeltaCoinMicros: input.amountCoinMicros,
    reservedDeltaCoinMicros: -input.amountCoinMicros,
  });
}

export function publicCoinAmount(value: bigint) {
  return serializeCoinMicros(coinMicros(value));
}
