import type { Database, Queryable } from "./db.js";
import {
  PostgresCoinLedgerRepository,
  type CoinLedgerEntry,
  type PostCoinEntryInput,
} from "./coins.js";
import {
  PostgresLedgerRepository,
  type CreateLedgerEntryInput,
  type CreateLedgerEntryResult,
  type LedgerRuntimePolicy,
} from "./ledger.js";
import type { AuditEvent } from "./audit.js";
import {
  multiplyDivide,
  parseDecimalToAtomic,
  parseStoredDecimalToAtomic,
} from "./money.js";
import { toIsoString } from "./utils.js";

export type WalletRecord = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON" | null;
  balance: string;
  initialBalance: string;
  createdAt: string;
  updatedAt: string;
};

export type PositionRecord = {
  id: string;
  userId: string;
  marketId: string;
  marketTitle: string;
  side: "yes" | "no";
  shares: string;
  totalCost: string;
  averagePrice: string | null;
  lastPrice: string | null;
  totalCostCoinMicros?: string;
  averagePriceNanos?: string | null;
  lastPriceNanos?: string | null;
  openedAt: string;
  updatedAt: string;
};

export type TradeRecord = {
  id: string;
  userId: string;
  walletId: string | null;
  marketId: string;
  side: "yes" | "no";
  tradeType: "buy" | "sell";
  amount: string;
  price: string;
  shares: string;
  status: "local" | "pending" | "filled" | "rejected" | "cancelled";
  idempotencyKey: string | null;
  metadata?: Record<string, unknown>;
  executionOrderId?: string | null;
  amountCoinMicros?: string;
  feeCoinMicros?: string;
  realizedPnlCoinMicros?: string | null;
  priceNanos?: string;
  createdAt: string;
};

export type PositionWriteRecord = PositionRecord;
export type TradeWriteRecord = TradeRecord;
export type PositionDeleteRecord = {
  userId: string;
  marketId: string;
  side: "yes" | "no";
};
export type TradeCommitInput = {
  ledgerEntry: CreateLedgerEntryInput;
  trade: TradeWriteRecord;
  positions: PositionWriteRecord[];
  deletePositions: PositionDeleteRecord[];
  auditEvent?: AuditEvent | null;
};
export type TradeCommitResult = {
  ledger: CreateLedgerEntryResult;
  audit?: {
    committed: boolean;
  };
};

export type CoinTradeOrderStatus =
  | "reserved"
  | "execution_pending"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "failed"
  | "manual_review";

export type CoinTradeOrderRecord = {
  id: string;
  userId: string;
  marketId: string;
  marketTitle: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  clobTokenId: string | null;
  status: CoinTradeOrderStatus;
  requestedCoinMicros: string;
  requestedShares: string | null;
  quotePriceNanos: string;
  reservedCoinMicros: string;
  filledCoinMicros: string;
  feeCoinMicros: string;
  releasedCoinMicros: string;
  executedShares: string | null;
  executedPriceNanos: string | null;
  provider: string | null;
  providerOrderId: string | null;
  providerTradeId: string | null;
  reserveLedgerEntryId: string | null;
  debitLedgerEntryId: string | null;
  feeLedgerEntryId: string | null;
  releaseLedgerEntryId: string | null;
  creditLedgerEntryId: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  lastError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ReserveCoinTradeOrderInput = {
  order: CoinTradeOrderRecord;
  reserveEntry?: PostCoinEntryInput | null;
  outboxPayload: Record<string, unknown>;
};

export type ReserveCoinTradeOrderResult = {
  order: CoinTradeOrderRecord;
  reserveEntry: CoinLedgerEntry | null;
  idempotent: boolean;
};

export type FinalizeCoinTradeOrderInput = {
  orderId: string;
  expectedUserId: string;
  expectedIdempotencyKey: string;
  terminalStatus: "filled" | "partially_filled";
  filledCoinMicros: bigint;
  feeCoinMicros: bigint;
  releasedCoinMicros: bigint;
  executedShares: string;
  executedPriceNanos: bigint;
  provider: string;
  providerOrderId: string;
  providerTradeId?: string | null;
  tradeDebitEntry?: PostCoinEntryInput | null;
  feeDebitEntry?: PostCoinEntryInput | null;
  tradeCreditEntry?: PostCoinEntryInput | null;
  releaseEntry?: PostCoinEntryInput | null;
  trade: TradeWriteRecord;
  positions: PositionWriteRecord[];
  deletePositions: PositionDeleteRecord[];
  auditEvent?: AuditEvent | null;
  outboxPayload: Record<string, unknown>;
};

export type FinalizeCoinTradeOrderResult = {
  order: CoinTradeOrderRecord;
  trade: TradeRecord;
  coinEntries: {
    debit: CoinLedgerEntry | null;
    fee: CoinLedgerEntry | null;
    release: CoinLedgerEntry | null;
    credit: CoinLedgerEntry | null;
  };
  idempotent: boolean;
};

export type CancelCoinTradeOrderInput = {
  orderId: string;
  expectedUserId: string;
  expectedIdempotencyKey: string;
  status: "cancelled" | "failed" | "manual_review";
  error: string | null;
  releaseEntry?: PostCoinEntryInput | null;
  auditEvent?: AuditEvent | null;
  outboxPayload: Record<string, unknown>;
};

export type CancelCoinTradeOrderResult = {
  order: CoinTradeOrderRecord;
  releaseEntry: CoinLedgerEntry | null;
  idempotent: boolean;
};
export type PortfolioResetLedgerAdjustment = {
  asset?: "USDT";
  walletId?: string | null;
  targetAvailableBalance: number;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};
export type PortfolioResetCommitInput = {
  userId: string;
  ledgerAdjustment?: PortfolioResetLedgerAdjustment | null;
};
export type PortfolioResetCommitResult = {
  ledger: CreateLedgerEntryResult | null;
};

export class PortfolioRepositoryError extends Error {
  constructor(
    public readonly code:
      | "TRADE_ATOMIC_COMMIT_REQUIRED"
      | "POSITION_ATOMIC_COMMIT_REQUIRED"
      | "PORTFOLIO_RESET_ATOMIC_COMMIT_REQUIRED"
      | "TRADING_ORDER_STATE_CONFLICT",
    message: string,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = "PortfolioRepositoryError";
  }
}

export type PortfolioRepository = {
  getWalletsByUserId(userId: string): Promise<WalletRecord[]>;
  getPositionsByUserId(userId: string): Promise<PositionRecord[]>;
  listPositionsByMarketId(marketId: string): Promise<PositionRecord[]>;
  getTradesByUserId(userId: string, limit?: number): Promise<TradeRecord[]>;
  listAdminSeedTrades(input?: { batchId?: string; limit?: number }): Promise<TradeRecord[]>;
  findTradeByIdempotencyKey(userId: string, idempotencyKey: string): Promise<TradeRecord | null>;
  findCoinTradeOrderByIdempotencyKey?(
    userId: string,
    idempotencyKey: string,
  ): Promise<CoinTradeOrderRecord | null>;
  upsertPosition(position: PositionWriteRecord): Promise<void>;
  deletePosition(userId: string, marketId: string, side: "yes" | "no"): Promise<void>;
  clearMarketPositions(marketId: string): Promise<void>;
  createTrade(trade: TradeWriteRecord): Promise<void>;
  commitTrade?(input: TradeCommitInput): Promise<TradeCommitResult>;
  reserveCoinTradeOrder?(
    input: ReserveCoinTradeOrderInput,
  ): Promise<ReserveCoinTradeOrderResult>;
  finalizeCoinTradeOrder?(
    input: FinalizeCoinTradeOrderInput,
  ): Promise<FinalizeCoinTradeOrderResult>;
  cancelCoinTradeOrder?(
    input: CancelCoinTradeOrderInput,
  ): Promise<CancelCoinTradeOrderResult>;
  commitPortfolioReset?(input: PortfolioResetCommitInput): Promise<PortfolioResetCommitResult>;
  clearUserPortfolio(userId: string): Promise<void>;
};

export class MemoryPortfolioRepository implements PortfolioRepository {
  private readonly positions = new Map<string, PositionRecord>();
  private readonly trades: TradeRecord[] = [];

  async getWalletsByUserId() {
    return [];
  }

  async getPositionsByUserId(userId: string) {
    return [...this.positions.values()]
      .filter((position) => position.userId === userId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async listPositionsByMarketId(marketId: string) {
    return [...this.positions.values()]
      .filter((position) => position.marketId === marketId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async getTradesByUserId(userId: string, limit = 100) {
    return this.trades.filter((trade) => trade.userId === userId).slice(0, limit);
  }

  async listAdminSeedTrades(input: { batchId?: string; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(input.limit ?? 5000, 50_000));
    return this.trades
      .filter((trade) => trade.status === "filled")
      .filter((trade) => trade.metadata?.source === "admin_seed")
      .filter((trade) => (input.batchId ? trade.metadata?.batchId === input.batchId : true))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .slice(0, limit);
  }

  async findTradeByIdempotencyKey(userId: string, idempotencyKey: string) {
    return (
      this.trades.find(
        (trade) => trade.userId === userId && trade.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async upsertPosition(position: PositionWriteRecord) {
    this.positions.set(position.id, position);
  }

  async deletePosition(userId: string, marketId: string, side: "yes" | "no") {
    for (const [id, position] of this.positions.entries()) {
      if (position.userId === userId && position.marketId === marketId && position.side === side) {
        this.positions.delete(id);
      }
    }
  }

  async clearMarketPositions(marketId: string) {
    for (const [id, position] of this.positions.entries()) {
      if (position.marketId === marketId) {
        this.positions.delete(id);
      }
    }
  }

  async createTrade(trade: TradeWriteRecord) {
    this.trades.unshift(trade);
  }

  async clearUserPortfolio(userId: string) {
    for (const [id, position] of this.positions.entries()) {
      if (position.userId === userId) {
        this.positions.delete(id);
      }
    }

    for (let index = this.trades.length - 1; index >= 0; index -= 1) {
      if (this.trades[index]?.userId === userId) {
        this.trades.splice(index, 1);
      }
    }
  }
}

type WalletRow = {
  id: string;
  user_id: string;
  asset: "USDT";
  network: "TRON" | null;
  balance: string | number;
  initial_balance: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type PositionRow = {
  id: string;
  user_id: string;
  market_external_id: string;
  market_title: string;
  side: "yes" | "no";
  shares: string | number;
  total_cost: string | number;
  average_price: string | number | null;
  last_price: string | number | null;
  total_cost_coin_micros?: string | number | null;
  average_price_nanos?: string | number | null;
  last_price_nanos?: string | number | null;
  opened_at: Date | string;
  updated_at: Date | string;
};

type TradeRow = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  market_external_id: string;
  side: "yes" | "no";
  trade_type: "buy" | "sell";
  amount: string | number;
  price: string | number;
  shares: string | number;
  status: "local" | "pending" | "filled" | "rejected" | "cancelled";
  idempotency_key: string | null;
  metadata: Record<string, unknown> | null;
  execution_order_id?: string | null;
  amount_coin_micros?: string | number | null;
  fee_coin_micros?: string | number | null;
  realized_pnl_coin_micros?: string | number | null;
  price_nanos?: string | number | null;
  created_at: Date | string;
};

type CoinTradeOrderRow = {
  id: string;
  user_id: string;
  market_external_id: string;
  market_title: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  clob_token_id: string | null;
  status: CoinTradeOrderStatus;
  requested_coin_micros: string | number;
  requested_shares: string | number | null;
  quote_price_nanos: string | number;
  reserved_coin_micros: string | number;
  filled_coin_micros: string | number;
  fee_coin_micros: string | number;
  released_coin_micros: string | number;
  executed_shares: string | number | null;
  executed_price_nanos: string | number | null;
  provider: string | null;
  provider_order_id: string | null;
  provider_trade_id: string | null;
  reserve_ledger_entry_id: string | null;
  debit_ledger_entry_id: string | null;
  fee_ledger_entry_id: string | null;
  release_ledger_entry_id: string | null;
  credit_ledger_entry_id: string | null;
  idempotency_key: string;
  request_fingerprint: string;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export class PostgresPortfolioRepository implements PortfolioRepository {
  constructor(
    private readonly db: Queryable | Database,
    private readonly ledgerRuntimePolicy?: LedgerRuntimePolicy,
  ) {}

  async getWalletsByUserId(userId: string) {
    const result = await this.db.query<WalletRow>(
      `select id, user_id, asset, network, balance, initial_balance, created_at, updated_at
       from wallets
       where user_id = $1
       order by created_at asc`,
      [userId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      asset: row.asset,
      network: row.network,
      balance: String(row.balance),
      initialBalance: String(row.initial_balance),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    }));
  }

  async getPositionsByUserId(userId: string) {
    const result = await this.db.query<PositionRow>(
      `select
         id, user_id, market_external_id, market_title, side, shares, total_cost,
         average_price, last_price, total_cost_coin_micros, average_price_nanos,
         last_price_nanos, opened_at, updated_at
       from positions
       where user_id = $1
       order by updated_at desc`,
      [userId],
    );

    return result.rows.map(mapPositionRow);
  }

  async listPositionsByMarketId(marketId: string) {
    const result = await this.db.query<PositionRow>(
      `select
         id, user_id, market_external_id, market_title, side, shares, total_cost,
         average_price, last_price, total_cost_coin_micros, average_price_nanos,
         last_price_nanos, opened_at, updated_at
       from positions
       where market_external_id = $1
       order by updated_at desc`,
      [marketId],
    );

    return result.rows.map(mapPositionRow);
  }

  async getTradesByUserId(userId: string, limit = 100) {
    const result = await this.db.query<TradeRow>(
      `select
         id, user_id, wallet_id, market_external_id, side, trade_type, amount, price, shares,
         status, idempotency_key, metadata, execution_order_id, amount_coin_micros,
         fee_coin_micros, realized_pnl_coin_micros, price_nanos, created_at
       from trades
       where user_id = $1
       order by created_at desc
       limit $2`,
      [userId, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      walletId: row.wallet_id,
      marketId: row.market_external_id,
      side: row.side,
      tradeType: row.trade_type,
      amount: String(row.amount),
      price: String(row.price),
      shares: String(row.shares),
      status: row.status,
      idempotencyKey: row.idempotency_key,
      metadata: row.metadata ?? {},
      executionOrderId: row.execution_order_id ?? null,
      amountCoinMicros: String(row.amount_coin_micros ?? 0),
      feeCoinMicros: String(row.fee_coin_micros ?? 0),
      realizedPnlCoinMicros:
        row.realized_pnl_coin_micros === null || row.realized_pnl_coin_micros === undefined
          ? null
          : String(row.realized_pnl_coin_micros),
      priceNanos: String(row.price_nanos ?? 0),
      createdAt: toIsoString(row.created_at),
    }));
  }

  async listAdminSeedTrades(input: { batchId?: string; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(input.limit ?? 5000, 50_000));
    const values: unknown[] = [];
    const batchSql = input.batchId
      ? `and metadata ->> 'batchId' = $${values.push(input.batchId)}`
      : "";
    values.push(limit);

    const result = await this.db.query<TradeRow>(
      `select
         id, user_id, wallet_id, market_external_id, side, trade_type, amount, price, shares,
         status, idempotency_key, metadata, execution_order_id, amount_coin_micros,
         fee_coin_micros, realized_pnl_coin_micros, price_nanos, created_at
       from trades
       where status = 'filled'
         and metadata ->> 'source' = 'admin_seed'
         ${batchSql}
       order by created_at asc
       limit $${values.length}`,
      values,
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      walletId: row.wallet_id,
      marketId: row.market_external_id,
      side: row.side,
      tradeType: row.trade_type,
      amount: String(row.amount),
      price: String(row.price),
      shares: String(row.shares),
      status: row.status,
      idempotencyKey: row.idempotency_key,
      metadata: row.metadata ?? {},
      executionOrderId: row.execution_order_id ?? null,
      amountCoinMicros: String(row.amount_coin_micros ?? 0),
      feeCoinMicros: String(row.fee_coin_micros ?? 0),
      realizedPnlCoinMicros:
        row.realized_pnl_coin_micros === null || row.realized_pnl_coin_micros === undefined
          ? null
          : String(row.realized_pnl_coin_micros),
      priceNanos: String(row.price_nanos ?? 0),
      createdAt: toIsoString(row.created_at),
    }));
  }

  async findTradeByIdempotencyKey(userId: string, idempotencyKey: string) {
    const result = await this.db.query<TradeRow>(
      `select
         id, user_id, wallet_id, market_external_id, side, trade_type, amount, price, shares,
         status, idempotency_key, metadata, execution_order_id, amount_coin_micros,
         fee_coin_micros, realized_pnl_coin_micros, price_nanos, created_at
       from trades
       where user_id = $1 and idempotency_key = $2
       limit 1`,
      [userId, idempotencyKey],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          walletId: row.wallet_id,
          marketId: row.market_external_id,
          side: row.side,
          tradeType: row.trade_type,
          amount: String(row.amount),
          price: String(row.price),
          shares: String(row.shares),
          status: row.status,
          idempotencyKey: row.idempotency_key,
          metadata: row.metadata ?? {},
          executionOrderId: row.execution_order_id ?? null,
          amountCoinMicros: String(row.amount_coin_micros ?? 0),
          feeCoinMicros: String(row.fee_coin_micros ?? 0),
          realizedPnlCoinMicros:
            row.realized_pnl_coin_micros === null ||
            row.realized_pnl_coin_micros === undefined
              ? null
              : String(row.realized_pnl_coin_micros),
          priceNanos: String(row.price_nanos ?? 0),
          createdAt: toIsoString(row.created_at),
        }
      : null;
  }

  async findCoinTradeOrderByIdempotencyKey(userId: string, idempotencyKey: string) {
    const result = await this.db.query<CoinTradeOrderRow>(
      `${coinTradeOrderSelect}
       where user_id = $1 and idempotency_key = $2
       limit 1`,
      [userId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? mapCoinTradeOrderRow(row) : null;
  }

  async reserveCoinTradeOrder(
    input: ReserveCoinTradeOrderInput,
  ): Promise<ReserveCoinTradeOrderResult> {
    if (!hasTransaction(this.db)) {
      throw new Error("Coin trade reserves require a transaction-capable database.");
    }

    const existing = await this.findCoinTradeOrderByIdempotencyKey(
      input.order.userId,
      input.order.idempotencyKey,
    );
    if (existing) {
      assertCoinOrderFingerprint(existing, input.order.requestFingerprint);
      return { order: existing, reserveEntry: null, idempotent: true };
    }

    try {
      return await this.db.transaction(async (client) => {
        await lockCoinMarket(client, input.order.marketId);
        await assertCoinMarketNotSettled(client, input.order.marketId);
        if (input.order.action === "sell") {
          const activeSell = await client.query<{ id: string }>(
            `select id
             from trade_execution_orders
             where user_id = $1
               and market_external_id = $2
               and side = $3
               and action = 'sell'
               and status in ('reserved', 'execution_pending', 'manual_review')
               and idempotency_key <> $4
             limit 1`,
            [
              input.order.userId,
              input.order.marketId,
              input.order.side,
              input.order.idempotencyKey,
            ],
          );
          if (activeSell.rows[0]) {
            throw new PortfolioRepositoryError(
              "TRADING_ORDER_STATE_CONFLICT",
              "Another sell execution is already active for this market position.",
              409,
            );
          }
        }
        const inserted = await client.query<CoinTradeOrderRow>(
          `insert into trade_execution_orders (
             id, user_id, market_external_id, market_title, side, action, clob_token_id,
             status, requested_coin_micros, requested_shares, quote_price_nanos,
             reserved_coin_micros, filled_coin_micros, fee_coin_micros,
             released_coin_micros, idempotency_key, request_fingerprint, metadata,
             created_at, updated_at
           )
           values (
             $1, $2, $3, $4, $5, $6, $7, 'execution_pending', $8::bigint, $9,
             $10::bigint, $11::bigint, 0, 0, 0, $12, $13, $14::jsonb, $15, $15
           )
           returning *`,
          [
            input.order.id,
            input.order.userId,
            input.order.marketId,
            input.order.marketTitle,
            input.order.side,
            input.order.action,
            input.order.clobTokenId,
            input.order.requestedCoinMicros,
            input.order.requestedShares ?? "0",
            input.order.quotePriceNanos,
            input.order.reservedCoinMicros,
            input.order.idempotencyKey,
            input.order.requestFingerprint,
            JSON.stringify(input.order.metadata),
            input.order.createdAt,
          ],
        );
        let reserveEntry: CoinLedgerEntry | null = null;
        if (input.reserveEntry) {
          reserveEntry = await new PostgresCoinLedgerRepository(client).postEntry(
            input.reserveEntry,
          );
          await client.query(
            `update trade_execution_orders
             set reserve_ledger_entry_id = $2, updated_at = now()
             where id = $1`,
            [input.order.id, reserveEntry.id],
          );
        }

        await insertMoneyOutboxEvent(client, {
          aggregateType: "trade_execution_order",
          aggregateId: input.order.id,
          eventType: "trade.execution.requested",
          idempotencyKey: `trade:${input.order.id}:execution-requested`,
          payload: input.outboxPayload,
        });

        const row = inserted.rows[0];
        if (!row) {
          throw new Error("Coin trade order insert returned no row.");
        }
        return {
          order: {
            ...mapCoinTradeOrderRow(row),
            status: "execution_pending",
            reserveLedgerEntryId: reserveEntry?.id ?? null,
          },
          reserveEntry,
          idempotent: false,
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const concurrent = await this.findCoinTradeOrderByIdempotencyKey(
        input.order.userId,
        input.order.idempotencyKey,
      );
      if (concurrent) {
        assertCoinOrderFingerprint(concurrent, input.order.requestFingerprint);
        return { order: concurrent, reserveEntry: null, idempotent: true };
      }
      if (
        input.order.action === "sell" &&
        isActiveSellOrderUniqueViolation(error)
      ) {
        throw new PortfolioRepositoryError(
          "TRADING_ORDER_STATE_CONFLICT",
          "Another sell execution is already active for this market position.",
          409,
        );
      }
      throw error;
    }
  }

  async finalizeCoinTradeOrder(
    input: FinalizeCoinTradeOrderInput,
  ): Promise<FinalizeCoinTradeOrderResult> {
    if (!hasTransaction(this.db)) {
      throw new Error("Coin trade finalization requires a transaction-capable database.");
    }

    return this.db.transaction(async (client) => {
      const market = await client.query<{ market_external_id: string }>(
        `select market_external_id
         from trade_execution_orders
         where id = $1
           and user_id = $2
           and idempotency_key = $3
         limit 1`,
        [input.orderId, input.expectedUserId, input.expectedIdempotencyKey],
      );
      const marketId = market.rows[0]?.market_external_id;
      if (!marketId) {
        throw new Error(`Coin trade order ${input.orderId} was not found.`);
      }
      await lockCoinMarket(client, marketId);
      await assertCoinMarketNotSettled(client, marketId);
      const order = await loadCoinTradeOrderForUpdate(
        client,
        input.orderId,
        input.expectedUserId,
        input.expectedIdempotencyKey,
      );
      if (isCoinTradeTerminal(order.status)) {
        const existingTrade = await loadTradeByExecutionOrderId(client, order.id);
        if (
          (order.status === "filled" || order.status === "partially_filled") &&
          existingTrade
        ) {
          return {
            order,
            trade: existingTrade,
            coinEntries: { debit: null, fee: null, release: null, credit: null },
            idempotent: true,
          };
        }
        throw new Error(`Coin trade order ${order.id} is already ${order.status}.`);
      }
      if (order.status !== "execution_pending") {
        throw new PortfolioRepositoryError(
          "TRADING_ORDER_STATE_CONFLICT",
          `Coin trade order ${order.id} cannot finalize from ${order.status}.`,
          409,
        );
      }
      await assertCoinPositionTransitionMatchesCurrent(client, order, input);

      const coinRepository = new PostgresCoinLedgerRepository(client);
      const debit = input.tradeDebitEntry
        ? await coinRepository.postEntry(input.tradeDebitEntry)
        : null;
      const fee = input.feeDebitEntry
        ? await coinRepository.postEntry(input.feeDebitEntry)
        : null;
      const credit = input.tradeCreditEntry
        ? await coinRepository.postEntry(input.tradeCreditEntry)
        : null;
      const release = input.releaseEntry
        ? await coinRepository.postEntry(input.releaseEntry)
        : null;
      const txRepository = new PostgresPortfolioRepository(
        client,
        this.ledgerRuntimePolicy,
      );

      await txRepository.insertCoinTrade(client, input.trade);
      for (const position of input.positions) {
        await txRepository.upsertPositionAtomically(position);
      }
      for (const position of input.deletePositions) {
        await txRepository.deletePositionAtomically(
          position.userId,
          position.marketId,
          position.side,
        );
      }
      if (input.auditEvent) {
        await txRepository.insertAuditEventAtomically(input.auditEvent);
      }

      const updated = await client.query<CoinTradeOrderRow>(
        `update trade_execution_orders set
           status = $2,
           filled_coin_micros = $3::bigint,
           fee_coin_micros = $4::bigint,
           released_coin_micros = $5::bigint,
           executed_shares = $6,
           executed_price_nanos = $7::bigint,
           provider = $8,
           provider_order_id = $9,
           provider_trade_id = $10,
           debit_ledger_entry_id = $11,
           fee_ledger_entry_id = $12,
           release_ledger_entry_id = $13,
           credit_ledger_entry_id = $14,
           last_error = null,
           updated_at = now()
         where id = $1
         returning *`,
        [
          order.id,
          input.terminalStatus,
          input.filledCoinMicros.toString(),
          input.feeCoinMicros.toString(),
          input.releasedCoinMicros.toString(),
          input.executedShares,
          input.executedPriceNanos.toString(),
          input.provider,
          input.providerOrderId,
          input.providerTradeId ?? null,
          debit?.id ?? null,
          fee?.id ?? null,
          release?.id ?? null,
          credit?.id ?? null,
        ],
      );
      await insertMoneyOutboxEvent(client, {
        aggregateType: "trade_execution_order",
        aggregateId: order.id,
        eventType:
          input.terminalStatus === "filled"
            ? "trade.execution.filled"
            : "trade.execution.partially-filled",
        idempotencyKey: `trade:${order.id}:finalized`,
        payload: input.outboxPayload,
      });

      const updatedOrder = updated.rows[0];
      if (!updatedOrder) {
        throw new Error("Coin trade finalization returned no order.");
      }
      return {
        order: mapCoinTradeOrderRow(updatedOrder),
        trade: input.trade,
        coinEntries: { debit, fee, release, credit },
        idempotent: false,
      };
    });
  }

  async cancelCoinTradeOrder(
    input: CancelCoinTradeOrderInput,
  ): Promise<CancelCoinTradeOrderResult> {
    if (!hasTransaction(this.db)) {
      throw new Error("Coin trade cancellation requires a transaction-capable database.");
    }

    return this.db.transaction(async (client) => {
      const order = await loadCoinTradeOrderForUpdate(
        client,
        input.orderId,
        input.expectedUserId,
        input.expectedIdempotencyKey,
      );
      if (isCoinTradeTerminal(order.status)) {
        return { order, releaseEntry: null, idempotent: true };
      }

      const releaseEntry = input.releaseEntry
        ? await new PostgresCoinLedgerRepository(client).postEntry(input.releaseEntry)
        : null;
      if (input.auditEvent) {
        await new PostgresPortfolioRepository(
          client,
          this.ledgerRuntimePolicy,
        ).insertAuditEventAtomically(input.auditEvent);
      }
      const updated = await client.query<CoinTradeOrderRow>(
        `update trade_execution_orders set
           status = $2,
           released_coin_micros = case
             when $3::uuid is null then released_coin_micros
             else reserved_coin_micros
           end,
           release_ledger_entry_id = $3,
           last_error = $4,
           updated_at = now()
         where id = $1
         returning *`,
        [order.id, input.status, releaseEntry?.id ?? null, input.error],
      );
      await insertMoneyOutboxEvent(client, {
        aggregateType: "trade_execution_order",
        aggregateId: order.id,
        eventType: `trade.execution.${input.status}`,
        idempotencyKey: `trade:${order.id}:${input.status}`,
        payload: input.outboxPayload,
      });

      const updatedOrder = updated.rows[0];
      if (!updatedOrder) {
        throw new Error("Coin trade cancellation returned no order.");
      }
      return {
        order: mapCoinTradeOrderRow(updatedOrder),
        releaseEntry,
        idempotent: false,
      };
    });
  }

  async upsertPosition(position: PositionWriteRecord) {
    throw new PortfolioRepositoryError(
      "POSITION_ATOMIC_COMMIT_REQUIRED",
      "Postgres position persistence requires commitTrade so ledger, trade, and positions are written atomically.",
    );
  }

  async deletePosition(_userId: string, _marketId: string, _side: "yes" | "no") {
    throw new PortfolioRepositoryError(
      "POSITION_ATOMIC_COMMIT_REQUIRED",
      "Postgres position deletion requires an owner commit path so ledger, trade, settlement, and positions stay consistent.",
    );
  }

  async clearMarketPositions(_marketId: string) {
    throw new PortfolioRepositoryError(
      "POSITION_ATOMIC_COMMIT_REQUIRED",
      "Postgres market position cleanup requires commitSettlement so settlement, ledger payouts, and position cleanup are written atomically.",
    );
  }

  async createTrade(_trade: TradeWriteRecord) {
    throw new PortfolioRepositoryError(
      "TRADE_ATOMIC_COMMIT_REQUIRED",
      "Postgres trade persistence requires commitTrade so ledger, trade, and positions are written atomically.",
    );
  }

  async commitTrade(input: TradeCommitInput): Promise<TradeCommitResult> {
    if (!hasTransaction(this.db)) {
      throw new Error("Postgres trade commits require a transaction-capable database.");
    }

    return this.db.transaction(async (client) => {
      const ledger = await new PostgresLedgerRepository(
        client,
        this.ledgerRuntimePolicy,
      ).createEntryAtomically(input.ledgerEntry);

      if (!ledger.idempotent) {
        const txRepository = new PostgresPortfolioRepository(
          client,
          this.ledgerRuntimePolicy,
        );
        await txRepository.insertTrade(client, input.trade, { requireInserted: true });

        for (const position of input.positions) {
          await txRepository.upsertPositionAtomically(position);
        }

        for (const position of input.deletePositions) {
          await txRepository.deletePositionAtomically(
            position.userId,
            position.marketId,
            position.side,
          );
        }

        if (input.auditEvent) {
          await txRepository.insertAuditEventAtomically(input.auditEvent);
        }
      }

      return {
        ledger,
        audit: input.auditEvent
          ? {
              committed: !ledger.idempotent,
            }
          : undefined,
      };
    });
  }

  async commitPortfolioReset(input: PortfolioResetCommitInput): Promise<PortfolioResetCommitResult> {
    if (!hasTransaction(this.db)) {
      throw new Error("Postgres portfolio resets require a transaction-capable database.");
    }

    return this.db.transaction(async (client) => {
      const ledger = await this.commitPortfolioResetLedgerAdjustment(client, input);

      await client.query(`delete from trades where user_id = $1`, [input.userId]);
      await client.query(`delete from positions where user_id = $1`, [input.userId]);

      return { ledger };
    });
  }

  async clearUserPortfolio(_userId: string) {
    throw new PortfolioRepositoryError(
      "PORTFOLIO_RESET_ATOMIC_COMMIT_REQUIRED",
      "Postgres portfolio reset requires commitPortfolioReset so ledger adjustment and portfolio cleanup are written atomically.",
    );
  }

  private async commitPortfolioResetLedgerAdjustment(
    client: Queryable,
    input: PortfolioResetCommitInput,
  ): Promise<CreateLedgerEntryResult | null> {
    const adjustment = input.ledgerAdjustment;
    if (!adjustment) {
      return null;
    }

    const ledgerRepository = new PostgresLedgerRepository(client, this.ledgerRuntimePolicy);
    const asset = adjustment.asset ?? "USDT";
    const walletId = adjustment.walletId ?? null;

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`ledger:${input.userId}`]);

    const balance = await ledgerRepository.getBalance({
      userId: input.userId,
      asset,
      walletId,
    });
    const delta = roundLedgerAmount(adjustment.targetAvailableBalance - balance.availableBalance);

    if (delta === 0) {
      return null;
    }

    return ledgerRepository.createEntryAtomically({
      userId: input.userId,
      walletId,
      asset,
      entryType: delta > 0 ? "credit" : "debit",
      amount: Math.abs(delta),
      reason: adjustment.reason,
      referenceType: adjustment.referenceType,
      referenceId: adjustment.referenceId,
      idempotencyKey: adjustment.idempotencyKey,
      metadata: {
        ...adjustment.metadata,
        resetBalance: adjustment.targetAvailableBalance,
        previousBalance: balance.availableBalance,
      },
    });
  }

  private async upsertPositionAtomically(position: PositionWriteRecord) {
    await this.db.query(
      `insert into positions (
         id, user_id, market_external_id, market_title, side, shares, total_cost,
         average_price, last_price, total_cost_coin_micros, average_price_nanos,
         last_price_nanos, opened_at, updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::bigint, $11::bigint,
               $12::bigint, $13, $14)
       on conflict (user_id, market_external_id, side) do update set
         market_title = excluded.market_title,
         shares = excluded.shares,
         total_cost = excluded.total_cost,
         average_price = excluded.average_price,
         last_price = excluded.last_price,
         total_cost_coin_micros = excluded.total_cost_coin_micros,
         average_price_nanos = excluded.average_price_nanos,
         last_price_nanos = excluded.last_price_nanos,
         updated_at = excluded.updated_at`,
      [
        position.id,
        position.userId,
        position.marketId,
        position.marketTitle,
        position.side,
        position.shares,
        position.totalCost,
        position.averagePrice,
        position.lastPrice,
        position.totalCostCoinMicros ?? "0",
        position.averagePriceNanos,
        position.lastPriceNanos,
        position.openedAt,
        position.updatedAt,
      ],
    );
  }

  private async insertAuditEventAtomically(event: AuditEvent) {
    await this.db.query(
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

  private async deletePositionAtomically(userId: string, marketId: string, side: "yes" | "no") {
    await this.db.query(
      `delete from positions where user_id = $1 and market_external_id = $2 and side = $3`,
      [userId, marketId, side],
    );
  }

  private async insertTrade(
    db: Queryable,
    trade: TradeWriteRecord,
    options: { requireInserted?: boolean } = {},
  ) {
    const result = await db.query<{ id: string }>(
      `insert into trades (
         id, user_id, wallet_id, market_external_id, side, trade_type, amount, price, shares,
         status, idempotency_key, metadata, created_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
       returning id`,
      [
        trade.id,
        trade.userId,
        trade.walletId,
        trade.marketId,
        trade.side,
        trade.tradeType,
        trade.amount,
        trade.price,
        trade.shares,
        trade.status,
        trade.idempotencyKey,
        JSON.stringify(trade.metadata ?? {}),
        trade.createdAt,
      ],
    );

    if (options.requireInserted && result.rows.length === 0) {
      throw new Error("Trade idempotency key already exists without a matching ledger commit.");
    }
  }

  private async insertCoinTrade(db: Queryable, trade: TradeWriteRecord) {
    const result = await db.query<TradeRow>(
      `insert into trades (
         id, user_id, wallet_id, market_external_id, side, trade_type, amount, price,
         shares, status, idempotency_key, metadata, execution_order_id,
         amount_coin_micros, fee_coin_micros, realized_pnl_coin_micros, price_nanos,
         created_at, updated_at
       )
       values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13,
         $14::bigint, $15::bigint, $16::bigint, $17::bigint, $18, $18
       )
       returning
         id, user_id, wallet_id, market_external_id, side, trade_type, amount, price,
         shares, status, idempotency_key, metadata, execution_order_id,
         amount_coin_micros, fee_coin_micros, realized_pnl_coin_micros, price_nanos,
         created_at`,
      [
        trade.id,
        trade.userId,
        trade.walletId,
        trade.marketId,
        trade.side,
        trade.tradeType,
        trade.amount,
        trade.price,
        trade.shares,
        trade.status,
        trade.idempotencyKey,
        JSON.stringify(trade.metadata ?? {}),
        trade.executionOrderId,
        trade.amountCoinMicros ?? "0",
        trade.feeCoinMicros ?? "0",
        trade.realizedPnlCoinMicros,
        trade.priceNanos ?? "0",
        trade.createdAt,
      ],
    );
    if (!result.rows[0]) {
      throw new Error("Coin trade insert returned no row.");
    }
  }
}

const coinTradeOrderSelect = `select
  id, user_id, market_external_id, market_title, side, action, clob_token_id,
  status, requested_coin_micros, requested_shares, quote_price_nanos,
  reserved_coin_micros, filled_coin_micros, fee_coin_micros,
  released_coin_micros, executed_shares, executed_price_nanos, provider,
  provider_order_id, provider_trade_id, reserve_ledger_entry_id,
  debit_ledger_entry_id, fee_ledger_entry_id, release_ledger_entry_id,
  credit_ledger_entry_id, idempotency_key, request_fingerprint, last_error,
  metadata, created_at, updated_at
from trade_execution_orders`;

function mapCoinTradeOrderRow(row: CoinTradeOrderRow): CoinTradeOrderRecord {
  return {
    id: row.id,
    userId: row.user_id,
    marketId: row.market_external_id,
    marketTitle: row.market_title,
    side: row.side,
    action: row.action,
    clobTokenId: row.clob_token_id,
    status: row.status,
    requestedCoinMicros: String(row.requested_coin_micros),
    requestedShares:
      row.requested_shares === null ? null : String(row.requested_shares),
    quotePriceNanos: String(row.quote_price_nanos),
    reservedCoinMicros: String(row.reserved_coin_micros),
    filledCoinMicros: String(row.filled_coin_micros),
    feeCoinMicros: String(row.fee_coin_micros),
    releasedCoinMicros: String(row.released_coin_micros),
    executedShares:
      row.executed_shares === null ? null : String(row.executed_shares),
    executedPriceNanos:
      row.executed_price_nanos === null ? null : String(row.executed_price_nanos),
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    providerTradeId: row.provider_trade_id,
    reserveLedgerEntryId: row.reserve_ledger_entry_id,
    debitLedgerEntryId: row.debit_ledger_entry_id,
    feeLedgerEntryId: row.fee_ledger_entry_id,
    releaseLedgerEntryId: row.release_ledger_entry_id,
    creditLedgerEntryId: row.credit_ledger_entry_id,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    lastError: row.last_error,
    metadata: row.metadata ?? {},
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function assertCoinOrderFingerprint(
  order: CoinTradeOrderRecord,
  expectedFingerprint: string,
) {
  if (order.requestFingerprint !== expectedFingerprint) {
    throw new PortfolioRepositoryError(
      "TRADING_ORDER_STATE_CONFLICT",
      "Trading idempotency key was already used for a different order.",
      409,
    );
  }
}

async function lockCoinMarket(db: Queryable, marketId: string) {
  await db.query(
    `select pg_advisory_xact_lock(
       hashtextextended('coin-market:' || $1::text, 0)
     )`,
    [marketId],
  );
}

async function assertCoinMarketNotSettled(db: Queryable, marketId: string) {
  const settled = await db.query<{ id: string }>(
    `select id
     from market_settlements
     where market_external_id = $1
     limit 1`,
    [marketId],
  );
  if (settled.rows[0]) {
    throw new PortfolioRepositoryError(
      "TRADING_ORDER_STATE_CONFLICT",
      "This market is already settled and cannot accept another execution.",
      409,
    );
  }
}

async function assertCoinPositionTransitionMatchesCurrent(
  db: Queryable,
  order: CoinTradeOrderRecord,
  input: FinalizeCoinTradeOrderInput,
) {
  const currentResult = await db.query<{
    shares: string | number;
    total_cost_coin_micros: string | number | null;
  }>(
    `select shares, total_cost_coin_micros
     from positions
     where user_id = $1
       and market_external_id = $2
       and side = $3
     for update`,
    [order.userId, order.marketId, order.side],
  );
  const current = currentResult.rows[0];
  const currentSharesMicros = current
    ? parseStoredDecimalToAtomic(String(current.shares), 6, {
        allowZero: true,
      })
    : 0n;
  const currentCostCoinMicros = current
    ? BigInt(current.total_cost_coin_micros ?? 0)
    : 0n;
  const executedSharesMicros = parseDecimalToAtomic(input.executedShares, 6, {
    allowZero: false,
  });
  const target = input.positions.find(
    (position) =>
      position.userId === order.userId &&
      position.marketId === order.marketId &&
      position.side === order.side,
  );
  const deletesTarget = input.deletePositions.some(
    (position) =>
      position.userId === order.userId &&
      position.marketId === order.marketId &&
      position.side === order.side,
  );

  let expectedSharesMicros: bigint;
  let expectedCostCoinMicros: bigint;
  if (order.action === "buy") {
    expectedSharesMicros = currentSharesMicros + executedSharesMicros;
    expectedCostCoinMicros = currentCostCoinMicros + input.filledCoinMicros;
  } else {
    if (
      currentSharesMicros === 0n ||
      executedSharesMicros > currentSharesMicros
    ) {
      throw coinPositionStateConflict(order.id);
    }
    const costBasisCoinMicros = multiplyDivide(
      currentCostCoinMicros,
      executedSharesMicros,
      currentSharesMicros,
      "down",
    );
    expectedSharesMicros = currentSharesMicros - executedSharesMicros;
    expectedCostCoinMicros = currentCostCoinMicros - costBasisCoinMicros;
    const expectedRealizedPnlCoinMicros =
      input.filledCoinMicros - input.feeCoinMicros - costBasisCoinMicros;
    if (
      input.trade.realizedPnlCoinMicros === null ||
      input.trade.realizedPnlCoinMicros === undefined ||
      BigInt(input.trade.realizedPnlCoinMicros) !==
        expectedRealizedPnlCoinMicros
    ) {
      throw coinPositionStateConflict(order.id);
    }
  }

  if (expectedSharesMicros === 0n) {
    if (target || !deletesTarget || expectedCostCoinMicros !== 0n) {
      throw coinPositionStateConflict(order.id);
    }
    return;
  }
  if (
    !target ||
    deletesTarget ||
    parseStoredDecimalToAtomic(target.shares, 6, { allowZero: true }) !==
      expectedSharesMicros ||
    BigInt(target.totalCostCoinMicros ?? "0") !== expectedCostCoinMicros
  ) {
    throw coinPositionStateConflict(order.id);
  }
}

function coinPositionStateConflict(orderId: string) {
  return new PortfolioRepositoryError(
    "TRADING_ORDER_STATE_CONFLICT",
    `Coin trade order ${orderId} was built from a stale market position and requires reconciliation.`,
    409,
  );
}

function isCoinTradeTerminal(status: CoinTradeOrderStatus) {
  return (
    status === "filled" ||
    status === "partially_filled" ||
    status === "cancelled" ||
    status === "failed"
  );
}

async function loadCoinTradeOrderForUpdate(
  db: Queryable,
  orderId: string,
  expectedUserId: string,
  expectedIdempotencyKey: string,
) {
  const result = await db.query<CoinTradeOrderRow>(
    `${coinTradeOrderSelect}
     where id = $1 and user_id = $2 and idempotency_key = $3
     for update`,
    [orderId, expectedUserId, expectedIdempotencyKey],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Coin trade order was not found.");
  }
  return mapCoinTradeOrderRow(row);
}

async function loadTradeByExecutionOrderId(
  db: Queryable,
  executionOrderId: string,
): Promise<TradeRecord | null> {
  const result = await db.query<TradeRow>(
    `select
       id, user_id, wallet_id, market_external_id, side, trade_type, amount, price,
       shares, status, idempotency_key, metadata, execution_order_id,
       amount_coin_micros, fee_coin_micros, realized_pnl_coin_micros, price_nanos,
       created_at
     from trades
     where execution_order_id = $1
     limit 1`,
    [executionOrderId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapTradeRow(row);
}

function mapTradeRow(row: TradeRow): TradeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    walletId: row.wallet_id,
    marketId: row.market_external_id,
    side: row.side,
    tradeType: row.trade_type,
    amount: String(row.amount),
    price: String(row.price),
    shares: String(row.shares),
    status: row.status,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata ?? {},
    executionOrderId: row.execution_order_id ?? null,
    amountCoinMicros: String(row.amount_coin_micros ?? 0),
    feeCoinMicros: String(row.fee_coin_micros ?? 0),
    realizedPnlCoinMicros:
      row.realized_pnl_coin_micros === null ||
      row.realized_pnl_coin_micros === undefined
        ? null
        : String(row.realized_pnl_coin_micros),
    priceNanos: String(row.price_nanos ?? 0),
    createdAt: toIsoString(row.created_at),
  };
}

async function insertMoneyOutboxEvent(
  db: Queryable,
  input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
) {
  await db.query(
    `insert into money_outbox_events (
       aggregate_type, aggregate_id, event_type, idempotency_key, payload
     )
     values ($1, $2, $3, $4, $5::jsonb)
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

function hasTransaction(db: Queryable | Database): db is Database {
  return typeof (db as Database).transaction === "function";
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

function isActiveSellOrderUniqueViolation(error: unknown) {
  return Boolean(
    isUniqueViolation(error) &&
      error &&
      typeof error === "object" &&
      "constraint" in error &&
      (error as { constraint?: unknown }).constraint ===
        "trade_execution_orders_active_sell_execution_uidx",
  );
}

function roundLedgerAmount(value: number) {
  return Math.round(value * 100) / 100;
}

function mapPositionRow(row: PositionRow): PositionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    marketId: row.market_external_id,
    marketTitle: row.market_title,
    side: row.side,
    shares: String(row.shares),
    totalCost: String(row.total_cost),
    averagePrice: row.average_price === null ? null : String(row.average_price),
    lastPrice: row.last_price === null ? null : String(row.last_price),
    totalCostCoinMicros: String(row.total_cost_coin_micros ?? 0),
    averagePriceNanos:
      row.average_price_nanos === null || row.average_price_nanos === undefined
        ? null
        : String(row.average_price_nanos),
    lastPriceNanos:
      row.last_price_nanos === null || row.last_price_nanos === undefined
        ? null
        : String(row.last_price_nanos),
    openedAt: toIsoString(row.opened_at),
    updatedAt: toIsoString(row.updated_at),
  };
}
