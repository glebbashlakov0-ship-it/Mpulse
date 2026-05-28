import { randomUUID } from "node:crypto";
import type { AuditService } from "./audit.js";
import type { Queryable } from "./db.js";
import type { LedgerService } from "./ledger.js";
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
  kind: "payout" | "refund" | "loss";
  ledgerEntryId: string | null;
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
  };
};

export type SettlementRepository = {
  findByMarketId(marketId: string): Promise<SettlementRecord | null>;
  listPayoutsByUserId?(userId: string, limit?: number): Promise<SettlementPayoutRecord[]>;
  createSettlement(
    settlement: SettlementRecord,
    payouts: SettlementPayoutRecord[],
  ): Promise<SettlementResult>;
};

export class SettlementError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SETTLEMENT_REQUEST"
      | "MARKET_ALREADY_SETTLED"
      | "NO_SETTLEMENT_POSITIONS",
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
  created_at: Date | string;
};

export class PostgresSettlementRepository implements SettlementRepository {
  constructor(private readonly db: Queryable) {}

  async findByMarketId(marketId: string) {
    const result = await this.db.query<SettlementRow>(
      `select
         id, market_external_id, status, winning_side, total_pool, winning_pool,
         platform_fee, distributable_pool, payout_count, created_by, idempotency_key, created_at
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
         payout, profit, kind, ledger_entry_id, created_at
       from market_settlement_payouts
       where user_id = $1
       order by created_at desc
       limit $2`,
      [userId, limit],
    );

    return result.rows.map(mapSettlementPayoutRow);
  }

  async createSettlement(settlement: SettlementRecord, payouts: SettlementPayoutRecord[]) {
    try {
      await this.db.query(
        `insert into market_settlements (
           id, market_external_id, status, winning_side, total_pool, winning_pool,
           platform_fee, distributable_pool, payout_count, created_by, idempotency_key,
           created_at, updated_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [
          settlement.id,
          settlement.marketId,
          settlement.status,
          settlement.winningSide,
          settlement.totalPool,
          settlement.winningPool,
          settlement.platformFee,
          settlement.distributablePool,
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

    for (const payout of payouts) {
      await this.db.query(
        `insert into market_settlement_payouts (
           id, settlement_id, market_external_id, user_id, side, original_stake,
           payout, profit, kind, ledger_entry_id, created_at, updated_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
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
          payout.createdAt,
        ],
      );
    }

    return toSettlementResult(settlement, payouts);
  }
}

export function buildSettlementService({
  repository,
  portfolioRepository,
  ledger,
  audit,
}: {
  repository: SettlementRepository;
  portfolioRepository: PortfolioRepository;
  ledger: LedgerService;
  audit: AuditService;
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

    if (previous) {
      throw new SettlementError(
        "MARKET_ALREADY_SETTLED",
        "This market has already been settled.",
        409,
      );
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
        input.idempotencyKey?.trim() || `settlement:${marketId}:${input.status}:${Date.now()}`,
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
        const ledgerResult = await ledger.createEntry({
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
          },
        });
        payout.ledgerEntryId = ledgerResult.entry.id;
      }

      payouts.push(payout);
    }

    settlement.payoutCount = payouts.filter((payout) => payout.payout > 0).length;
    const result = await repository.createSettlement(settlement, payouts);
    await portfolioRepository.clearMarketPositions(marketId);
    await audit.record({
      eventType: settlement.status === "cancelled" ? "market.cancelled" : "market.settled",
      userId: input.adminUserId,
      sessionId: input.sessionId ?? null,
      metadata: {
        adminActorId: input.adminActorId ?? input.adminUserId ?? null,
        marketId,
        settlementId: settlement.id,
        status: settlement.status,
        winningSide: settlement.winningSide,
        totalPool: settlement.totalPool,
        winningPool: settlement.winningPool,
        platformFee: settlement.platformFee,
        payoutTotal: result.balancing.payoutTotal,
        balanced: result.balancing.balanced,
      },
    });

    return result;
  }

  return {
    repository,
    resolveMarket,
    cancelMarket,
  };
}

export type SettlementService = ReturnType<typeof buildSettlementService>;

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

  return {
    settlement,
    payouts,
    balancing: {
      totalPool: settlement.totalPool,
      payoutTotal,
      platformFee: settlement.platformFee,
      balanced: Math.abs(payoutTotal + settlement.platformFee - settlement.totalPool) < 0.01,
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
    kind: row.kind,
    ledgerEntryId: row.ledger_entry_id,
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
