import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditService } from "./audit.js";
import type { Database, Queryable } from "./db.js";
import {
  PostgresCoinLedgerRepository,
  type PostCoinEntryInput,
} from "./coins.js";
import { parseStoredDecimalToAtomic } from "./money.js";
import {
  PostgresLedgerRepository,
  type CreateLedgerEntryInput,
  type LedgerRuntimePolicy,
  type LedgerService,
} from "./ledger.js";
import type { PortfolioRepository, PositionRecord } from "./portfolioRepository.js";
import { PLATFORM_FEE_RATE, roundMoney } from "./tradingEconomics.js";
import { toIsoString } from "./utils.js";

export type SettlementStatus = "resolved" | "cancelled" | "no_winner";
export type SettlementSide = "yes" | "no";

export type SettlementRecord = {
  id: string;
  marketId: string;
  status: SettlementStatus;
  winningSide: SettlementSide | null;
  totalPool: number;
  winningPool: number;
  platformFee: number;
  distributablePool: number;
  totalPoolCoinMicros?: string;
  winningPoolCoinMicros?: string;
  platformFeeCoinMicros?: string;
  distributablePoolCoinMicros?: string;
  payoutCount: number;
  createdBy: string | null;
  idempotencyKey: string;
  createdAt: string;
};

export type SettlementPayoutRecord = {
  id: string;
  settlementId: string;
  marketId: string;
  userId: string;
  side: SettlementSide;
  originalStake: number;
  payout: number;
  profit: number;
  originalStakeCoinMicros?: string;
  payoutCoinMicros?: string;
  profitCoinMicros?: string;
  kind: "payout" | "refund" | "loss";
  ledgerEntryId: string | null;
  coinLedgerEntryId?: string | null;
  createdAt: string;
};

export type SettlementResult = {
  settlement: SettlementRecord;
  payouts: SettlementPayoutRecord[];
  balancing: {
    totalPool: number;
    payoutTotal: number;
    platformFee: number;
    balanced: boolean;
    totalPoolCoinMicros?: string;
    payoutTotalCoinMicros?: string;
    platformFeeCoinMicros?: string;
  };
};

export type CoinSettlementResult = {
  settlement: {
    id: string;
    marketId: string;
    status: SettlementStatus;
    winningSide: SettlementSide | null;
    totalPool?: number;
    winningPool?: number;
    platformFee?: number;
    distributablePool?: number;
    totalPoolCoinMicros: string;
    winningPoolCoinMicros: string;
    platformFeeCoinMicros: string;
    distributablePoolCoinMicros: string;
    payoutCount: number;
    createdBy: string | null;
    idempotencyKey: string;
    createdAt: string;
  };
  payouts: Array<{
    id: string;
    settlementId: string;
    marketId: string;
    userId: string;
    side: SettlementSide;
    originalStake?: number;
    payout?: number;
    profit?: number;
    originalStakeCoinMicros: string;
    payoutCoinMicros: string;
    profitCoinMicros: string;
    kind: "payout" | "refund" | "loss";
    coinLedgerEntryId: string | null;
    ledgerEntryId?: string | null;
    createdAt: string;
  }>;
  balancing: {
    totalPoolCoinMicros: string;
    payoutTotalCoinMicros: string;
    platformFeeCoinMicros: string;
    balanced: boolean;
    fundingModel: "external_clob";
    providerFundingVerified: false;
    reviewOnly: true;
    totalPool?: number;
    payoutTotal?: number;
    platformFee?: number;
  };
  idempotent: boolean;
};

export type SettlementLedgerEntryDraft = {
  payoutId: string;
  input: CreateLedgerEntryInput;
};

export type SettlementCoinLedgerEntryDraft = {
  payoutId: string;
  input: PostCoinEntryInput;
};

export type SettlementCommitInput = {
  settlement: SettlementRecord;
  payouts: SettlementPayoutRecord[];
  ledgerEntries: SettlementLedgerEntryDraft[];
  coinLedgerEntries?: SettlementCoinLedgerEntryDraft[];
  auditEvent?: AuditEvent | ((result: SettlementResult) => AuditEvent | null) | null;
};

export type CoinSettlementCommitInput = {
  marketId: string;
  status: SettlementStatus;
  winningSide: SettlementSide | null;
  adminUserId: string | null;
  adminActorId: string | null;
  sessionId: string | null;
  idempotencyKey: string;
};

export type SettlementRepository = {
  findByMarketId(marketId: string): Promise<SettlementRecord | null>;
  listPayoutsByUserId?(userId: string, limit?: number): Promise<SettlementPayoutRecord[]>;
  listPayoutsBySettlementId?(
    settlementId: string,
  ): Promise<SettlementPayoutRecord[]>;
  createSettlement(
    settlement: SettlementRecord,
    payouts: SettlementPayoutRecord[],
  ): Promise<SettlementResult>;
  commitSettlement?(input: SettlementCommitInput): Promise<SettlementResult>;
  commitCoinSettlement?(
    input: CoinSettlementCommitInput,
  ): Promise<SettlementResult>;
};

export class SettlementError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SETTLEMENT_REQUEST"
      | "MARKET_ALREADY_SETTLED"
      | "NO_SETTLEMENT_POSITIONS"
      | "SETTLEMENT_EXECUTIONS_PENDING"
      | "SETTLEMENT_PROVIDER_FUNDING_UNVERIFIED"
      | "SETTLEMENT_COMMIT_INCOMPLETE"
      | "SETTLEMENT_ATOMIC_COMMIT_REQUIRED"
      | "SETTLEMENT_IDEMPOTENCY_KEY_REQUIRED",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export class MemorySettlementRepository implements SettlementRepository {
  private readonly settlementsByMarketId = new Map<string, SettlementRecord>();
  private readonly payoutsBySettlementId = new Map<string, SettlementPayoutRecord[]>();

  async findByMarketId(marketId: string) {
    return this.settlementsByMarketId.get(marketId) ?? null;
  }

  async listPayoutsByUserId(userId: string, limit = 100) {
    return [...this.payoutsBySettlementId.values()]
      .flat()
      .filter((payout) => payout.userId === userId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit);
  }

  async listPayoutsBySettlementId(settlementId: string) {
    return this.payoutsBySettlementId.get(settlementId) ?? [];
  }

  async createSettlement(settlement: SettlementRecord, payouts: SettlementPayoutRecord[]) {
    if (this.settlementsByMarketId.has(settlement.marketId)) {
      throw new SettlementError(
        "MARKET_ALREADY_SETTLED",
        "This market has already been settled.",
        409,
      );
    }

    this.settlementsByMarketId.set(settlement.marketId, settlement);
    this.payoutsBySettlementId.set(settlement.id, payouts);
    return toSettlementResult(settlement, payouts);
  }
}

type SettlementRow = {
  id: string;
  market_external_id: string;
  status: SettlementStatus;
  winning_side: SettlementSide | null;
  total_pool: string | number;
  winning_pool: string | number;
  platform_fee: string | number;
  distributable_pool: string | number;
  total_pool_coin_micros?: string | number | null;
  winning_pool_coin_micros?: string | number | null;
  platform_fee_coin_micros?: string | number | null;
  distributable_pool_coin_micros?: string | number | null;
  payout_count: string | number;
  created_by: string;
  idempotency_key: string;
  created_at: Date | string;
};

type SettlementPayoutRow = {
  id: string;
  settlement_id: string;
  market_external_id: string;
  user_id: string;
  side: SettlementSide;
  original_stake: string | number;
  payout: string | number;
  profit: string | number;
  kind: "payout" | "refund" | "loss";
  ledger_entry_id: string | null;
  coin_ledger_entry_id?: string | null;
  original_stake_coin_micros?: string | number | null;
  payout_coin_micros?: string | number | null;
  profit_coin_micros?: string | number | null;
  created_at: Date | string;
};

type CoinSettlementPositionRow = {
  user_id: string;
  side: SettlementSide;
  shares: string | number;
  total_cost_coin_micros: string | number | null;
};

type CoinSettlementPosition = Pick<
  PositionRecord,
  "userId" | "side" | "shares" | "totalCostCoinMicros"
>;

function hasTransaction(db: Queryable | Database): db is Database {
  return typeof (db as Database).transaction === "function";
}

export class PostgresSettlementRepository implements SettlementRepository {
  constructor(
    private readonly db: Queryable | Database,
    private readonly ledgerRuntimePolicy?: LedgerRuntimePolicy,
  ) {}

  async findByMarketId(marketId: string) {
    const result = await this.db.query<SettlementRow>(
      `select
         id, market_external_id, status, winning_side, total_pool, winning_pool,
         platform_fee, distributable_pool, total_pool_coin_micros,
         winning_pool_coin_micros, platform_fee_coin_micros,
         distributable_pool_coin_micros, payout_count, created_by,
         idempotency_key, created_at
       from market_settlements
       where market_external_id = $1
       limit 1`,
      [marketId],
    );

    const row = result.rows[0];
    return row ? mapSettlementRow(row) : null;
  }

  async listPayoutsByUserId(userId: string, limit = 100) {
    const result = await this.db.query<SettlementPayoutRow>(
      `select
         id, settlement_id, market_external_id, user_id, side, original_stake,
         payout, profit, kind, ledger_entry_id, coin_ledger_entry_id,
         original_stake_coin_micros, payout_coin_micros, profit_coin_micros,
         created_at
       from market_settlement_payouts
       where user_id = $1
       order by created_at desc
       limit $2`,
      [userId, limit],
    );

    return result.rows.map(mapSettlementPayoutRow);
  }

  async listPayoutsBySettlementId(settlementId: string) {
    const result = await this.db.query<SettlementPayoutRow>(
      `select
         id, settlement_id, market_external_id, user_id, side, original_stake,
         payout, profit, kind, ledger_entry_id, coin_ledger_entry_id,
         original_stake_coin_micros, payout_coin_micros, profit_coin_micros,
         created_at
       from market_settlement_payouts
       where settlement_id = $1
       order by created_at asc`,
      [settlementId],
    );
    return result.rows.map(mapSettlementPayoutRow);
  }

  async createSettlement(
    _settlement: SettlementRecord,
    _payouts: SettlementPayoutRecord[],
  ): Promise<SettlementResult> {
    throw new SettlementError(
      "SETTLEMENT_ATOMIC_COMMIT_REQUIRED",
      "Postgres settlements require commitSettlement so settlement, ledger payouts, and position cleanup are written atomically.",
      500,
    );
  }

  async commitSettlement(input: SettlementCommitInput) {
    if (!hasTransaction(this.db)) {
      throw new Error("Postgres settlement commits require a transaction-capable database.");
    }
    if (
      input.settlement.totalPoolCoinMicros !== undefined ||
      input.coinLedgerEntries !== undefined
    ) {
      throw new SettlementError(
        "SETTLEMENT_ATOMIC_COMMIT_REQUIRED",
        "Direct Coin settlement plans are rejected; use the transaction-owned position snapshot commit.",
        500,
      );
    }

    return this.db.transaction(async (client) => {
      await this.lockMarketAndAssertNoActiveExecutions(
        client,
        input.settlement.marketId,
      );
      return this.commitSettlementInTransaction(client, input);
    });
  }

  async commitCoinSettlement(input: CoinSettlementCommitInput) {
    if (!hasTransaction(this.db)) {
      throw new Error("Postgres Coin settlements require a transaction-capable database.");
    }

    return this.db.transaction(async (client) => {
      await this.lockMarketAndAssertNoActiveExecutions(client, input.marketId);
      const positions = await this.loadCoinPositionSnapshotForUpdate(
        client,
        input.marketId,
      );
      if (positions.length === 0) {
        throw new SettlementError(
          "NO_SETTLEMENT_POSITIONS",
          "There are no open positions to settle for this market.",
          404,
        );
      }

      const commit = buildCoinSettlementCommit({
        ...input,
        positions,
      });
      const result = await this.commitSettlementInTransaction(client, commit);
      assertSettlementCommitResult({
        expectedSettlement: commit.settlement,
        expectedPayouts: commit.payouts,
        expectedLedgerEntries: [],
        expectedCoinLedgerEntries: commit.coinLedgerEntries,
        result,
      });
      return result;
    });
  }

  private async lockMarketAndAssertNoActiveExecutions(
    client: Queryable,
    marketId: string,
  ) {
    await client.query(
      `select pg_advisory_xact_lock(
         hashtextextended('coin-market:' || $1::text, 0)
       )`,
      [marketId],
    );
    const activeExecutions = await client.query<{ count: string }>(
      `select count(*)::text as count
       from trade_execution_orders
       where market_external_id = $1
         and status in ('execution_pending', 'manual_review')`,
      [marketId],
    );
    if (BigInt(activeExecutions.rows[0]?.count ?? "0") > 0n) {
      throw new SettlementError(
        "SETTLEMENT_EXECUTIONS_PENDING",
        "Market settlement is blocked while external executions are pending reconciliation.",
        409,
      );
    }
  }

  private async loadCoinPositionSnapshotForUpdate(
    client: Queryable,
    marketId: string,
  ): Promise<CoinSettlementPosition[]> {
    const result = await client.query<CoinSettlementPositionRow>(
      `select user_id, side, shares, total_cost_coin_micros
       from positions
       where market_external_id = $1
       order by user_id asc, side asc
       for update`,
      [marketId],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      side: row.side,
      shares: String(row.shares),
      totalCostCoinMicros: String(row.total_cost_coin_micros ?? 0),
    }));
  }

  private async commitSettlementInTransaction(
    client: Queryable,
    input: SettlementCommitInput,
  ) {
    await this.insertSettlement(client, input.settlement);

    const ledgerEntryIdsByPayoutId = new Map<string, string>();
    for (const draft of input.ledgerEntries) {
      const ledgerResult = await new PostgresLedgerRepository(
        client,
        this.ledgerRuntimePolicy,
      ).createEntryAtomically(draft.input);
      ledgerEntryIdsByPayoutId.set(draft.payoutId, ledgerResult.entry.id);
    }
    const coinLedgerEntryIdsByPayoutId = new Map<string, string>();
    for (const draft of input.coinLedgerEntries ?? []) {
      const entry = await new PostgresCoinLedgerRepository(client).postEntry(
        draft.input,
      );
      coinLedgerEntryIdsByPayoutId.set(draft.payoutId, entry.id);
    }

    const payouts = input.payouts.map((payout) => ({
      ...payout,
      ledgerEntryId:
        ledgerEntryIdsByPayoutId.get(payout.id) ?? payout.ledgerEntryId,
      coinLedgerEntryId:
        coinLedgerEntryIdsByPayoutId.get(payout.id) ??
        payout.coinLedgerEntryId ??
        null,
    }));

    for (const payout of payouts) {
      await this.insertPayout(client, payout);
    }

    await client.query(`delete from positions where market_external_id = $1`, [
      input.settlement.marketId,
    ]);

    const result = toSettlementResult(input.settlement, payouts);
    const auditEvent = resolveSettlementAuditEvent(input.auditEvent, result);
    if (auditEvent) {
      await this.insertAuditEventAtomically(client, auditEvent);
    }
    if ((input.coinLedgerEntries?.length ?? 0) > 0) {
      await client.query(
        `insert into money_outbox_events (
           aggregate_type, aggregate_id, event_type, idempotency_key, payload
         )
         values ('market_settlement', $1, 'market.settlement.committed', $2, $3::jsonb)
         on conflict (idempotency_key) do nothing`,
        [
          input.settlement.id,
          `settlement:${input.settlement.id}:committed`,
          JSON.stringify({
            settlementId: input.settlement.id,
            marketId: input.settlement.marketId,
            payoutCount: payouts.length,
          }),
        ],
      );
    }

    return result;
  }

  private async insertSettlement(db: Queryable, settlement: SettlementRecord) {
    try {
      await db.query(
        `insert into market_settlements (
         id, market_external_id, status, winning_side, total_pool, winning_pool,
           platform_fee, distributable_pool, total_pool_coin_micros,
           winning_pool_coin_micros, platform_fee_coin_micros,
           distributable_pool_coin_micros, payout_count, created_by,
           idempotency_key, created_at, updated_at
         )
         values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9::bigint, $10::bigint,
           $11::bigint, $12::bigint, $13, $14, $15, $16, $16
         )`,
        [
          settlement.id,
          settlement.marketId,
          settlement.status,
          settlement.winningSide,
          settlement.totalPool,
          settlement.winningPool,
          settlement.platformFee,
          settlement.distributablePool,
          settlement.totalPoolCoinMicros ?? "0",
          settlement.winningPoolCoinMicros ?? "0",
          settlement.platformFeeCoinMicros ?? "0",
          settlement.distributablePoolCoinMicros ?? "0",
          settlement.payoutCount,
          settlement.createdBy,
          settlement.idempotencyKey,
          settlement.createdAt,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SettlementError(
          "MARKET_ALREADY_SETTLED",
          "This market has already been settled.",
          409,
        );
      }
      throw error;
    }
  }

  private async insertPayout(db: Queryable, payout: SettlementPayoutRecord) {
    await db.query(
      `insert into market_settlement_payouts (
         id, settlement_id, market_external_id, user_id, side, original_stake,
         payout, profit, kind, ledger_entry_id, coin_ledger_entry_id,
         original_stake_coin_micros, payout_coin_micros, profit_coin_micros,
         created_at, updated_at
       )
       values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         $12::bigint, $13::bigint, $14::bigint, $15, $15
       )
       on conflict (id) do nothing`,
      [
        payout.id,
        payout.settlementId,
        payout.marketId,
        payout.userId,
        payout.side,
        payout.originalStake,
        payout.payout,
        payout.profit,
        payout.kind,
        payout.ledgerEntryId,
        payout.coinLedgerEntryId ?? null,
        payout.originalStakeCoinMicros ?? "0",
        payout.payoutCoinMicros ?? "0",
        payout.profitCoinMicros ?? "0",
        payout.createdAt,
      ],
    );
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
}

export function buildSettlementService({
  repository,
  portfolioRepository,
  ledger = null,
  coinLedger = null,
  audit,
  requireAtomicSettlementCommits = false,
}: {
  repository: SettlementRepository;
  portfolioRepository: PortfolioRepository;
  ledger?: LedgerService | null;
  coinLedger?: Pick<PostgresCoinLedgerRepository, "getBalance" | "postEntry"> | null;
  audit: AuditService;
  requireAtomicSettlementCommits?: boolean;
}) {
  async function resolveMarket(input: {
    marketId: string;
    winningSide: unknown;
    adminUserId: string | null;
    adminActorId?: string | null;
    sessionId?: string | null;
    idempotencyKey?: string | null;
  }) {
    const winningSide = validateWinningSide(input.winningSide);

    return settleMarket({
      marketId: input.marketId,
      status: "resolved",
      winningSide,
      adminUserId: input.adminUserId,
      adminActorId: input.adminActorId,
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async function cancelMarket(input: {
    marketId: string;
    adminUserId: string | null;
    adminActorId?: string | null;
    sessionId?: string | null;
    idempotencyKey?: string | null;
  }) {
    return settleMarket({
      marketId: input.marketId,
      status: "cancelled",
      winningSide: null,
      adminUserId: input.adminUserId,
      adminActorId: input.adminActorId,
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async function settleMarket(input: {
    marketId: string;
    status: SettlementStatus;
    winningSide: SettlementSide | null;
    adminUserId: string | null;
    adminActorId?: string | null;
    sessionId?: string | null;
    idempotencyKey?: string | null;
  }) {
    const marketId = validateMarketId(input.marketId);
    const previous = await repository.findByMarketId(marketId);
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) {
      if (previous) {
        throw new SettlementError(
          "MARKET_ALREADY_SETTLED",
          "This market has already been settled.",
          409,
        );
      }
      throw new SettlementError(
        "SETTLEMENT_IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key is required for market settlement.",
      );
    }
    if (previous) {
      if (
        previous.idempotencyKey === idempotencyKey &&
        repository.listPayoutsBySettlementId
      ) {
        const payouts = await repository.listPayoutsBySettlementId(previous.id);
        const previousResult = toSettlementResult(previous, payouts);
        return coinLedger
          ? toCoinSettlementPublicResult(previousResult, true)
          : previousResult;
      }
      throw new SettlementError(
        "MARKET_ALREADY_SETTLED",
        "This market has already been settled.",
        409,
      );
    }

    if (coinLedger) {
      if (!repository.commitCoinSettlement) {
        throw new SettlementError(
          "SETTLEMENT_ATOMIC_COMMIT_REQUIRED",
          "Coin settlement requires an atomic position snapshot, Coin ledger, outbox, audit, and position commit.",
          500,
        );
      }
      const result = await settleCoinPositions({
        repository,
        marketId,
        status: input.status,
        winningSide: input.winningSide,
        adminUserId: input.adminUserId,
        adminActorId: input.adminActorId ?? input.adminUserId ?? null,
        sessionId: input.sessionId ?? null,
        idempotencyKey,
      });
      return toCoinSettlementPublicResult(result, false);
    }

    const positions = await portfolioRepository.listPositionsByMarketId(marketId);
    if (positions.length === 0) {
      throw new SettlementError(
        "NO_SETTLEMENT_POSITIONS",
        "There are no open positions to settle for this market.",
        404,
      );
    }

    const groupedPositions = groupPositionStakes(positions);
    const totalPool = roundMoney(
      groupedPositions.reduce((total, position) => total + position.originalStake, 0),
    );
    const winningPositions =
      input.status === "resolved" && input.winningSide
        ? groupedPositions.filter((position) => position.side === input.winningSide)
        : [];
    const winningPool = roundMoney(
      winningPositions.reduce((total, position) => total + position.originalStake, 0),
    );
    const shouldRefund = input.status !== "resolved" || winningPool <= 0;
    const platformFee = shouldRefund ? 0 : roundMoney(totalPool * PLATFORM_FEE_RATE);
    const distributablePool = shouldRefund ? totalPool : roundMoney(totalPool - platformFee);
    const settlement: SettlementRecord = {
      id: randomUUID(),
      marketId,
      status: shouldRefund && input.status === "resolved" ? "no_winner" : input.status,
      winningSide: shouldRefund ? null : input.winningSide,
      totalPool,
      winningPool: shouldRefund ? 0 : winningPool,
      platformFee,
      distributablePool,
      payoutCount: 0,
      createdBy: input.adminUserId,
      idempotencyKey:
        idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    const payoutDrafts = shouldRefund
      ? groupedPositions.map((position) => ({
          ...position,
          payout: position.originalStake,
          profit: 0,
          kind: "refund" as const,
        }))
      : allocateWinnerPayouts({
          positions: groupedPositions,
          winningSide: input.winningSide as SettlementSide,
          distributablePool,
        });
    const payouts: SettlementPayoutRecord[] = [];
    const ledgerEntries: SettlementLedgerEntryDraft[] = [];

    for (const draft of payoutDrafts) {
      const payout: SettlementPayoutRecord = {
        id: randomUUID(),
        settlementId: settlement.id,
        marketId,
        userId: draft.userId,
        side: draft.side,
        originalStake: draft.originalStake,
        payout: draft.payout,
        profit: draft.profit,
        kind: draft.kind,
        ledgerEntryId: null,
        createdAt: settlement.createdAt,
      };

      if (payout.payout > 0) {
        ledgerEntries.push({
          payoutId: payout.id,
          input: {
            userId: payout.userId,
            walletId: null,
            asset: "USDT",
            entryType: "credit",
            amount: payout.payout,
            reason: payout.kind === "refund" ? "settlement_refund" : "settlement_payout",
            referenceType: "market_settlement",
            referenceId: settlement.id,
            idempotencyKey: `settlement:${marketId}:${payout.userId}:${payout.side}`,
            metadata: {
              marketId,
              settlementId: settlement.id,
              side: payout.side,
              originalStake: payout.originalStake,
              payout: payout.payout,
              profit: payout.profit,
              kind: payout.kind,
              source: "market_settlement",
            },
          },
        });
      }

      payouts.push(payout);
    }

    settlement.payoutCount = payouts.filter((payout) => payout.payout > 0).length;
    const buildAuditEvent = (settlementResult: SettlementResult) =>
      buildSettlementAuditEvent({
        result: settlementResult,
        marketId,
        adminUserId: input.adminUserId,
        adminActorId: input.adminActorId ?? input.adminUserId ?? null,
        sessionId: input.sessionId ?? null,
      });
    const result = repository.commitSettlement
      ? await repository.commitSettlement({
          settlement,
          payouts,
          ledgerEntries,
          auditEvent: buildAuditEvent,
        })
      : await (() => {
          if (requireAtomicSettlementCommits || !ledger) {
            throw new SettlementError(
              "SETTLEMENT_ATOMIC_COMMIT_REQUIRED",
              "Market settlement requires an atomic settlement, ledger, and portfolio repository commit.",
              500,
            );
          }

          return commitSettlementWithoutRepositoryTransaction({
            settlement,
            payouts,
            ledgerEntries,
            ledger,
            repository,
            portfolioRepository,
          });
        })();
    assertSettlementCommitResult({
      expectedSettlement: settlement,
      expectedPayouts: payouts,
      expectedLedgerEntries: ledgerEntries,
      result,
    });
    if (!repository.commitSettlement) {
      await audit.repository.record(buildAuditEvent(result));
    }

    return result;
  }

  return {
    repository,
    resolveMarket,
    cancelMarket,
  };
}

export type SettlementService = ReturnType<typeof buildSettlementService>;

async function settleCoinPositions(input: {
  repository: SettlementRepository;
  marketId: string;
  status: SettlementStatus;
  winningSide: SettlementSide | null;
  adminUserId: string | null;
  adminActorId: string | null;
  sessionId: string | null;
  idempotencyKey: string;
}): Promise<SettlementResult> {
  return input.repository.commitCoinSettlement!({
    marketId: input.marketId,
    status: input.status,
    winningSide: input.winningSide,
    adminUserId: input.adminUserId,
    adminActorId: input.adminActorId,
    sessionId: input.sessionId,
    idempotencyKey: input.idempotencyKey,
  });
}

function buildCoinSettlementCommit(
  input: CoinSettlementCommitInput & { positions: CoinSettlementPosition[] },
): SettlementCommitInput {
  const grouped = groupCoinPositionStakes(input.positions);
  const hasWinningPosition =
    input.status === "resolved" &&
    input.winningSide !== null &&
    grouped.some((position) => position.side === input.winningSide);
  if (hasWinningPosition) {
    throw new SettlementError(
      "SETTLEMENT_PROVIDER_FUNDING_UNVERIFIED",
      "Resolved Coin payout credits are blocked until an authoritative provider funding receipt is persisted and verified.",
      409,
    );
  }

  const shouldRefund = !hasWinningPosition;
  const totalPoolCoinMicros = grouped.reduce(
    (sum, position) => sum + position.originalStakeCoinMicros,
    0n,
  );
  const settlement: SettlementRecord = {
    id: randomUUID(),
    marketId: input.marketId,
    status:
      shouldRefund && input.status === "resolved" ? "no_winner" : input.status,
    winningSide: null,
    totalPool: 0,
    winningPool: 0,
    platformFee: 0,
    distributablePool: 0,
    totalPoolCoinMicros: totalPoolCoinMicros.toString(),
    winningPoolCoinMicros: "0",
    platformFeeCoinMicros: "0",
    distributablePoolCoinMicros: "0",
    payoutCount: 0,
    createdBy: input.adminUserId,
    idempotencyKey: input.idempotencyKey,
    createdAt: new Date().toISOString(),
  };
  const payouts: SettlementPayoutRecord[] = grouped.map((position) => {
    const payoutCoinMicros = position.originalStakeCoinMicros;
    const profitCoinMicros =
      payoutCoinMicros - position.originalStakeCoinMicros;
    return {
      id: randomUUID(),
      settlementId: settlement.id,
      marketId: input.marketId,
      userId: position.userId,
      side: position.side,
      originalStake: 0,
      payout: 0,
      profit: 0,
      originalStakeCoinMicros: position.originalStakeCoinMicros.toString(),
      payoutCoinMicros: payoutCoinMicros.toString(),
      profitCoinMicros: profitCoinMicros.toString(),
      kind: "refund",
      ledgerEntryId: null,
      coinLedgerEntryId: null,
      createdAt: settlement.createdAt,
    };
  });
  const payoutTotalCoinMicros = payouts.reduce(
    (sum, payout) => sum + BigInt(payout.payoutCoinMicros ?? "0"),
    0n,
  );
  settlement.distributablePoolCoinMicros = payoutTotalCoinMicros.toString();
  settlement.payoutCount = payouts.filter(
    (payout) => BigInt(payout.payoutCoinMicros ?? "0") > 0n,
  ).length;
  const coinLedgerEntries: SettlementCoinLedgerEntryDraft[] = payouts
    .filter((payout) => BigInt(payout.payoutCoinMicros ?? "0") > 0n)
    .map((payout) => ({
      payoutId: payout.id,
      input: {
        userId: payout.userId,
        operationType:
          payout.kind === "refund" ? "refund_credit" : "trade_settlement_credit",
        availableDeltaCoinMicros: BigInt(payout.payoutCoinMicros ?? "0"),
        reservedDeltaCoinMicros: 0n,
        idempotencyKey: `settlement:${input.marketId}:${payout.userId}:${payout.side}`,
        sourceType: "market_settlement",
        sourceId: settlement.id,
        reason:
          payout.kind === "refund"
            ? "Refund Coin stake after cancelled market"
            : "Credit Coin payout for resolved market",
        adminActor: input.adminActorId,
        auditMetadata: {
          marketId: input.marketId,
          settlementId: settlement.id,
          side: payout.side,
          originalStakeCoinMicros: payout.originalStakeCoinMicros,
          payoutCoinMicros: payout.payoutCoinMicros,
          profitCoinMicros: payout.profitCoinMicros,
          kind: payout.kind,
        },
      },
    }));
  const buildAuditEvent = (result: SettlementResult) =>
    buildSettlementAuditEvent({
      result,
      marketId: input.marketId,
      adminUserId: input.adminUserId,
      adminActorId: input.adminActorId,
      sessionId: input.sessionId,
    });

  return {
    settlement,
    payouts,
    ledgerEntries: [],
    coinLedgerEntries,
    auditEvent: buildAuditEvent,
  };
}

function groupCoinPositionStakes(positions: CoinSettlementPosition[]) {
  const grouped = new Map<
    string,
    {
      userId: string;
      side: SettlementSide;
      originalStakeCoinMicros: bigint;
      sharesMicros: bigint;
    }
  >();
  for (const position of positions) {
    const stake = BigInt(position.totalCostCoinMicros ?? "0");
    const shares = parseStoredDecimalToAtomic(position.shares, 6, {
      allowZero: true,
    });
    if (stake === 0n && shares === 0n) continue;
    const key = `${position.userId}:${position.side}`;
    const current = grouped.get(key) ?? {
      userId: position.userId,
      side: position.side,
      originalStakeCoinMicros: 0n,
      sharesMicros: 0n,
    };
    current.originalStakeCoinMicros += stake;
    current.sharesMicros += shares;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function toCoinSettlementPublicResult(
  result: SettlementResult,
  idempotent: boolean,
): CoinSettlementResult {
  const totalPoolCoinMicros = result.settlement.totalPoolCoinMicros ?? "0";
  const payoutTotalCoinMicros = result.payouts
    .reduce(
      (sum, payout) => sum + BigInt(payout.payoutCoinMicros ?? "0"),
      0n,
    )
    .toString();
  return {
    settlement: {
      id: result.settlement.id,
      marketId: result.settlement.marketId,
      status: result.settlement.status,
      winningSide: result.settlement.winningSide,
      totalPoolCoinMicros,
      winningPoolCoinMicros:
        result.settlement.winningPoolCoinMicros ?? "0",
      platformFeeCoinMicros:
        result.settlement.platformFeeCoinMicros ?? "0",
      distributablePoolCoinMicros:
        result.settlement.distributablePoolCoinMicros ?? payoutTotalCoinMicros,
      payoutCount: result.settlement.payoutCount,
      createdBy: result.settlement.createdBy,
      idempotencyKey: result.settlement.idempotencyKey,
      createdAt: result.settlement.createdAt,
    },
    payouts: result.payouts.map((payout) => ({
      id: payout.id,
      settlementId: payout.settlementId,
      marketId: payout.marketId,
      userId: payout.userId,
      side: payout.side,
      originalStakeCoinMicros: payout.originalStakeCoinMicros ?? "0",
      payoutCoinMicros: payout.payoutCoinMicros ?? "0",
      profitCoinMicros: payout.profitCoinMicros ?? "0",
      kind: payout.kind,
      coinLedgerEntryId: payout.coinLedgerEntryId ?? null,
      createdAt: payout.createdAt,
    })),
    balancing: {
      totalPoolCoinMicros,
      payoutTotalCoinMicros,
      platformFeeCoinMicros:
        result.settlement.platformFeeCoinMicros ?? "0",
      balanced: result.balancing.balanced,
      fundingModel: "external_clob",
      providerFundingVerified: false,
      reviewOnly: true,
    },
    idempotent,
  };
}

async function commitSettlementWithoutRepositoryTransaction({
  settlement,
  payouts,
  ledgerEntries,
  ledger,
  repository,
  portfolioRepository,
}: {
  settlement: SettlementRecord;
  payouts: SettlementPayoutRecord[];
  ledgerEntries: SettlementLedgerEntryDraft[];
  ledger: LedgerService;
  repository: SettlementRepository;
  portfolioRepository: PortfolioRepository;
}) {
  for (const draft of ledgerEntries) {
    const ledgerResult = await ledger.createEntry(draft.input);
    const payout = payouts.find((candidate) => candidate.id === draft.payoutId);
    if (payout) {
      payout.ledgerEntryId = ledgerResult.entry.id;
    }
  }

  const result = await repository.createSettlement(settlement, payouts);
  await portfolioRepository.clearMarketPositions(settlement.marketId);
  return result;
}

function buildSettlementAuditEvent({
  result,
  marketId,
  adminUserId,
  adminActorId,
  sessionId,
}: {
  result: SettlementResult;
  marketId: string;
  adminUserId: string | null;
  adminActorId: string | null;
  sessionId: string | null;
}): AuditEvent {
  return {
    id: randomUUID(),
    eventType:
      result.settlement.status === "cancelled" ? "market.cancelled" : "market.settled",
    userId: adminUserId,
    sessionId,
    metadata: {
      adminActorId,
      marketId,
      settlementId: result.settlement.id,
      status: result.settlement.status,
      winningSide: result.settlement.winningSide,
      totalPool: result.settlement.totalPool,
      winningPool: result.settlement.winningPool,
      platformFee: result.settlement.platformFee,
      payoutTotal: result.balancing.payoutTotal,
      balanced: result.balancing.balanced,
      totalPoolCoinMicros: result.balancing.totalPoolCoinMicros ?? null,
      payoutTotalCoinMicros: result.balancing.payoutTotalCoinMicros ?? null,
      platformFeeCoinMicros: result.balancing.platformFeeCoinMicros ?? null,
      fundingModel:
        result.balancing.totalPoolCoinMicros !== undefined
          ? "clob_share_redemption"
          : "legacy_internal_pool",
      providerFundingVerified: false,
    },
    createdAt: result.settlement.createdAt,
  };
}

function resolveSettlementAuditEvent(
  auditEvent: SettlementCommitInput["auditEvent"],
  result: SettlementResult,
) {
  return typeof auditEvent === "function" ? auditEvent(result) : auditEvent ?? null;
}

function assertSettlementCommitResult(input: {
  expectedSettlement: SettlementRecord;
  expectedPayouts: SettlementPayoutRecord[];
  expectedLedgerEntries: SettlementLedgerEntryDraft[];
  expectedCoinLedgerEntries?: SettlementCoinLedgerEntryDraft[];
  result: SettlementResult;
}) {
  const {
    expectedSettlement,
    expectedPayouts,
    expectedLedgerEntries,
    expectedCoinLedgerEntries = [],
    result,
  } = input;
  if (
    result.settlement.id !== expectedSettlement.id ||
    result.settlement.marketId !== expectedSettlement.marketId
  ) {
    throw new SettlementError(
      "SETTLEMENT_COMMIT_INCOMPLETE",
      "Settlement commit returned a different settlement identity.",
      500,
    );
  }

  const expectedPayoutsById = new Map(expectedPayouts.map((payout) => [payout.id, payout]));
  if (result.payouts.length !== expectedPayouts.length) {
    throw new SettlementError(
      "SETTLEMENT_COMMIT_INCOMPLETE",
      "Settlement commit returned an incomplete payout set.",
      500,
    );
  }

  for (const payout of result.payouts) {
    const expected = expectedPayoutsById.get(payout.id);
    if (
      !expected ||
      payout.marketId !== expected.marketId ||
      payout.userId !== expected.userId ||
      payout.side !== expected.side ||
      payout.kind !== expected.kind ||
      payout.originalStake !== expected.originalStake ||
      payout.payout !== expected.payout ||
      payout.profit !== expected.profit ||
      payout.originalStakeCoinMicros !== expected.originalStakeCoinMicros ||
      payout.payoutCoinMicros !== expected.payoutCoinMicros ||
      payout.profitCoinMicros !== expected.profitCoinMicros
    ) {
      throw new SettlementError(
        "SETTLEMENT_COMMIT_INCOMPLETE",
        "Settlement commit returned a payout that does not match the settlement plan.",
        500,
      );
    }
  }

  const ledgerPayoutIds = new Set(expectedLedgerEntries.map((entry) => entry.payoutId));
  const missingLedgerPayout = result.payouts.find(
    (payout) => ledgerPayoutIds.has(payout.id) && !payout.ledgerEntryId,
  );
  if (missingLedgerPayout) {
    throw new SettlementError(
      "SETTLEMENT_COMMIT_INCOMPLETE",
      "Settlement commit returned a positive payout without a ledger entry.",
      500,
    );
  }
  const coinLedgerPayoutIds = new Set(
    expectedCoinLedgerEntries.map((entry) => entry.payoutId),
  );
  const missingCoinLedgerPayout = result.payouts.find(
    (payout) =>
      coinLedgerPayoutIds.has(payout.id) && !payout.coinLedgerEntryId,
  );
  if (missingCoinLedgerPayout) {
    throw new SettlementError(
      "SETTLEMENT_COMMIT_INCOMPLETE",
      "Settlement commit returned a positive Coin payout without a Coin ledger entry.",
      500,
    );
  }

  if (!result.balancing.balanced) {
    throw new SettlementError(
      "SETTLEMENT_COMMIT_INCOMPLETE",
      "Settlement commit returned an unbalanced payout plan.",
      500,
    );
  }
}

type GroupedPositionStake = {
  userId: string;
  side: SettlementSide;
  originalStake: number;
};

function groupPositionStakes(positions: PositionRecord[]): GroupedPositionStake[] {
  const byUserSide = new Map<string, GroupedPositionStake>();

  for (const position of positions) {
    const originalStake = Math.max(0, Number(position.totalCost));
    if (originalStake <= 0) {
      continue;
    }

    const key = `${position.userId}:${position.side}`;
    const existing = byUserSide.get(key) ?? {
      userId: position.userId,
      side: position.side,
      originalStake: 0,
    };
    existing.originalStake = roundMoney(existing.originalStake + originalStake);
    byUserSide.set(key, existing);
  }

  return [...byUserSide.values()];
}

function allocateWinnerPayouts({
  positions,
  winningSide,
  distributablePool,
}: {
  positions: GroupedPositionStake[];
  winningSide: SettlementSide;
  distributablePool: number;
}) {
  const winners = positions.filter((position) => position.side === winningSide);
  const losers = positions.filter((position) => position.side !== winningSide);
  const allocated = allocateRoundedAmounts(
    winners.map((winner) => ({
      key: `${winner.userId}:${winner.side}`,
      weight: winner.originalStake,
    })),
    distributablePool,
  );

  return [
    ...winners.map((winner) => {
      const payout = allocated.get(`${winner.userId}:${winner.side}`) ?? 0;

      return {
        ...winner,
        payout,
        profit: roundMoney(payout - winner.originalStake),
        kind: "payout" as const,
      };
    }),
    ...losers.map((loser) => ({
      ...loser,
      payout: 0,
      profit: -loser.originalStake,
      kind: "loss" as const,
    })),
  ];
}

function allocateRoundedAmounts(
  weights: Array<{ key: string; weight: number }>,
  totalAmount: number,
) {
  const totalWeight = weights.reduce((total, item) => total + item.weight, 0);
  const exact = weights.map((item) => ({
    ...item,
    exact: totalWeight > 0 ? (item.weight / totalWeight) * totalAmount : 0,
  }));
  const rounded = new Map<string, number>();
  let roundedTotal = 0;

  for (const item of exact) {
    const value = Math.floor((item.exact + Number.EPSILON) * 100) / 100;
    rounded.set(item.key, value);
    roundedTotal = roundMoney(roundedTotal + value);
  }

  let remainder = Math.round((totalAmount - roundedTotal) * 100);
  const largest = [...exact].sort((left, right) => right.weight - left.weight)[0] ?? exact.at(-1);
  const remainderTarget = largest?.key;

  if (remainderTarget) {
    rounded.set(remainderTarget, roundMoney((rounded.get(remainderTarget) ?? 0) + remainder / 100));
    remainder = 0;
  }

  if (remainder !== 0 && exact[0]) {
    rounded.set(exact[0].key, roundMoney((rounded.get(exact[0].key) ?? 0) + remainder / 100));
  }

  return rounded;
}

function toSettlementResult(
  settlement: SettlementRecord,
  payouts: SettlementPayoutRecord[],
): SettlementResult {
  const payoutTotal = roundMoney(
    payouts.reduce((total, payout) => total + Math.max(0, payout.payout), 0),
  );
  const hasCoinAmounts =
    settlement.totalPoolCoinMicros !== undefined ||
    payouts.some((payout) => payout.payoutCoinMicros !== undefined);
  const payoutTotalCoinMicros = payouts.reduce(
    (total, payout) => total + BigInt(payout.payoutCoinMicros ?? "0"),
    0n,
  );
  const totalPoolCoinMicros = BigInt(
    settlement.totalPoolCoinMicros ?? "0",
  );
  const platformFeeCoinMicros = BigInt(
    settlement.platformFeeCoinMicros ?? "0",
  );

  return {
    settlement,
    payouts,
    balancing: {
      totalPool: settlement.totalPool,
      payoutTotal,
      platformFee: settlement.platformFee,
      balanced: hasCoinAmounts
        ? payoutTotalCoinMicros + platformFeeCoinMicros ===
          totalPoolCoinMicros
        : Math.abs(payoutTotal + settlement.platformFee - settlement.totalPool) < 0.01,
      totalPoolCoinMicros: settlement.totalPoolCoinMicros,
      payoutTotalCoinMicros: hasCoinAmounts
        ? payoutTotalCoinMicros.toString()
        : undefined,
      platformFeeCoinMicros: settlement.platformFeeCoinMicros,
    },
  };
}

function validateWinningSide(value: unknown): SettlementSide {
  if (value === "yes" || value === "no") {
    return value;
  }

  throw new SettlementError(
    "INVALID_SETTLEMENT_REQUEST",
    "winningSide must be yes or no.",
  );
}

function validateMarketId(value: string) {
  const marketId = value.trim();

  if (!marketId) {
    throw new SettlementError(
      "INVALID_SETTLEMENT_REQUEST",
      "marketId is required.",
    );
  }

  return marketId;
}

function mapSettlementRow(row: SettlementRow): SettlementRecord {
  return {
    id: row.id,
    marketId: row.market_external_id,
    status: row.status,
    winningSide: row.winning_side,
    totalPool: Number(row.total_pool),
    winningPool: Number(row.winning_pool),
    platformFee: Number(row.platform_fee),
    distributablePool: Number(row.distributable_pool),
    totalPoolCoinMicros: String(row.total_pool_coin_micros ?? 0),
    winningPoolCoinMicros: String(row.winning_pool_coin_micros ?? 0),
    platformFeeCoinMicros: String(row.platform_fee_coin_micros ?? 0),
    distributablePoolCoinMicros: String(
      row.distributable_pool_coin_micros ?? 0,
    ),
    payoutCount: Number(row.payout_count),
    createdBy: row.created_by,
    idempotencyKey: row.idempotency_key,
    createdAt: toIsoString(row.created_at),
  };
}

function mapSettlementPayoutRow(row: SettlementPayoutRow): SettlementPayoutRecord {
  return {
    id: row.id,
    settlementId: row.settlement_id,
    marketId: row.market_external_id,
    userId: row.user_id,
    side: row.side,
    originalStake: Number(row.original_stake),
    payout: Number(row.payout),
    profit: Number(row.profit),
    originalStakeCoinMicros: String(row.original_stake_coin_micros ?? 0),
    payoutCoinMicros: String(row.payout_coin_micros ?? 0),
    profitCoinMicros: String(row.profit_coin_micros ?? 0),
    kind: row.kind,
    ledgerEntryId: row.ledger_entry_id,
    coinLedgerEntryId: row.coin_ledger_entry_id ?? null,
    createdAt: toIsoString(row.created_at),
  };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
