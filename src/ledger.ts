import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditLogRepository } from "./audit.js";
import type { Database, Queryable } from "./db.js";
import { numberFromDb, sortJsonValue, stableStringify, toIsoString } from "./utils.js";

export type LedgerEntryType =
  | "credit"
  | "debit"
  | "hold"
  | "release"
  | "trade_debit"
  | "trade_credit"
  | "adjustment";

export type LedgerEntry = {
  id: string;
  userId: string;
  walletId: string | null;
  asset: "USDT";
  entryType: LedgerEntryType;
  amount: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type LedgerBalance = {
  userId: string;
  walletId: string | null;
  asset: "USDT";
  availableBalance: number;
  totalCredited: number;
  totalDebited: number;
  totalHeld: number;
  totalReleased: number;
};

export type CreateLedgerEntryInput = {
  userId: string;
  walletId?: string | null;
  asset?: "USDT";
  entryType: LedgerEntryType;
  amount: number;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  auditEvent?: AuditEvent | ((result: CreateLedgerEntryResult) => AuditEvent | null) | null;
};

export type LedgerRuntimePolicy = {
  appMode?: string;
  nodeEnv?: string;
  productionDeployment?: boolean;
  localLedgerCreditApiEnabled?: boolean;
  localDepositWebhookCreditEnabled?: boolean;
  adminManualDepositCreditEnabled?: boolean;
  adminActivitySeedApiEnabled?: boolean;
  localSimulatedTradingEnabled?: boolean;
  realTradingExecutionEnabled?: boolean;
  realWithdrawalTransferEnabled?: boolean;
  marketSettlementCreditEnabled?: boolean;
};

export type LedgerRuntimeCapabilities = {
  localLedgerCreditApiConfigured: boolean;
  localLedgerCreditApiEnabled: boolean;
  localLedgerCreditApiBlockReason: string | null;
  localDepositWebhookCreditEnabled: boolean;
  adminManualDepositCreditEnabled: boolean;
  adminActivitySeedCreditEnabled: boolean;
  localSimulatedTradingEnabled: boolean;
  realTradingExecutionEnabled: boolean;
  realWithdrawalTransferEnabled: boolean;
  marketSettlementCreditEnabled: boolean;
  unclassifiedProductionCreditsBlocked: boolean;
};

export type LedgerRuntimeReadinessBlockerCode =
  | "LOCAL_LEDGER_CREDIT_API_ENABLED"
  | "LOCAL_DEPOSIT_WEBHOOK_CREDIT_ENABLED"
  | "ADMIN_MANUAL_DEPOSIT_CREDIT_ENABLED"
  | "ADMIN_ACTIVITY_SEED_CREDIT_ENABLED"
  | "LOCAL_SIMULATED_LEDGER_ENABLED"
  | "REAL_TRADING_LEDGER_DISABLED"
  | "REAL_WITHDRAWAL_LEDGER_DISABLED"
  | "MARKET_SETTLEMENT_LEDGER_DISABLED"
  | "UNCLASSIFIED_PRODUCTION_CREDITS_NOT_BLOCKED";

export type LedgerRuntimeReadinessBlocker = {
  source: "ledger";
  code: LedgerRuntimeReadinessBlockerCode;
  message: string;
};

type LedgerPolicySource =
  | "local_ledger_credit"
  | "local_deposit_webhook"
  | "admin_deposit_review"
  | "admin_seed"
  | "local_simulated_trading"
  | "real_trading_execution"
  | "real_withdrawal_transfer"
  | "market_settlement"
  | "unknown_balance_credit"
  | "unrestricted";

export type LedgerRepository = {
  createEntry(entry: LedgerEntry): Promise<void>;
  createEntryAtomically?(input: CreateLedgerEntryInput): Promise<CreateLedgerEntryResult>;
  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<LedgerEntry | null>;
  getBalance?(input: {
    userId: string;
    asset?: "USDT";
    walletId?: string | null;
  }): Promise<LedgerBalance>;
  listEntries(input: {
    userId: string;
    asset?: "USDT";
    walletId?: string | null;
    limit?: number;
  }): Promise<LedgerEntry[]>;
};

export type CreateLedgerEntryResult = {
  entry: LedgerEntry;
  balance: LedgerBalance;
  idempotent: boolean;
  audit?: {
    committed: boolean;
  };
};

export class LedgerError extends Error {
  constructor(
    public readonly code:
      | "INVALID_LEDGER_AMOUNT"
      | "INVALID_LEDGER_DATE"
      | "INVALID_LEDGER_REASON"
      | "IDEMPOTENCY_KEY_REQUIRED"
      | "IDEMPOTENCY_KEY_REUSE_MISMATCH"
      | "INSUFFICIENT_LEDGER_BALANCE"
      | "LEDGER_RUNTIME_POLICY_REQUIRED"
      | "LEDGER_ENTRY_POLICY_DISABLED",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export class MemoryLedgerRepository implements LedgerRepository {
  private readonly entries: LedgerEntry[] = [];
  private readonly idempotencyIndex = new Map<string, LedgerEntry>();

  async createEntry(entry: LedgerEntry) {
    this.entries.unshift(entry);
    this.idempotencyIndex.set(getIdempotencyScope(entry.userId, entry.idempotencyKey), entry);
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string) {
    return this.idempotencyIndex.get(getIdempotencyScope(userId, idempotencyKey)) ?? null;
  }

  async listEntries({
    userId,
    asset,
    walletId,
    limit = 100,
  }: {
    userId: string;
    asset?: "USDT";
    walletId?: string | null;
    limit?: number;
  }) {
    return this.entries
      .filter((entry) => entry.userId === userId)
      .filter((entry) => (asset ? entry.asset === asset : true))
      .filter((entry) => (walletId === undefined ? true : entry.walletId === walletId))
      .slice(0, limit);
  }
}

type LedgerEntryRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  asset: "USDT";
  entry_type: LedgerEntryType;
  amount: string | number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  idempotency_key: string;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
};

type LedgerBalanceRow = {
  total_credited: string | number | null;
  total_debited: string | number | null;
  total_held: string | number | null;
  total_released: string | number | null;
  available_balance: string | number | null;
};

function hasTransaction(db: Queryable | Database): db is Database {
  return typeof (db as Database).transaction === "function";
}

export class PostgresLedgerRepository implements LedgerRepository {
  constructor(
    private readonly db: Queryable | Database,
    private readonly runtimePolicy?: LedgerRuntimePolicy,
  ) {}

  async createEntry(entry: LedgerEntry) {
    assertPersistentLedgerRuntimePolicy(this.runtimePolicy);
    assertLedgerRuntimePolicyAllowsEntry(entry, this.runtimePolicy);
    await this.insertEntry(this.db, entry);
  }

  async createEntryAtomically(input: CreateLedgerEntryInput) {
    assertPersistentLedgerRuntimePolicy(this.runtimePolicy);
    assertLedgerRuntimePolicyAllowsEntry(input, this.runtimePolicy);

    if (hasTransaction(this.db)) {
      return this.db.transaction((client) => this.createEntryAtomicallyIn(client, input));
    }

    return this.createEntryAtomicallyIn(this.db, input);
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string) {
    return this.findByIdempotencyKeyIn(this.db, userId, idempotencyKey);
  }

  async getBalance(input: {
    userId: string;
    asset?: "USDT";
    walletId?: string | null;
  }) {
    return this.getBalanceIn(this.db, input);
  }

  async listEntries(input: {
    userId: string;
    asset?: "USDT";
    walletId?: string | null;
    limit?: number;
  }) {
    const values: unknown[] = [input.userId, input.asset ?? "USDT"];
    const walletSql = buildWalletFilterSql(input.walletId, values);
    values.push(input.limit ?? 100);

    const result = await this.db.query<LedgerEntryRow>(
      `select
         id, user_id, wallet_id, asset, entry_type, amount, reason, reference_type,
         reference_id, idempotency_key, metadata, created_at
       from ledger_entries
       where user_id = $1 and asset = $2 ${walletSql}
       order by created_at desc
       limit $${values.length}`,
      values,
    );

    return result.rows.map(mapLedgerEntry);
  }

  private async insertEntry(db: Queryable, entry: LedgerEntry) {
    await db.query(
      `insert into ledger_entries (
         id, user_id, wallet_id, asset, entry_type, amount, reason, reference_type,
         reference_id, idempotency_key, metadata, created_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $12)`,
      [
        entry.id,
        entry.userId,
        entry.walletId,
        entry.asset,
        entry.entryType,
        entry.amount,
        entry.reason,
        entry.referenceType,
        entry.referenceId,
        entry.idempotencyKey,
        JSON.stringify(entry.metadata),
        entry.createdAt,
      ],
    );
  }

  private async createEntryAtomicallyIn(
    client: Queryable,
    input: CreateLedgerEntryInput,
  ): Promise<CreateLedgerEntryResult> {
    const asset = input.asset ?? "USDT";
    const walletId = input.walletId ?? null;
    const idempotencyKey = input.idempotencyKey.trim();

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `ledger:${input.userId}`,
    ]);

    const previous = await this.findByIdempotencyKeyIn(client, input.userId, idempotencyKey);
    if (previous) {
      assertLedgerIdempotencyMatches(previous, input);
      return {
        entry: previous,
        balance: await this.getBalanceIn(client, {
          userId: input.userId,
          asset: previous.asset,
          walletId: previous.walletId,
        }),
        idempotent: true,
        audit: input.auditEvent
          ? {
              committed: false,
            }
          : undefined,
      };
    }

    const balanceBefore = await this.getBalanceIn(client, {
      userId: input.userId,
      asset,
      walletId,
    });
    const heldBalance = balanceBefore.totalHeld - balanceBefore.totalReleased;

    if (input.entryType === "release" && input.amount > heldBalance + Number.EPSILON) {
      throw new LedgerError(
        "INSUFFICIENT_LEDGER_BALANCE",
        "Insufficient held ledger balance for this release.",
      );
    }

    const availableAfter = balanceBefore.availableBalance + getAvailableBalanceEffect(input);
    if (availableAfter < -Number.EPSILON) {
      throw new LedgerError(
        "INSUFFICIENT_LEDGER_BALANCE",
        "Insufficient ledger-derived balance for this operation.",
      );
    }

    const entry: LedgerEntry = {
      id: randomUUID(),
      userId: input.userId,
      walletId,
      asset,
      entryType: input.entryType,
      amount: input.amount,
      reason: input.reason.trim(),
      referenceType: input.referenceType?.trim() || null,
      referenceId: input.referenceId?.trim() || null,
      idempotencyKey,
      metadata: input.metadata ?? {},
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    await this.insertEntry(client, entry);

    const result = {
      entry,
      balance: await this.getBalanceIn(client, {
        userId: input.userId,
        asset: entry.asset,
        walletId: entry.walletId,
      }),
      idempotent: false,
      audit: input.auditEvent
        ? {
            committed: true,
          }
        : undefined,
    };

    const auditEvent = resolveLedgerAuditEvent(input.auditEvent, result);
    if (auditEvent) {
      await this.insertAuditEventAtomically(client, auditEvent);
    }

    return result;
  }

  private async insertAuditEventAtomically(db: Queryable, event: AuditEvent) {
    await db.query(
      `insert into audit_logs (id, event_type, user_id, session_id, metadata, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        event.id,
        event.eventType,
        event.userId,
        event.sessionId,
        JSON.stringify(event.metadata),
        event.createdAt,
      ],
    );
  }

  private async findByIdempotencyKeyIn(
    db: Queryable,
    userId: string,
    idempotencyKey: string,
  ) {
    const result = await db.query<LedgerEntryRow>(
      `select
         id, user_id, wallet_id, asset, entry_type, amount, reason, reference_type,
         reference_id, idempotency_key, metadata, created_at
       from ledger_entries
       where user_id = $1 and idempotency_key = $2
       limit 1`,
      [userId, idempotencyKey],
    );

    const row = result.rows[0];
    return row ? mapLedgerEntry(row) : null;
  }

  private async getBalanceIn(
    db: Queryable,
    input: {
      userId: string;
      asset?: "USDT";
      walletId?: string | null;
    },
  ): Promise<LedgerBalance> {
    const values: unknown[] = [input.userId, input.asset ?? "USDT"];
    const walletSql = buildWalletFilterSql(input.walletId, values);
    const result = await db.query<LedgerBalanceRow>(
      `select
         coalesce(sum(case when entry_type in ('credit', 'trade_credit')
           or (entry_type = 'adjustment' and metadata ->> 'adjustmentDirection' is distinct from 'debit')
           then amount else 0 end), 0) as total_credited,
         coalesce(sum(case when entry_type in ('debit', 'trade_debit')
           or (entry_type = 'adjustment' and metadata ->> 'adjustmentDirection' = 'debit')
           then amount else 0 end), 0) as total_debited,
         coalesce(sum(case when entry_type = 'hold' then amount else 0 end), 0) as total_held,
         coalesce(sum(case when entry_type = 'release' then amount else 0 end), 0) as total_released,
         coalesce(sum(case
           when entry_type in ('credit', 'trade_credit') then amount
           when entry_type in ('debit', 'trade_debit') then -amount
           when entry_type = 'hold' then -amount
           when entry_type = 'release' then amount
           when entry_type = 'adjustment' and metadata ->> 'adjustmentDirection' = 'debit' then -amount
           when entry_type = 'adjustment' then amount
           else 0
         end), 0) as available_balance
       from ledger_entries
       where user_id = $1 and asset = $2 ${walletSql}`,
      values,
    );

    const row = result.rows[0];
    return {
      userId: input.userId,
      walletId: input.walletId ?? null,
      asset: input.asset ?? "USDT",
      availableBalance: numberFromDb(row?.available_balance),
      totalCredited: numberFromDb(row?.total_credited),
      totalDebited: numberFromDb(row?.total_debited),
      totalHeld: numberFromDb(row?.total_held),
      totalReleased: numberFromDb(row?.total_released),
    };
  }
}

export function buildLedgerService(
  repository: LedgerRepository,
  runtimePolicy?: LedgerRuntimePolicy,
  auditRepository?: AuditLogRepository,
) {
  async function createEntry(input: CreateLedgerEntryInput) {
    validateLedgerInput(input);
    assertLedgerRuntimePolicyAllowsEntry(input, runtimePolicy);

    if (repository.createEntryAtomically) {
      return repository.createEntryAtomically(input);
    }

    const idempotencyKey = input.idempotencyKey.trim();
    const previous = await repository.findByIdempotencyKey(input.userId, idempotencyKey);

    if (previous) {
      assertLedgerIdempotencyMatches(previous, input);
      return {
        entry: previous,
        balance: await getBalance({
          userId: input.userId,
          asset: previous.asset,
          walletId: previous.walletId,
        }),
        idempotent: true,
      };
    }

    const balanceBefore = await getBalance({
      userId: input.userId,
      asset: input.asset ?? "USDT",
      walletId: input.walletId ?? null,
    });
    const heldBalance = balanceBefore.totalHeld - balanceBefore.totalReleased;

    if (input.entryType === "release" && input.amount > heldBalance + Number.EPSILON) {
      throw new LedgerError(
        "INSUFFICIENT_LEDGER_BALANCE",
        "Insufficient held ledger balance for this release.",
      );
    }

    const availableAfter = balanceBefore.availableBalance + getAvailableBalanceEffect(input);

    if (availableAfter < -Number.EPSILON) {
      throw new LedgerError(
        "INSUFFICIENT_LEDGER_BALANCE",
        "Insufficient ledger-derived balance for this operation.",
      );
    }

    const entry: LedgerEntry = {
      id: randomUUID(),
      userId: input.userId,
      walletId: input.walletId ?? null,
      asset: input.asset ?? "USDT",
      entryType: input.entryType,
      amount: input.amount,
      reason: input.reason.trim(),
      referenceType: input.referenceType?.trim() || null,
      referenceId: input.referenceId?.trim() || null,
      idempotencyKey,
      metadata: input.metadata ?? {},
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    await repository.createEntry(entry);

    const result = {
      entry,
      balance: await getBalance({
        userId: input.userId,
        asset: entry.asset,
        walletId: entry.walletId,
      }),
      idempotent: false,
      audit: input.auditEvent
        ? {
            committed: Boolean(auditRepository),
          }
        : undefined,
    };

    const auditEvent = resolveLedgerAuditEvent(input.auditEvent, result);
    if (auditEvent && auditRepository) {
      await auditRepository.record(auditEvent);
    }

    return result;
  }

  async function getBalance(input: {
    userId: string;
    asset?: "USDT";
    walletId?: string | null;
  }): Promise<LedgerBalance> {
    if (repository.getBalance) {
      return repository.getBalance(input);
    }

    const entries = await repository.listEntries({
      userId: input.userId,
      asset: input.asset ?? "USDT",
      walletId: input.walletId,
      limit: Number.MAX_SAFE_INTEGER,
    });
    const totals = getLedgerTotals(entries);

    return {
      userId: input.userId,
      walletId: input.walletId ?? null,
      asset: input.asset ?? "USDT",
      availableBalance: totals.availableBalance,
      totalCredited: totals.totalCredited,
      totalDebited: totals.totalDebited,
      totalHeld: totals.totalHeld,
      totalReleased: totals.totalReleased,
    };
  }

  async function listEntries(input: {
    userId: string;
    asset?: "USDT";
    walletId?: string | null;
    limit?: number;
  }) {
    return repository.listEntries(input);
  }

  async function getTotals(input: {
    userId: string;
    asset?: "USDT";
    walletId?: string | null;
  }) {
    const balance = await getBalance(input);

    return {
      totalCredited: balance.totalCredited,
      totalDebited: balance.totalDebited,
      totalHeld: balance.totalHeld,
      totalReleased: balance.totalReleased,
    };
  }

  return {
    createEntry,
    getBalance,
    getTotals,
    listEntries,
    repository,
  };
}

export type LedgerService = ReturnType<typeof buildLedgerService>;

function validateLedgerInput(input: CreateLedgerEntryInput) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new LedgerError("INVALID_LEDGER_AMOUNT", "Ledger amount must be greater than zero.");
  }

  if (!input.reason.trim()) {
    throw new LedgerError("INVALID_LEDGER_REASON", "Ledger reason is required.");
  }

  if (!input.idempotencyKey.trim()) {
    throw new LedgerError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.");
  }

  if (input.createdAt && Number.isNaN(Date.parse(input.createdAt))) {
    throw new LedgerError("INVALID_LEDGER_DATE", "createdAt must be a valid ISO date string.");
  }
}

function resolveLedgerAuditEvent(
  auditEvent: CreateLedgerEntryInput["auditEvent"],
  result: CreateLedgerEntryResult,
) {
  return typeof auditEvent === "function" ? auditEvent(result) : auditEvent ?? null;
}

function assertLedgerRuntimePolicyAllowsEntry(
  input: CreateLedgerEntryInput,
  policy?: LedgerRuntimePolicy,
) {
  if (!policy) {
    return;
  }

  const source = classifyLedgerPolicySource(input);
  const capabilities = buildLedgerRuntimeCapabilities(policy);
  const disabledReason = (() => {
    switch (source) {
      case "local_ledger_credit":
        return capabilities.localLedgerCreditApiEnabled
          ? null
          : capabilities.localLedgerCreditApiBlockReason ?? "LOCAL_LEDGER_CREDIT_API_DISABLED";
      case "local_deposit_webhook":
        return capabilities.localDepositWebhookCreditEnabled
          ? null
          : "LOCAL_DEPOSIT_WEBHOOK_CREDIT_DISABLED";
      case "admin_deposit_review":
        return capabilities.adminManualDepositCreditEnabled
          ? null
          : "ADMIN_MANUAL_DEPOSIT_CREDIT_DISABLED";
      case "admin_seed":
        return capabilities.adminActivitySeedCreditEnabled
          ? null
          : "ADMIN_ACTIVITY_SEED_LEDGER_DISABLED";
      case "local_simulated_trading":
        return capabilities.localSimulatedTradingEnabled
          ? null
          : "LOCAL_SIMULATED_LEDGER_DISABLED";
      case "real_trading_execution":
        return capabilities.realTradingExecutionEnabled
          ? null
          : "REAL_TRADING_LEDGER_DISABLED";
      case "real_withdrawal_transfer":
        return capabilities.realWithdrawalTransferEnabled
          ? null
          : "REAL_WITHDRAWAL_LEDGER_DISABLED";
      case "market_settlement":
        return capabilities.marketSettlementCreditEnabled
          ? null
          : "MARKET_SETTLEMENT_LEDGER_DISABLED";
      case "unknown_balance_credit":
        return capabilities.unclassifiedProductionCreditsBlocked
          ? "UNCLASSIFIED_PRODUCTION_CREDIT"
          : null;
      case "unrestricted":
        return null;
    }
  })();

  if (!disabledReason) {
    return;
  }

  throw new LedgerError(
    "LEDGER_ENTRY_POLICY_DISABLED",
    `Ledger entry source is disabled by runtime policy: ${disabledReason}.`,
    403,
  );
}

function assertPersistentLedgerRuntimePolicy(policy?: LedgerRuntimePolicy) {
  if (policy) {
    return;
  }

  throw new LedgerError(
    "LEDGER_RUNTIME_POLICY_REQUIRED",
    "Persistent ledger writes require an explicit runtime policy.",
    500,
  );
}

export function buildLedgerRuntimeCapabilities(
  policy: LedgerRuntimePolicy,
): LedgerRuntimeCapabilities {
  const localLedgerCreditApiBlockReason = getLocalLedgerCreditApiBlockReason(policy);

  return {
    localLedgerCreditApiConfigured: Boolean(policy.localLedgerCreditApiEnabled),
    localLedgerCreditApiEnabled: localLedgerCreditApiBlockReason === null,
    localLedgerCreditApiBlockReason,
    localDepositWebhookCreditEnabled: isLocalRuntimeCreditSurfaceEnabled(
      policy,
      policy.localDepositWebhookCreditEnabled,
    ),
    adminManualDepositCreditEnabled: isLocalRuntimeCreditSurfaceEnabled(
      policy,
      policy.adminManualDepositCreditEnabled,
    ),
    adminActivitySeedCreditEnabled: isLocalRuntimeCreditSurfaceEnabled(
      policy,
      policy.adminActivitySeedApiEnabled,
    ),
    localSimulatedTradingEnabled: isLocalRuntimeCreditSurfaceEnabled(
      policy,
      policy.localSimulatedTradingEnabled,
    ),
    realTradingExecutionEnabled: Boolean(policy.realTradingExecutionEnabled),
    realWithdrawalTransferEnabled: Boolean(policy.realWithdrawalTransferEnabled),
    marketSettlementCreditEnabled: Boolean(policy.marketSettlementCreditEnabled),
    unclassifiedProductionCreditsBlocked: isProductionRuntimePolicy(policy),
  };
}

export function getLedgerRuntimeReadinessBlockerDetails(
  capabilities: LedgerRuntimeCapabilities,
): LedgerRuntimeReadinessBlocker[] {
  const blockers: LedgerRuntimeReadinessBlocker[] = [];
  const addBlocker = (code: LedgerRuntimeReadinessBlockerCode, message: string) => {
    blockers.push({
      source: "ledger",
      code,
      message,
    });
  };

  if (capabilities.localLedgerCreditApiEnabled) {
    addBlocker(
      "LOCAL_LEDGER_CREDIT_API_ENABLED",
      "Local ledger self-credit API must be disabled for real-money readiness.",
    );
  }
  if (capabilities.localDepositWebhookCreditEnabled) {
    addBlocker(
      "LOCAL_DEPOSIT_WEBHOOK_CREDIT_ENABLED",
      "Local deposit webhook ledger credits must be disabled for real-money readiness.",
    );
  }
  if (capabilities.adminManualDepositCreditEnabled) {
    addBlocker(
      "ADMIN_MANUAL_DEPOSIT_CREDIT_ENABLED",
      "Manual admin deposit ledger credits must be disabled for real-money readiness.",
    );
  }
  if (capabilities.adminActivitySeedCreditEnabled) {
    addBlocker(
      "ADMIN_ACTIVITY_SEED_CREDIT_ENABLED",
      "Admin seed ledger credits must be disabled for real-money readiness.",
    );
  }
  if (capabilities.localSimulatedTradingEnabled) {
    addBlocker(
      "LOCAL_SIMULATED_LEDGER_ENABLED",
      "Local simulated trading ledger credits must be disabled for real-money readiness.",
    );
  }
  if (!capabilities.realTradingExecutionEnabled) {
    addBlocker(
      "REAL_TRADING_LEDGER_DISABLED",
      "Real trading ledger entries are disabled; execution fills cannot be reflected in balances.",
    );
  }
  if (!capabilities.realWithdrawalTransferEnabled) {
    addBlocker(
      "REAL_WITHDRAWAL_LEDGER_DISABLED",
      "Real withdrawal ledger entries are disabled; provider broadcasts cannot be reflected in balances.",
    );
  }
  if (!capabilities.marketSettlementCreditEnabled) {
    addBlocker(
      "MARKET_SETTLEMENT_LEDGER_DISABLED",
      "Market settlement ledger credits are disabled; real-money settlement payouts cannot be posted.",
    );
  }
  if (!capabilities.unclassifiedProductionCreditsBlocked) {
    addBlocker(
      "UNCLASSIFIED_PRODUCTION_CREDITS_NOT_BLOCKED",
      "Unclassified production balance credits must be blocked for real-money readiness.",
    );
  }

  return blockers;
}

function getLocalLedgerCreditApiBlockReason(policy: LedgerRuntimePolicy) {
  if (!policy.localLedgerCreditApiEnabled) {
    return "LOCAL_LEDGER_CREDIT_API_DISABLED";
  }

  if (isProductionRuntimePolicy(policy)) {
    return "LOCAL_LEDGER_CREDIT_API_PRODUCTION_DISABLED";
  }

  if (policy.appMode !== "local") {
    return "LOCAL_LEDGER_CREDIT_API_APP_MODE_DISABLED";
  }

  return null;
}

function isProductionRuntimePolicy(policy: LedgerRuntimePolicy) {
  return Boolean(policy.productionDeployment) || policy.nodeEnv === "production";
}

function isLocalRuntimeCreditSurfaceEnabled(
  policy: LedgerRuntimePolicy,
  configured: boolean | undefined,
) {
  return Boolean(configured) && policy.appMode === "local" && !isProductionRuntimePolicy(policy);
}

function classifyLedgerPolicySource(input: CreateLedgerEntryInput): LedgerPolicySource {
  const source =
    input.metadata && typeof input.metadata.source === "string"
      ? input.metadata.source
      : null;
  const reason = input.reason.trim();
  const referenceType = input.referenceType?.trim() || null;

  if (source === "ledger_credit" || reason === "ledger_credit" || referenceType === "ledger_credit") {
    return "local_ledger_credit";
  }

  if (source === "local_deposit_webhook") {
    return "local_deposit_webhook";
  }

  if (source === "admin_deposit_review") {
    return "admin_deposit_review";
  }

  if (
    source === "admin_seed" ||
    reason.startsWith("admin_seed_") ||
    referenceType === "admin_seed_payment"
  ) {
    return "admin_seed";
  }

  if (
    referenceType === "local_init" ||
    referenceType === "local_reset" ||
    referenceType === "local_trade"
  ) {
    return "local_simulated_trading";
  }

  if (referenceType === "real_trade") {
    return "real_trading_execution";
  }

  if (source === "real_withdrawal_broadcast" || referenceType === "real_withdrawal") {
    return "real_withdrawal_transfer";
  }

  if (referenceType === "market_settlement") {
    return "market_settlement";
  }

  return isBalanceCreditEntry(input) ? "unknown_balance_credit" : "unrestricted";
}

function isBalanceCreditEntry(input: CreateLedgerEntryInput) {
  if (input.entryType === "credit" || input.entryType === "trade_credit") {
    return true;
  }

  return input.entryType === "adjustment" && input.metadata?.adjustmentDirection !== "debit";
}

function getLedgerTotals(entries: LedgerEntry[]) {
  return entries.reduce(
    (totals, entry) => {
      switch (entry.entryType) {
        case "credit":
        case "trade_credit":
          totals.totalCredited += entry.amount;
          totals.availableBalance += entry.amount;
          break;
        case "debit":
        case "trade_debit":
          totals.totalDebited += entry.amount;
          totals.availableBalance -= entry.amount;
          break;
        case "hold":
          totals.totalHeld += entry.amount;
          totals.availableBalance -= entry.amount;
          break;
        case "release":
          totals.totalReleased += entry.amount;
          totals.availableBalance += entry.amount;
          break;
        case "adjustment":
          if (entry.metadata.adjustmentDirection === "debit") {
            totals.totalDebited += entry.amount;
            totals.availableBalance -= entry.amount;
          } else {
            totals.totalCredited += entry.amount;
            totals.availableBalance += entry.amount;
          }
          break;
      }

      return totals;
    },
    {
      availableBalance: 0,
      totalCredited: 0,
      totalDebited: 0,
      totalHeld: 0,
      totalReleased: 0,
    },
  );
}

function getAvailableBalanceEffect(input: CreateLedgerEntryInput) {
  const pseudoEntry: LedgerEntry = {
    id: "",
    userId: input.userId,
    walletId: input.walletId ?? null,
    asset: input.asset ?? "USDT",
    entryType: input.entryType,
    amount: input.amount,
    reason: input.reason,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata ?? {},
    createdAt: "",
  };

  return getLedgerTotals([pseudoEntry]).availableBalance;
}

function assertLedgerIdempotencyMatches(previous: LedgerEntry, input: CreateLedgerEntryInput) {
  const previousFingerprint = buildLedgerEntryFingerprint(previous);
  const inputFingerprint = buildLedgerInputFingerprint(input);

  if (previousFingerprint !== inputFingerprint) {
    throw new LedgerError(
      "IDEMPOTENCY_KEY_REUSE_MISMATCH",
      "Idempotency-Key was already used for a different ledger entry.",
      409,
    );
  }
}

function buildLedgerEntryFingerprint(entry: LedgerEntry) {
  return stableStringify({
    userId: entry.userId,
    walletId: entry.walletId,
    asset: entry.asset,
    entryType: entry.entryType,
    amount: entry.amount,
    reason: entry.reason,
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    metadata: normalizeJsonValue(entry.metadata),
  });
}

function buildLedgerInputFingerprint(input: CreateLedgerEntryInput) {
  return stableStringify({
    userId: input.userId,
    walletId: input.walletId ?? null,
    asset: input.asset ?? "USDT",
    entryType: input.entryType,
    amount: input.amount,
    reason: input.reason.trim(),
    referenceType: input.referenceType?.trim() || null,
    referenceId: input.referenceId?.trim() || null,
    metadata: normalizeJsonValue(input.metadata ?? {}),
  });
}

function normalizeJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function getIdempotencyScope(userId: string, idempotencyKey: string) {
  return `${userId}:${idempotencyKey}`;
}

function buildWalletFilterSql(walletId: string | null | undefined, values: unknown[]) {
  if (walletId === undefined) {
    return "";
  }

  if (walletId === null) {
    return "and wallet_id is null";
  }

  values.push(walletId);
  return `and wallet_id = $${values.length}`;
}

function mapLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    walletId: row.wallet_id,
    asset: row.asset,
    entryType: row.entry_type,
    amount: numberFromDb(row.amount),
    reason: row.reason,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata ?? {},
    createdAt: toIsoString(row.created_at),
  };
}
