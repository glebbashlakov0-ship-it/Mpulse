import { createHash, randomUUID } from "node:crypto";
import type { Queryable } from "./db.js";
import type { LedgerService } from "./ledger.js";
import { isRecord, numberFromDb, sortJsonValue, stableStringify, toIsoString } from "./utils.js";

export const WALLET_REVIEW_MODE = "wallet_review_only" as const;
export const WALLET_REVIEW_WARNING =
  "Wallet requests are reviewed before processing.";

export const WALLET_ASSET = "USDT" as const;
export const WALLET_NETWORK = "TRON" as const;
export const WALLET_PROVIDER = "internal_wallet" as const;
export const READ_ONLY_TRON_DEPOSIT_PROVIDER = "tron_readonly_adapter" as const;

export type WalletAsset = typeof WALLET_ASSET;
export type WalletNetwork = typeof WALLET_NETWORK;
export type WalletProviderName = typeof WALLET_PROVIDER;
export type WalletStatus = "pending" | "active" | "disabled";
export type DepositIntentStatus = "waiting" | "detected" | "credited" | "expired" | "rejected";
export type DepositEventStatus =
  | "detected"
  | "confirmed"
  | "credited"
  | "rejected"
  | "manual_review";
export type WithdrawalRequestStatus =
  | "draft"
  | "pending_review"
  | "approved_for_review"
  | "approved"
  | "rejected"
  | "cancelled"
  | "broadcast_pending"
  | "broadcasted"
  | "failed";

export type Wallet = {
  id: string;
  userId: string;
  asset: WalletAsset;
  network: WalletNetwork;
  address: string;
  status: WalletStatus;
  provider: WalletProviderName;
  createdAt: string;
  updatedAt: string;
};

export type DepositIntent = {
  id: string;
  userId: string;
  walletId: string;
  asset: WalletAsset;
  network: WalletNetwork;
  address: string;
  expectedAmount: number;
  status: DepositIntentStatus;
  memo: string | null;
  reference: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type WithdrawalRequest = {
  id: string;
  userId: string;
  asset: WalletAsset;
  network: WalletNetwork;
  destinationAddress: string;
  amount: number;
  status: WithdrawalRequestStatus;
  idempotencyKey: string;
  provider: WalletProviderName;
  realTransferBlocked: true;
  blockReason: "TRANSFERS_UNAVAILABLE";
  requestFingerprint: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicWithdrawalRequest = Omit<WithdrawalRequest, "requestFingerprint">;

export type WalletDepositEvent = {
  id: string;
  txHash: string;
  logIndex: string;
  walletId: string | null;
  userId: string | null;
  amount: number;
  asset: WalletAsset;
  network: WalletNetwork;
  confirmations: number;
  status: DepositEventStatus;
  provider: string;
  recipientAddress: string | null;
  eventFingerprint: string;
  rawPayload: Record<string, unknown>;
  rejectionReason: string | null;
  creditedLedgerEntryId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicWalletDepositEvent = Omit<WalletDepositEvent, "rawPayload" | "eventFingerprint">;

export type WalletProviderEvent = {
  id: string;
  eventId: string;
  provider: WalletProviderName;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: string;
};

export type WalletProvider = {
  createDepositAddress(userId: string): Promise<{
    asset: WalletAsset;
    network: WalletNetwork;
    address: string;
    provider: WalletProviderName;
  }>;
  validateAddress(address: string): boolean;
  buildWithdrawalRequest(input: {
    userId: string;
    destinationAddress: string;
    amount: number;
    idempotencyKey: string;
  }): Promise<{
    provider: WalletProviderName;
    providerStatus: "not_submitted";
    realTransferEnabled: false;
  }>;
  getNetworkStatus(): Promise<{
    provider: WalletProviderName;
    network: WalletNetwork;
    status: "available";
    realTransfersEnabled: false;
  }>;
};

export type ParsedDepositWebhook = {
  txHash: string;
  logIndex: string;
  recipientAddress: string;
  amount: number;
  asset: string;
  network: string;
  confirmations: number;
  provider: string;
  rawPayload: Record<string, unknown>;
};

export type WalletDepositProvider = {
  providerName: string;
  parseDepositWebhook(body: unknown): ParsedDepositWebhook;
};

export type WalletRepository = {
  findWallet(input: {
    userId: string;
    asset: WalletAsset;
    network: WalletNetwork;
    provider: WalletProviderName;
  }): Promise<Wallet | null>;
  findWalletByAddress(address: string): Promise<Wallet | null>;
  saveWallet(wallet: Wallet): Promise<Wallet>;
  saveDepositIntent(intent: DepositIntent): Promise<DepositIntent>;
  listDepositIntents(userId: string): Promise<DepositIntent[]>;
  findDepositEventByTransaction(input: {
    txHash: string;
    logIndex: string;
  }): Promise<WalletDepositEvent | null>;
  saveDepositEvent(event: WalletDepositEvent): Promise<WalletDepositEvent>;
  updateDepositEvent(input: {
    id: string;
    status: DepositEventStatus;
    confirmations?: number;
    rejectionReason?: string | null;
    creditedLedgerEntryId?: string | null;
  }): Promise<WalletDepositEvent | null>;
  listDepositEvents(userId: string): Promise<WalletDepositEvent[]>;
  findWithdrawalByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<WithdrawalRequest | null>;
  saveWithdrawalRequest(request: WithdrawalRequest): Promise<WithdrawalRequest>;
  listWithdrawalRequests(userId: string): Promise<WithdrawalRequest[]>;
  listAllWithdrawalRequests(limit?: number): Promise<WithdrawalRequest[]>;
  findWithdrawalRequestById(id: string): Promise<WithdrawalRequest | null>;
  updateWithdrawalRequestStatus(input: {
    id: string;
    status: Extract<WithdrawalRequestStatus, "rejected" | "approved_for_review">;
  }): Promise<WithdrawalRequest | null>;
  findProviderEventByEventId(eventId: string): Promise<WalletProviderEvent | null>;
  saveProviderEvent(event: WalletProviderEvent): Promise<WalletProviderEvent>;
};

export class WalletError extends Error {
  constructor(
    public readonly code:
      | "INVALID_WALLET_REQUEST"
      | "UNSUPPORTED_WALLET_ASSET"
      | "UNSUPPORTED_WALLET_NETWORK"
      | "INVALID_TRON_ADDRESS"
      | "INVALID_WALLET_AMOUNT"
      | "IDEMPOTENCY_KEY_REQUIRED"
      | "REVIEW_MODE_REQUIRED"
      | "INVALID_WITHDRAWAL_STATUS"
      | "IDEMPOTENCY_KEY_REUSE_MISMATCH"
      | "INVALID_WEBHOOK_EVENT"
      | "DEPOSIT_LEDGER_UNAVAILABLE",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export class MemoryWalletRepository implements WalletRepository {
  private readonly wallets = new Map<string, Wallet>();
  private readonly depositIntents: DepositIntent[] = [];
  private readonly depositEvents: WalletDepositEvent[] = [];
  private readonly withdrawals: WithdrawalRequest[] = [];
  private readonly withdrawalsByIdempotency = new Map<string, WithdrawalRequest>();
  private readonly providerEvents = new Map<string, WalletProviderEvent>();

  async findWallet(input: {
    userId: string;
    asset: WalletAsset;
    network: WalletNetwork;
    provider: WalletProviderName;
  }) {
    return this.wallets.get(getWalletScope(input)) ?? null;
  }

  async findWalletByAddress(address: string) {
    const normalized = address.trim();
    return [...this.wallets.values()].find((wallet) => wallet.address === normalized) ?? null;
  }

  async saveWallet(wallet: Wallet) {
    this.wallets.set(getWalletScope(wallet), wallet);
    return wallet;
  }

  async saveDepositIntent(intent: DepositIntent) {
    this.depositIntents.unshift(intent);
    return intent;
  }

  async listDepositIntents(userId: string) {
    return this.depositIntents.filter((intent) => intent.userId === userId);
  }

  async findDepositEventByTransaction(input: { txHash: string; logIndex: string }) {
    return (
      this.depositEvents.find(
        (event) => event.txHash === input.txHash && event.logIndex === input.logIndex,
      ) ?? null
    );
  }

  async saveDepositEvent(event: WalletDepositEvent) {
    const existing = await this.findDepositEventByTransaction(event);
    if (existing) {
      return existing;
    }

    this.depositEvents.unshift(event);
    return event;
  }

  async updateDepositEvent(input: {
    id: string;
    status: DepositEventStatus;
    confirmations?: number;
    rejectionReason?: string | null;
    creditedLedgerEntryId?: string | null;
  }) {
    const index = this.depositEvents.findIndex((event) => event.id === input.id);
    if (index < 0) {
      return null;
    }

    const current = this.depositEvents[index];
    if (!current) {
      return null;
    }

    const next: WalletDepositEvent = {
      ...current,
      status: input.status,
      confirmations: input.confirmations ?? current.confirmations,
      rejectionReason:
        input.rejectionReason === undefined ? current.rejectionReason : input.rejectionReason,
      creditedLedgerEntryId:
        input.creditedLedgerEntryId === undefined
          ? current.creditedLedgerEntryId
          : input.creditedLedgerEntryId,
      updatedAt: new Date().toISOString(),
    };
    this.depositEvents[index] = next;
    return next;
  }

  async listDepositEvents(userId: string) {
    return this.depositEvents.filter((event) => event.userId === userId);
  }

  async findWithdrawalByIdempotencyKey(userId: string, idempotencyKey: string) {
    return this.withdrawalsByIdempotency.get(getUserScopedKey(userId, idempotencyKey)) ?? null;
  }

  async saveWithdrawalRequest(request: WithdrawalRequest) {
    this.withdrawals.unshift(request);
    this.withdrawalsByIdempotency.set(
      getUserScopedKey(request.userId, request.idempotencyKey),
      request,
    );
    return request;
  }

  async listWithdrawalRequests(userId: string) {
    return this.withdrawals.filter((request) => request.userId === userId);
  }

  async listAllWithdrawalRequests(limit = 100) {
    return this.withdrawals.slice(0, limit);
  }

  async findWithdrawalRequestById(id: string) {
    return this.withdrawals.find((request) => request.id === id) ?? null;
  }

  async updateWithdrawalRequestStatus(input: {
    id: string;
    status: Extract<WithdrawalRequestStatus, "rejected" | "approved_for_review">;
  }) {
    const index = this.withdrawals.findIndex((request) => request.id === input.id);
    if (index < 0) {
      return null;
    }

    const current = this.withdrawals[index];
    if (!current) {
      return null;
    }

    const next = {
      ...current,
      status: input.status,
      realTransferBlocked: true as const,
      blockReason: "TRANSFERS_UNAVAILABLE" as const,
      updatedAt: new Date().toISOString(),
    };
    this.withdrawals[index] = next;
    this.withdrawalsByIdempotency.set(
      getUserScopedKey(next.userId, next.idempotencyKey),
      next,
    );
    return next;
  }

  async findProviderEventByEventId(eventId: string) {
    return this.providerEvents.get(eventId) ?? null;
  }

  async saveProviderEvent(event: WalletProviderEvent) {
    this.providerEvents.set(event.eventId, event);
    return event;
  }
}

type WalletRow = {
  id: string;
  user_id: string;
  asset: WalletAsset;
  network: WalletNetwork;
  address: string;
  status: WalletStatus;
  provider: WalletProviderName;
  created_at: Date | string;
  updated_at: Date | string;
};

type DepositIntentRow = {
  id: string;
  user_id: string;
  wallet_id: string;
  asset: WalletAsset;
  network: WalletNetwork;
  address: string;
  expected_amount: string | number;
  status: DepositIntentStatus;
  memo: string | null;
  reference: string | null;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type DepositEventRow = {
  id: string;
  tx_hash: string;
  log_index: string;
  wallet_id: string | null;
  user_id: string | null;
  amount: string | number;
  asset: WalletAsset;
  network: WalletNetwork;
  confirmations: string | number;
  status: DepositEventStatus;
  provider: string;
  recipient_address: string | null;
  raw_payload: Record<string, unknown> | null;
  event_fingerprint: string;
  rejection_reason: string | null;
  credited_ledger_entry_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type WithdrawalRequestRow = {
  id: string;
  user_id: string;
  asset: WalletAsset;
  network: WalletNetwork;
  destination_address: string;
  amount: string | number;
  status: WithdrawalRequestStatus;
  idempotency_key: string;
  provider: WalletProviderName;
  real_transfer_blocked: boolean;
  block_reason: "TRANSFERS_UNAVAILABLE";
  request_fingerprint: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type ProviderEventRow = {
  id: string;
  event_id: string;
  provider: WalletProviderName;
  event_type: string;
  payload: Record<string, unknown> | null;
  received_at: Date | string;
};

export class PostgresWalletRepository implements WalletRepository {
  constructor(private readonly db: Queryable) {}

  async findWallet(input: {
    userId: string;
    asset: WalletAsset;
    network: WalletNetwork;
    provider: WalletProviderName;
  }) {
    const result = await this.db.query<WalletRow>(
      `select id, user_id, asset, network, address, status, provider, created_at, updated_at
       from wallets
       where user_id = $1 and asset = $2 and network = $3 and provider = $4 and address is not null
       limit 1`,
      [input.userId, input.asset, input.network, input.provider],
    );

    const row = result.rows[0];
    return row ? mapWallet(row) : null;
  }

  async findWalletByAddress(address: string) {
    const result = await this.db.query<WalletRow>(
      `select id, user_id, asset, network, address, status, provider, created_at, updated_at
       from wallets
       where address = $1 and asset = $2 and network = $3
       limit 1`,
      [address.trim(), WALLET_ASSET, WALLET_NETWORK],
    );

    const row = result.rows[0];
    return row ? mapWallet(row) : null;
  }

  async saveWallet(wallet: Wallet) {
    const result = await this.db.query<WalletRow>(
      `insert into wallets (
         id, user_id, asset, network, address, provider, status, balance, initial_balance,
         created_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, 0, 0, $8, $9)
       on conflict (user_id, asset, network, provider) do update set
         address = coalesce(wallets.address, excluded.address),
         status = case when wallets.status = 'disabled' then wallets.status else excluded.status end,
         updated_at = excluded.updated_at
       returning id, user_id, asset, network, address, status, provider, created_at, updated_at`,
      [
        wallet.id,
        wallet.userId,
        wallet.asset,
        wallet.network,
        wallet.address,
        wallet.provider,
        wallet.status,
        wallet.createdAt,
        wallet.updatedAt,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Wallet insert returned no row.");
    }

    return mapWallet(row);
  }

  async saveDepositIntent(intent: DepositIntent) {
    const result = await this.db.query<DepositIntentRow>(
      `insert into wallet_deposit_intents (
         id, user_id, wallet_id, asset, network, address, expected_amount, status,
         memo, reference, expires_at, created_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning
         id, user_id, wallet_id, asset, network, address, expected_amount, status,
         memo, reference, expires_at, created_at, updated_at`,
      [
        intent.id,
        intent.userId,
        intent.walletId,
        intent.asset,
        intent.network,
        intent.address,
        intent.expectedAmount,
        intent.status,
        intent.memo,
        intent.reference,
        intent.expiresAt,
        intent.createdAt,
        intent.updatedAt,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Deposit intent insert returned no row.");
    }

    return mapDepositIntent(row);
  }

  async listDepositIntents(userId: string) {
    const result = await this.db.query<DepositIntentRow>(
      `select
         id, user_id, wallet_id, asset, network, address, expected_amount, status,
         memo, reference, expires_at, created_at, updated_at
       from wallet_deposit_intents
       where user_id = $1
       order by created_at desc`,
      [userId],
    );

    return result.rows.map(mapDepositIntent);
  }

  async findDepositEventByTransaction(input: { txHash: string; logIndex: string }) {
    const result = await this.db.query<DepositEventRow>(
      `${depositEventSelectSql}
       where tx_hash = $1 and log_index = $2
       limit 1`,
      [input.txHash, input.logIndex],
    );

    const row = result.rows[0];
    return row ? mapDepositEvent(row) : null;
  }

  async saveDepositEvent(event: WalletDepositEvent) {
    const result = await this.db.query<DepositEventRow>(
      `insert into wallet_deposit_events (
         id, tx_hash, log_index, wallet_id, user_id, amount, asset, network, confirmations,
         status, provider, recipient_address, raw_payload, event_fingerprint, rejection_reason,
         credited_ledger_entry_id, created_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18)
       on conflict (tx_hash, log_index) do update set
         tx_hash = wallet_deposit_events.tx_hash
       returning
         id, tx_hash, log_index, wallet_id, user_id, amount, asset, network, confirmations,
         status, provider, recipient_address, raw_payload, event_fingerprint, rejection_reason,
         credited_ledger_entry_id, created_at, updated_at`,
      [
        event.id,
        event.txHash,
        event.logIndex,
        event.walletId,
        event.userId,
        event.amount,
        event.asset,
        event.network,
        event.confirmations,
        event.status,
        event.provider,
        event.recipientAddress,
        JSON.stringify(event.rawPayload),
        event.eventFingerprint,
        event.rejectionReason,
        event.creditedLedgerEntryId,
        event.createdAt,
        event.updatedAt,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Deposit event insert returned no row.");
    }

    return mapDepositEvent(row);
  }

  async updateDepositEvent(input: {
    id: string;
    status: DepositEventStatus;
    confirmations?: number;
    rejectionReason?: string | null;
    creditedLedgerEntryId?: string | null;
  }) {
    const result = await this.db.query<DepositEventRow>(
      `update wallet_deposit_events
       set
         status = $2,
         confirmations = coalesce($3, confirmations),
         rejection_reason = case when $4::text is null then rejection_reason else $4 end,
         credited_ledger_entry_id = coalesce($5, credited_ledger_entry_id),
         updated_at = now()
       where id = $1
       returning
         id, tx_hash, log_index, wallet_id, user_id, amount, asset, network, confirmations,
         status, provider, recipient_address, raw_payload, event_fingerprint, rejection_reason,
         credited_ledger_entry_id, created_at, updated_at`,
      [
        input.id,
        input.status,
        input.confirmations ?? null,
        input.rejectionReason ?? null,
        input.creditedLedgerEntryId ?? null,
      ],
    );

    const row = result.rows[0];
    return row ? mapDepositEvent(row) : null;
  }

  async listDepositEvents(userId: string) {
    const result = await this.db.query<DepositEventRow>(
      `${depositEventSelectSql}
       where user_id = $1
       order by created_at desc`,
      [userId],
    );

    return result.rows.map(mapDepositEvent);
  }

  async findWithdrawalByIdempotencyKey(userId: string, idempotencyKey: string) {
    const result = await this.db.query<WithdrawalRequestRow>(
      `${withdrawalSelectSql}
       where user_id = $1 and idempotency_key = $2
       limit 1`,
      [userId, idempotencyKey],
    );

    const row = result.rows[0];
    return row ? mapWithdrawalRequest(row) : null;
  }

  async saveWithdrawalRequest(request: WithdrawalRequest) {
    try {
      const result = await this.db.query<WithdrawalRequestRow>(
        `insert into wallet_withdrawal_requests (
           id, user_id, asset, network, destination_address, amount, status,
           provider, idempotency_key, real_transfer_blocked, block_reason,
           request_fingerprint, created_at, updated_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12, $13)
         returning
           id, user_id, asset, network, destination_address, amount, status, idempotency_key,
           provider, real_transfer_blocked, block_reason, request_fingerprint, created_at, updated_at`,
        [
          request.id,
          request.userId,
          request.asset,
          request.network,
          request.destinationAddress,
          request.amount,
          request.status,
          request.provider,
          request.idempotencyKey,
          request.blockReason,
          request.requestFingerprint,
          request.createdAt,
          request.updatedAt,
        ],
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error("Withdrawal request insert returned no row.");
      }

      return mapWithdrawalRequest(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findWithdrawalByIdempotencyKey(
          request.userId,
          request.idempotencyKey,
        );
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async listWithdrawalRequests(userId: string) {
    const result = await this.db.query<WithdrawalRequestRow>(
      `${withdrawalSelectSql}
       where user_id = $1
       order by created_at desc`,
      [userId],
    );

    return result.rows.map(mapWithdrawalRequest);
  }

  async listAllWithdrawalRequests(limit = 100) {
    const result = await this.db.query<WithdrawalRequestRow>(
      `${withdrawalSelectSql}
       order by created_at desc
       limit $1`,
      [limit],
    );

    return result.rows.map(mapWithdrawalRequest);
  }

  async findWithdrawalRequestById(id: string) {
    const result = await this.db.query<WithdrawalRequestRow>(
      `${withdrawalSelectSql}
       where id = $1
       limit 1`,
      [id],
    );

    const row = result.rows[0];
    return row ? mapWithdrawalRequest(row) : null;
  }

  async updateWithdrawalRequestStatus(input: {
    id: string;
    status: Extract<WithdrawalRequestStatus, "rejected" | "approved_for_review">;
  }) {
    const result = await this.db.query<WithdrawalRequestRow>(
      `update wallet_withdrawal_requests
       set
         status = $2,
         real_transfer_blocked = true,
         block_reason = 'TRANSFERS_UNAVAILABLE',
         updated_at = now()
       where id = $1
       returning
         id, user_id, asset, network, destination_address, amount, status, idempotency_key,
         provider, real_transfer_blocked, block_reason, request_fingerprint, created_at, updated_at`,
      [input.id, input.status],
    );

    const row = result.rows[0];
    return row ? mapWithdrawalRequest(row) : null;
  }

  async findProviderEventByEventId(eventId: string) {
    const result = await this.db.query<ProviderEventRow>(
      `select id, event_id, provider, event_type, payload, received_at
       from wallet_provider_events
       where event_id = $1
       limit 1`,
      [eventId],
    );

    const row = result.rows[0];
    return row ? mapProviderEvent(row) : null;
  }

  async saveProviderEvent(event: WalletProviderEvent) {
    const result = await this.db.query<ProviderEventRow>(
      `insert into wallet_provider_events (
         id, event_id, provider, event_type, payload, received_at, created_at, updated_at
       )
       values ($1, $2, $3, $4, $5::jsonb, $6, $6, $6)
       on conflict (event_id) do update set
         event_id = wallet_provider_events.event_id
       returning id, event_id, provider, event_type, payload, received_at`,
      [
        event.id,
        event.eventId,
        event.provider,
        event.eventType,
        JSON.stringify(event.payload),
        event.receivedAt,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Provider event insert returned no row.");
    }

    return mapProviderEvent(row);
  }
}

export class WalletProviderAdapter implements WalletProvider, WalletDepositProvider {
  readonly providerName = WALLET_PROVIDER;

  async createDepositAddress(userId: string) {
    return {
      asset: WALLET_ASSET,
      network: WALLET_NETWORK,
      address: buildLocalTronAddress(userId),
      provider: WALLET_PROVIDER,
    };
  }

  validateAddress(address: string) {
    return validateTronAddressShape(address);
  }

  async buildWithdrawalRequest() {
    return {
      provider: WALLET_PROVIDER,
      providerStatus: "not_submitted" as const,
      realTransferEnabled: false as const,
    };
  }

  async getNetworkStatus() {
    return {
      provider: WALLET_PROVIDER,
      network: WALLET_NETWORK,
      status: "available" as const,
      realTransfersEnabled: false as const,
    };
  }

  parseDepositWebhook(body: unknown) {
    return parseDepositWebhookPayload(body, this.providerName);
  }
}

export class ReadOnlyTronDepositProvider implements WalletDepositProvider {
  readonly providerName = READ_ONLY_TRON_DEPOSIT_PROVIDER;

  parseDepositWebhook(body: unknown) {
    return parseDepositWebhookPayload(body, this.providerName);
  }
}

export function buildWalletService({
  repository,
  provider,
  depositProvider,
  ledger,
  depositMinConfirmations = 20,
  now = () => new Date(),
  getComplianceEligibility,
}: {
  repository: WalletRepository;
  provider: WalletProvider;
  depositProvider?: WalletDepositProvider;
  ledger?: LedgerService;
  depositMinConfirmations?: number;
  now?: () => Date;
  getComplianceEligibility?: (userId: string) => Promise<{
    canUseRealMoney: boolean;
    reasons?: string[];
    profile?: {
      kycStatus?: string;
      amlStatus?: string;
      riskLevel?: string;
    };
  }>;
}) {
  const activeDepositProvider = depositProvider ?? (provider as unknown as WalletDepositProvider);

  async function getOrCreateWallet(userId: string) {
    const existing = await repository.findWallet({
      userId,
      asset: WALLET_ASSET,
      network: WALLET_NETWORK,
      provider: WALLET_PROVIDER,
    });

    if (existing) {
      return {
        wallet: existing,
        created: false,
        providerStatus: await provider.getNetworkStatus(),
        ...coreFields(),
      };
    }

    const address = await provider.createDepositAddress(userId);
    const timestamp = now().toISOString();
    const wallet = await repository.saveWallet({
      id: randomUUID(),
      userId,
      asset: address.asset,
      network: address.network,
      address: address.address,
      status: "active",
      provider: address.provider,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      wallet,
      created: true,
      providerStatus: await provider.getNetworkStatus(),
      ...coreFields(),
    };
  }

  async function createDepositIntent(input: { userId: string; body: unknown }) {
    const body = validateDepositIntentBody(input.body);
    const walletResult = await getOrCreateWallet(input.userId);
    const { wallet } = walletResult;
    const timestamp = now();
    const expiresAt = new Date(timestamp.getTime() + 1000 * 60 * 30).toISOString();
    const intent = await repository.saveDepositIntent({
      id: randomUUID(),
      userId: input.userId,
      walletId: wallet.id,
      asset: WALLET_ASSET,
      network: WALLET_NETWORK,
      address: wallet.address,
      expectedAmount: body.expectedAmount,
      status: "waiting",
      memo: body.memo,
      reference: body.reference,
      expiresAt,
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    });

    return {
      depositIntent: intent,
      wallet,
      walletCreated: walletResult.created,
      ...coreFields(),
    };
  }

  async function createWithdrawalRequest(input: { userId: string; body: unknown }) {
    const body = validateWithdrawalBody(input.body);
    const requestFingerprint = buildWithdrawalRequestFingerprint(body);
    const previous = await repository.findWithdrawalByIdempotencyKey(
      input.userId,
      body.idempotencyKey,
    );

    if (previous) {
      if (previous.requestFingerprint !== requestFingerprint) {
        throw new WalletError(
          "IDEMPOTENCY_KEY_REUSE_MISMATCH",
          "Idempotency-Key was already used for a different withdrawal request.",
          409,
        );
      }

      return {
        withdrawalRequest: toPublicWithdrawalRequest(previous),
        idempotent: true,
        compliance: {
          canUseRealMoney: false,
          realTransferBlocked: true,
          reason: "TRANSFERS_UNAVAILABLE" as const,
        },
        ...coreFields(),
      };
    }

    const eligibility = getComplianceEligibility
      ? await getComplianceEligibility(input.userId)
      : { canUseRealMoney: false };
    await provider.buildWithdrawalRequest({
      userId: input.userId,
      destinationAddress: body.destinationAddress,
      amount: body.amount,
      idempotencyKey: body.idempotencyKey,
    });
    const timestamp = now().toISOString();
    const withdrawalRequestId = randomUUID();
    const request = await repository.saveWithdrawalRequest({
      id: withdrawalRequestId,
      userId: input.userId,
      asset: WALLET_ASSET,
      network: WALLET_NETWORK,
      destinationAddress: body.destinationAddress,
      amount: body.amount,
      status: "pending_review",
      idempotencyKey: body.idempotencyKey,
      provider: WALLET_PROVIDER,
      realTransferBlocked: true,
      blockReason: "TRANSFERS_UNAVAILABLE",
      requestFingerprint,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    if (request.id !== withdrawalRequestId) {
      if (request.requestFingerprint !== requestFingerprint) {
        throw new WalletError(
          "IDEMPOTENCY_KEY_REUSE_MISMATCH",
          "Idempotency-Key was already used for a different withdrawal request.",
          409,
        );
      }

      return {
        withdrawalRequest: toPublicWithdrawalRequest(request),
        idempotent: true,
        compliance: {
          canUseRealMoney: false,
          realTransferBlocked: true,
          reason: "TRANSFERS_UNAVAILABLE" as const,
        },
        ...coreFields(),
      };
    }

    return {
      withdrawalRequest: toPublicWithdrawalRequest(request),
      idempotent: false,
      compliance: {
        canUseRealMoney: eligibility.canUseRealMoney,
        realTransferBlocked: true,
        reason: "TRANSFERS_UNAVAILABLE" as const,
      },
      ...coreFields(),
    };
  }

  async function listWithdrawalRequests(userId: string) {
    return {
      withdrawalRequests: (await repository.listWithdrawalRequests(userId)).map(
        toPublicWithdrawalRequest,
      ),
      ...coreFields(),
    };
  }

  async function listDeposits(userId: string) {
    return {
      depositIntents: await repository.listDepositIntents(userId),
      depositEvents: (await repository.listDepositEvents(userId)).map(toPublicDepositEvent),
      ...coreFields(),
    };
  }

  async function receiveDepositWebhook(body: unknown) {
    const parsed = activeDepositProvider.parseDepositWebhook(body);
    const eventFingerprint = buildDepositEventFingerprint(parsed);
    const existing = await repository.findDepositEventByTransaction(parsed);
    const wallet = validateTronAddressShape(parsed.recipientAddress)
      ? await repository.findWalletByAddress(parsed.recipientAddress)
      : null;
    const rejectionReason = getDepositRejectionReason(parsed, wallet);
    const confirmed = parsed.confirmations >= depositMinConfirmations;
    const timestamp = now().toISOString();
    const initialStatus: DepositEventStatus = rejectionReason
      ? "rejected"
      : confirmed
        ? "confirmed"
        : "detected";

    const newEventId = randomUUID();
    let event =
      existing ??
      (await repository.saveDepositEvent({
        id: newEventId,
        txHash: parsed.txHash,
        logIndex: parsed.logIndex,
      walletId: wallet?.id ?? null,
      userId: wallet?.userId ?? null,
      amount: parsed.amount,
      asset: WALLET_ASSET,
      network: WALLET_NETWORK,
      confirmations: Math.max(0, parsed.confirmations),
      status: initialStatus,
      provider: parsed.provider,
      recipientAddress: parsed.recipientAddress || null,
        eventFingerprint,
      rawPayload: parsed.rawPayload,
      rejectionReason,
      creditedLedgerEntryId: null,
      createdAt: timestamp,
        updatedAt: timestamp,
      }));

    const wasExisting = existing !== null || event.id !== newEventId;
    let transitionedToConfirmed = false;

    if (wasExisting && !isDepositEventFingerprintMatch(event, eventFingerprint)) {
      const updated = await repository.updateDepositEvent({
        id: event.id,
        status: "manual_review",
        confirmations: Math.max(event.confirmations, parsed.confirmations),
        rejectionReason: "IDEMPOTENCY_PAYLOAD_MISMATCH",
      });
      if (updated) {
        event = updated;
      }

      return {
        depositEvent: toPublicDepositEvent(event),
        idempotent: true,
        conflict: true,
        ledgerCredit: null,
        creditBlockedReason: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        auditEvents: ["wallet.deposit_rejected" as const],
        ...coreFields(),
      };
    }

    if (
      existing &&
      existing.status === "detected" &&
      !rejectionReason &&
      confirmed &&
      parsed.confirmations > existing.confirmations
    ) {
      const updated = await repository.updateDepositEvent({
        id: existing.id,
        status: "confirmed",
        confirmations: parsed.confirmations,
      });
      if (updated) {
        event = updated;
        transitionedToConfirmed = true;
      }
    }

    const auditEvents: WalletDepositAuditEvent[] = [];

    if (!wasExisting) {
      auditEvents.push(
        event.status === "rejected" ? "wallet.deposit_rejected" : "wallet.deposit_detected",
      );
    }

    if ((!wasExisting && event.status === "confirmed") || transitionedToConfirmed) {
      auditEvents.push("wallet.deposit_confirmed");
    }

    let ledgerResult:
      | Awaited<ReturnType<LedgerService["createEntry"]>>
      | null = null;
    let creditBlockedReason: string | null = null;

    if (event.status === "confirmed") {
      if (!ledger) {
        throw new WalletError(
          "DEPOSIT_LEDGER_UNAVAILABLE",
          "Deposit crediting requires the ledger service.",
          500,
        );
      }

      if (!event.userId || !event.walletId) {
        creditBlockedReason = "WALLET_NOT_FOUND";
      } else {
        const eligibility = getComplianceEligibility
          ? await getComplianceEligibility(event.userId)
          : { canUseRealMoney: false };
        if (isComplianceBlocked(eligibility)) {
          creditBlockedReason = "COMPLIANCE_BLOCKED";
        } else {
          ledgerResult = await ledger.createEntry({
            userId: event.userId,
            walletId: event.walletId,
            asset: WALLET_ASSET,
            entryType: "credit",
            amount: event.amount,
            reason: "wallet_deposit_confirmed",
            referenceType: "wallet_deposit_event",
            referenceId: event.id,
            idempotencyKey: buildDepositLedgerIdempotencyKey(event),
            metadata: {
              txHash: event.txHash,
              logIndex: event.logIndex,
              confirmations: event.confirmations,
              provider: event.provider,
              network: event.network,
              asset: event.asset,
            },
          });
          const updated = await repository.updateDepositEvent({
            id: event.id,
            status: "credited",
            creditedLedgerEntryId: ledgerResult.entry.id,
          });
          if (updated) {
            event = updated;
          }
          if (!ledgerResult.idempotent) {
            auditEvents.push("wallet.deposit_credited");
          }
        }
      }
    }

    return {
      depositEvent: toPublicDepositEvent(event),
      idempotent: wasExisting || Boolean(existing),
      conflict: false,
      ledgerCredit: ledgerResult
        ? {
            idempotent: ledgerResult.idempotent,
            entryId: ledgerResult.entry.id,
            balance: ledgerResult.balance,
          }
        : null,
      creditBlockedReason,
      auditEvents,
      ...coreFields(),
    };
  }

  async function receiveLocalWebhook(body: unknown) {
    return receiveDepositWebhook(body);
  }

  return {
    repository,
    provider,
    getOrCreateWallet,
    createDepositIntent,
    createWithdrawalRequest,
    listDeposits,
    listWithdrawalRequests,
    receiveDepositWebhook,
    receiveLocalWebhook,
  };
}

export type WalletService = ReturnType<typeof buildWalletService>;

export function coreFields() {
  return {
    mode: WALLET_REVIEW_MODE,
    warning: WALLET_REVIEW_WARNING,
  };
}

export function validateTronAddressShape(address: string) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address.trim());
}

function validateDepositIntentBody(value: unknown) {
  if (!isRecord(value)) {
    throw new WalletError("INVALID_WALLET_REQUEST", "Deposit intent request must be an object.");
  }

  assertAllowedKeys(value, ["expectedAmount", "memo", "reference"]);

  return {
    expectedAmount: validateAmount(value.expectedAmount),
    memo: validateOptionalText(value.memo),
    reference: validateOptionalText(value.reference),
  };
}

function validateWithdrawalBody(value: unknown) {
  if (!isRecord(value)) {
    throw new WalletError("INVALID_WALLET_REQUEST", "Withdrawal request must be an object.");
  }

  if ("status" in value) {
    throw new WalletError(
      "INVALID_WITHDRAWAL_STATUS",
      "Withdrawal status is backend/admin-owned and cannot be set by this API.",
    );
  }

  assertAllowedKeys(value, [
    "asset",
    "network",
    "destinationAddress",
    "amount",
    "idempotencyKey",
    "manualReview",
    "mode",
  ]);
  validateAsset(value.asset);
  validateNetwork(value.network);

  if (value.manualReview !== true && value.mode !== WALLET_REVIEW_MODE) {
    throw new WalletError(
      "REVIEW_MODE_REQUIRED",
      "Manual review is required before withdrawal requests can be submitted.",
    );
  }

  if (typeof value.destinationAddress !== "string" || !validateTronAddressShape(value.destinationAddress)) {
    throw new WalletError(
      "INVALID_TRON_ADDRESS",
      "destinationAddress must look like a TRON address.",
    );
  }

  const idempotencyKey = validateIdempotencyKey(value.idempotencyKey);

  return {
    asset: WALLET_ASSET,
    network: WALLET_NETWORK,
    destinationAddress: value.destinationAddress.trim(),
    amount: validateAmount(value.amount),
    idempotencyKey,
  };
}

type WalletDepositAuditEvent =
  | "wallet.deposit_detected"
  | "wallet.deposit_confirmed"
  | "wallet.deposit_credited"
  | "wallet.deposit_rejected";

function parseDepositWebhookPayload(value: unknown, fallbackProvider: string): ParsedDepositWebhook {
  if (!isRecord(value)) {
    throw new WalletError("INVALID_WEBHOOK_EVENT", "Deposit webhook payload must be an object.");
  }

  const payload = isRecord(value.payload) ? value.payload : {};
  const txHash = getWebhookText(value.txHash, payload.txHash, value.transactionHash)
    .trim()
    .toLowerCase();
  const explicitLogIndex = getWebhookText(value.logIndex, payload.logIndex).trim();
  const providerEventId = getWebhookText(
    value.providerEventId,
    payload.providerEventId,
    value.eventId,
    payload.eventId,
  ).trim();
  const logIndex = explicitLogIndex || (providerEventId ? `event:${providerEventId}` : "");
  const recipientAddress = getWebhookText(
    value.recipientAddress,
    payload.recipientAddress,
    value.toAddress,
    payload.toAddress,
    value.walletAddress,
    payload.walletAddress,
    value.address,
    payload.address,
  ).trim();

  if (!txHash) {
    throw new WalletError("INVALID_WEBHOOK_EVENT", "txHash is required.");
  }

  if (!logIndex) {
    throw new WalletError(
      "INVALID_WEBHOOK_EVENT",
      "Explicit logIndex or unique provider eventId is required.",
    );
  }

  const provider = getWebhookText(value.provider, payload.provider, fallbackProvider).trim();
  const amount = getWebhookNumber(value.amount, payload.amount);
  const confirmations = Math.max(
    0,
    Math.trunc(getWebhookNumber(value.confirmations, payload.confirmations) || 0),
  );
  const providerStatus = getWebhookText(value.status, payload.status).trim().toLowerCase();

  return {
    txHash,
    logIndex,
    recipientAddress,
    amount,
    asset: getWebhookText(value.asset, payload.asset, WALLET_ASSET).trim().toUpperCase(),
    network: getWebhookText(value.network, payload.network, WALLET_NETWORK).trim().toUpperCase(),
    confirmations: providerStatus === "confirmed" && confirmations === 0 ? 1 : confirmations,
    provider: provider || fallbackProvider,
    rawPayload: value,
  };
}

function getDepositRejectionReason(
  parsed: ParsedDepositWebhook,
  wallet: Wallet | null,
): string | null {
  if (parsed.asset !== WALLET_ASSET) {
    return "UNSUPPORTED_ASSET";
  }

  if (parsed.network !== WALLET_NETWORK) {
    return "UNSUPPORTED_NETWORK";
  }

  if (!Number.isFinite(parsed.amount) || parsed.amount <= 0) {
    return "INVALID_AMOUNT";
  }

  if (!validateTronAddressShape(parsed.recipientAddress)) {
    return "INVALID_RECIPIENT_ADDRESS";
  }

  if (!wallet) {
    return "WALLET_NOT_FOUND";
  }

  if (wallet.status !== "active") {
    return "WALLET_NOT_ACTIVE";
  }

  return null;
}

function isComplianceBlocked(eligibility: {
  reasons?: string[];
  profile?: {
    kycStatus?: string;
    amlStatus?: string;
    riskLevel?: string;
  };
}) {
  const reasons = new Set(eligibility.reasons ?? []);
  return (
    reasons.has("BLOCKED_COUNTRY") ||
    reasons.has("AGE_UNDER_18") ||
    reasons.has("COMPLIANCE_RISK_BLOCKED") ||
    eligibility.profile?.riskLevel === "blocked" ||
    eligibility.profile?.amlStatus === "blocked" ||
    eligibility.profile?.kycStatus === "rejected"
  );
}

function buildDepositLedgerIdempotencyKey(event: WalletDepositEvent) {
  return `deposit:${event.txHash}:${event.logIndex}`;
}

function buildDepositEventFingerprint(input: ParsedDepositWebhook) {
  return buildDepositEventFingerprintFromParts({
    txHash: input.txHash,
    logIndex: input.logIndex,
    recipientAddress: input.recipientAddress,
    amount: input.amount,
    asset: input.asset,
    network: input.network,
    provider: input.provider,
    rawPayload: input.rawPayload,
  });
}

function buildDepositEventFingerprintFromParts(input: {
  txHash: string;
  logIndex: string;
  recipientAddress: string;
  amount: number;
  asset: string;
  network: string;
  provider: string;
  rawPayload: Record<string, unknown>;
}) {
  return createHash("sha256")
    .update(
      stableStringify({
        txHash: input.txHash,
        logIndex: input.logIndex,
        recipientAddress: input.recipientAddress.trim(),
        amount: input.amount,
        asset: input.asset.trim().toUpperCase(),
        network: input.network.trim().toUpperCase(),
        provider: input.provider.trim(),
        providerPayload: stripDepositProviderVolatileFields(input.rawPayload),
      }),
    )
    .digest("hex");
}

function isDepositEventFingerprintMatch(
  existing: WalletDepositEvent,
  incomingFingerprint: string,
) {
  if (existing.eventFingerprint === incomingFingerprint) {
    return true;
  }

  if (!isLegacyDepositEventFingerprint(existing.eventFingerprint)) {
    return false;
  }

  return (
    buildDepositEventFingerprintFromParts({
      txHash: existing.txHash,
      logIndex: existing.logIndex,
      recipientAddress: existing.recipientAddress ?? "",
      amount: existing.amount,
      asset: existing.asset,
      network: existing.network,
      provider: existing.provider,
      rawPayload: existing.rawPayload,
    }) === incomingFingerprint
  );
}

function isLegacyDepositEventFingerprint(fingerprint: string) {
  return /^[a-f0-9]{32}$/i.test(fingerprint);
}

function toPublicDepositEvent(event: WalletDepositEvent): PublicWalletDepositEvent {
  const { rawPayload: _rawPayload, eventFingerprint: _eventFingerprint, ...publicEvent } = event;
  return publicEvent;
}

function stripDepositProviderVolatileFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDepositProviderVolatileFields);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !DEPOSIT_PROVIDER_VOLATILE_FIELDS.has(key))
        .map(([key, item]) => [key, stripDepositProviderVolatileFields(item)]),
    );
  }

  return value;
}

const DEPOSIT_PROVIDER_VOLATILE_FIELDS = new Set([
  "confirmation",
  "confirmations",
  "confirmed",
  "status",
]);

function getWebhookText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function getWebhookNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function validateAsset(value: unknown) {
  if (value === undefined || value === WALLET_ASSET) {
    return;
  }

  throw new WalletError("UNSUPPORTED_WALLET_ASSET", "Only USDT is supported in wallet core.");
}

function validateNetwork(value: unknown) {
  if (value === undefined || value === WALLET_NETWORK) {
    return;
  }

  throw new WalletError(
    "UNSUPPORTED_WALLET_NETWORK",
    "Only TRON is supported in wallet core.",
  );
}

function validateAmount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new WalletError("INVALID_WALLET_AMOUNT", "Amount must be greater than zero.");
  }

  return value;
}

function validateIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new WalletError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.");
  }

  return value.trim();
}

function buildWithdrawalRequestFingerprint(input: {
  asset: WalletAsset;
  network: WalletNetwork;
  destinationAddress: string;
  amount: number;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        asset: input.asset,
        network: input.network,
        destinationAddress: input.destinationAddress,
        amount: input.amount,
      }),
    )
    .digest("hex");
}

function toPublicWithdrawalRequest(request: WithdrawalRequest): PublicWithdrawalRequest {
  const { requestFingerprint: _requestFingerprint, ...publicRequest } = request;
  return publicRequest;
}

function validateOptionalText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new WalletError("INVALID_WALLET_REQUEST", "Optional text fields must be strings.");
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function assertAllowedKeys(value: Record<string, unknown>, allowedKeys: string[]) {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));

  if (unknownKey) {
    throw new WalletError("INVALID_WALLET_REQUEST", `Unsupported field: ${unknownKey}.`);
  }
}

function buildLocalTronAddress(userId: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digest = createHash("sha256").update(`internal_wallet:${userId}`).digest();
  let suffix = "";

  for (let index = 0; suffix.length < 33; index += 1) {
    suffix += alphabet[digest[index % digest.length] % alphabet.length];
  }

  return `T${suffix}`;
}

function getWalletScope(input: {
  userId: string;
  asset: WalletAsset;
  network: WalletNetwork;
  provider: WalletProviderName;
}) {
  return `${input.userId}:${input.asset}:${input.network}:${input.provider}`;
}

function getUserScopedKey(userId: string, key: string) {
  return `${userId}:${key}`;
}

const withdrawalSelectSql = `select
  id, user_id, asset, network, destination_address, amount, status, idempotency_key,
  provider, real_transfer_blocked, block_reason, request_fingerprint, created_at, updated_at
 from wallet_withdrawal_requests`;

const depositEventSelectSql = `select
  id, tx_hash, log_index, wallet_id, user_id, amount, asset, network, confirmations,
  status, provider, recipient_address, raw_payload, event_fingerprint, rejection_reason,
  credited_ledger_entry_id, created_at, updated_at
 from wallet_deposit_events`;

function mapWallet(row: WalletRow): Wallet {
  return {
    id: row.id,
    userId: row.user_id,
    asset: row.asset,
    network: row.network,
    address: row.address,
    status: row.status,
    provider: row.provider,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapDepositIntent(row: DepositIntentRow): DepositIntent {
  return {
    id: row.id,
    userId: row.user_id,
    walletId: row.wallet_id,
    asset: row.asset,
    network: row.network,
    address: row.address,
    expectedAmount: numberFromDb(row.expected_amount),
    status: row.status,
    memo: row.memo,
    reference: row.reference,
    expiresAt: toIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapDepositEvent(row: DepositEventRow): WalletDepositEvent {
  return {
    id: row.id,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    walletId: row.wallet_id,
    userId: row.user_id,
    amount: numberFromDb(row.amount),
    asset: row.asset,
    network: row.network,
    confirmations: numberFromDb(row.confirmations),
    status: row.status,
    provider: row.provider,
    recipientAddress: row.recipient_address,
    eventFingerprint: row.event_fingerprint,
    rawPayload: row.raw_payload ?? {},
    rejectionReason: row.rejection_reason,
    creditedLedgerEntryId: row.credited_ledger_entry_id,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapWithdrawalRequest(row: WithdrawalRequestRow): WithdrawalRequest {
  return {
    id: row.id,
    userId: row.user_id,
    asset: row.asset,
    network: row.network,
    destinationAddress: row.destination_address,
    amount: numberFromDb(row.amount),
    status: row.status,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    realTransferBlocked: true,
    blockReason: row.block_reason,
    requestFingerprint: row.request_fingerprint,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapProviderEvent(row: ProviderEventRow): WalletProviderEvent {
  return {
    id: row.id,
    eventId: row.event_id,
    provider: row.provider,
    eventType: row.event_type,
    payload: row.payload ?? {},
    receivedAt: toIsoString(row.received_at),
  };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
