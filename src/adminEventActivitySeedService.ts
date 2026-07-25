import { createHash, randomUUID } from "node:crypto";
import type { AuthService, PublicUser } from "./auth.js";
import { LedgerError, type LedgerEntry, type LedgerService } from "./ledger.js";
import type { MarketDataService, MarketListParams } from "./marketDataService.js";
import type { MarketActivityRepository, MarketTradeActivityRecord } from "./marketActivityRepository.js";
import type {
  MarketPriceHistoryRepository,
  SaveMarketPriceHistoryPointInput,
} from "./marketPriceHistoryRepository.js";
import { getMarketPriceHistoryScope, type MarketPriceHistoryScope } from "./marketPriceHistoryScope.js";
import type { MarketSeedService } from "./marketSeedService.js";
import { buildGroupedMarketHistory, buildOwnMarketHistory } from "./marketOdds.js";
import type { PlatformActivityRepository } from "./platformActivity.js";
import type { PortfolioRepository } from "./portfolioRepository.js";
import { placeLocalOrder, type TradeSide } from "./trading.js";
import { syncTradingMarketActivity } from "./tradingActivitySync.js";
import type { MarketPriceHistoryPoint, NormalizedGroupMarket, NormalizedMarketDetail } from "./types.js";
import {
  WALLET_ASSET,
  WALLET_NETWORK,
  WALLET_PROVIDER,
  type Wallet,
  type WalletDepositEvent,
  type WalletRepository,
} from "./wallets.js";

export type AdminEventActivitySeedInput = {
  batchId?: unknown;
  marketIds?: unknown;
  filters?: unknown;
  userIds?: unknown;
  betsPerEventMin?: unknown;
  betsPerEventMax?: unknown;
  betAmountMin?: unknown;
  betAmountMax?: unknown;
  depositAmountMin?: unknown;
  depositAmountMax?: unknown;
  depositBufferMultiplier?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  publicActivity?: unknown;
  force?: unknown;
};

type ParsedInput = {
  batchId: string;
  marketIds: string[];
  filters: MarketListParams;
  userIds: string[];
  betsPerEventMin: number;
  betsPerEventMax: number;
  betAmountMin: number;
  betAmountMax: number;
  depositAmountMin: number;
  depositAmountMax: number;
  depositBufferMultiplier: number;
  startAt: Date;
  endAt: Date;
  publicActivity: boolean;
  force: boolean;
};

type ResolvedTarget = {
  marketId: string;
  title: string;
  scope: MarketPriceHistoryScope;
  detail: NormalizedMarketDetail;
  grouped: boolean;
};

type PlannedBet = {
  target: ResolvedTarget;
  user: PublicUser;
  index: number;
  marketId: string;
  marketTitle: string;
  side: TradeSide;
  amount: number;
  createdAt: string;
  idempotencyKey: string;
};

export class AdminEventActivitySeedError extends Error {
  constructor(
    public readonly code:
      | "INVALID_EVENT_ACTIVITY_SEED"
      | "EVENT_ACTIVITY_SEED_UNAVAILABLE",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function buildAdminEventActivitySeedService({
  auth,
  marketData,
  marketSeed,
  ledger,
  walletRepository,
  portfolioRepository,
  marketActivityRepository,
  priceHistoryRepository,
  platformActivityRepository,
}: {
  auth: AuthService;
  marketData: MarketDataService;
  marketSeed: MarketSeedService;
  ledger: LedgerService;
  walletRepository: WalletRepository;
  portfolioRepository: PortfolioRepository;
  marketActivityRepository: MarketActivityRepository;
  priceHistoryRepository: MarketPriceHistoryRepository;
  platformActivityRepository: PlatformActivityRepository;
}) {
  async function seedEventActivity(input: {
    body: AdminEventActivitySeedInput;
    adminUserId: string;
    createdByUserId?: string | null;
  }) {
    const parsed = parseSeedInput(input.body);
    const users = await loadUsers(auth, parsed.userIds);
    const resolved = await resolveTargets({
      marketData,
      parsed,
    });
    const skipped: Array<{
      scopeId?: string;
      marketId?: string;
      userId?: string;
      reason: string;
    }> = [...resolved.skipped];
    const errors: Array<{
      scopeId?: string;
      marketId?: string;
      userId?: string;
      message: string;
    }> = [...resolved.errors];
    const targets: Array<ResolvedTarget & { plannedBets: number; tradesCreated: number }> = [];
    const plannedBets: PlannedBet[] = [];

    for (const target of resolved.targets) {
      const existingSeedBatches = await listExistingAdminSeedBatches(
        priceHistoryRepository,
        target.scope,
      );
      if (
        !parsed.force &&
        existingSeedBatches.length > 0 &&
        !existingSeedBatches.includes(parsed.batchId)
      ) {
        skipped.push({
          scopeId: target.scope.scopeId,
          marketId: target.marketId,
          reason: "already_seeded",
        });
        continue;
      }

      await marketSeed.seedOddsHistory({
        marketId: target.marketId,
        adminUserId: input.createdByUserId ?? null,
        options: {},
      });

      const seededDetail = (await marketData.getMarketDetail(target.marketId)).data;
      const seededTarget = {
        ...target,
        detail: seededDetail,
        scope: getMarketPriceHistoryScope(seededDetail),
        grouped: (seededDetail.group_markets ?? []).length > 1,
      };
      const targetRng = createSeededRandom(
        `admin-event-activity:${parsed.batchId}:${seededTarget.scope.scopeId}`,
      );
      const betCount = randomInteger(
        parsed.betsPerEventMin,
        parsed.betsPerEventMax,
        targetRng,
      );
      const targetPlans = planTargetBets({
        target: seededTarget,
        users,
        betCount,
        parsed,
        rng: targetRng,
      });

      targets.push({ ...seededTarget, plannedBets: targetPlans.length, tradesCreated: 0 });
      plannedBets.push(...targetPlans);
    }

    const deposits = await createPlannedDeposits({
      plannedBets,
      parsed,
      adminUserId: input.adminUserId,
      ledger,
      walletRepository,
      platformActivityRepository,
    });
    const createdTrades: Array<{ target: ResolvedTarget; trade: MarketTradeActivityRecord }> = [];
    const tradeResults: Array<{
      id: string;
      marketId: string;
      userId: string;
      side: TradeSide;
      amount: number;
      createdAt: string;
      idempotent: boolean;
    }> = [];

    for (const bet of plannedBets) {
      try {
        const market = await loadMarketForBet(marketData, bet);
        const result = await placeLocalOrder({
          market,
          side: bet.side,
          action: "buy",
          amount: bet.amount,
          userId: bet.user.id,
          idempotencyKey: bet.idempotencyKey,
          createdAt: bet.createdAt,
          metadata: buildAdminSeedMetadata({
            adminUserId: input.adminUserId,
            batchId: parsed.batchId,
            publicActivity: parsed.publicActivity,
            scope: bet.target.scope,
          }),
          ledger,
          portfolioRepository,
        });

        if (!result.ok) {
          skipped.push({
            scopeId: bet.target.scope.scopeId,
            marketId: bet.marketId,
            userId: bet.user.id,
            reason: result.code,
          });
          continue;
        }

        tradeResults.push({
          id: result.trade.id,
          marketId: result.trade.marketId,
          userId: result.trade.userId,
          side: result.trade.side,
          amount: result.trade.stakeAmount ?? result.trade.amount,
          createdAt: result.trade.createdAt,
          idempotent: result.idempotent,
        });

        if (result.idempotent) {
          continue;
        }

        const activityTrade = await syncTradingMarketActivity({
          repository: marketActivityRepository,
          displayName: bet.user.displayName,
          result,
        });
        const tradeActivityRecord = activityTrade.trade ?? buildTradeActivityRecord({
          displayName: bet.user.displayName,
          result,
        });
        createdTrades.push({ target: bet.target, trade: tradeActivityRecord });

        await recordPublicTradeActivity({
          platformActivityRepository,
          publicActivity: parsed.publicActivity,
          displayName: bet.user.displayName,
          id: result.trade.id,
          amount: result.trade.stakeAmount ?? result.trade.amount,
          marketTitle: result.trade.marketTitle,
          createdAt: result.trade.createdAt,
        });

        const targetSummary = targets.find(
          (candidate) =>
            candidate.scope.scopeType === bet.target.scope.scopeType &&
            candidate.scope.scopeId === bet.target.scope.scopeId,
        );
        if (targetSummary) {
          targetSummary.tradesCreated += 1;
        }
      } catch (error) {
        if (error instanceof LedgerError && error.code === "INSUFFICIENT_LEDGER_BALANCE") {
          skipped.push({
            scopeId: bet.target.scope.scopeId,
            marketId: bet.marketId,
            userId: bet.user.id,
            reason: "insufficient_balance",
          });
          continue;
        }

        errors.push({
          scopeId: bet.target.scope.scopeId,
          marketId: bet.marketId,
          userId: bet.user.id,
          message: error instanceof Error ? error.message : "Trade seed failed.",
        });
      }
    }

    await saveTradeHistoryPoints({
      priceHistoryRepository,
      createdTrades,
      adminUserId: input.adminUserId,
      createdByUserId: input.createdByUserId ?? null,
      batchId: parsed.batchId,
      publicActivity: parsed.publicActivity,
    });

    const depositsCreated = deposits.filter((deposit) => !deposit.idempotent).length;
    const tradesCreated = createdTrades.length;

    return {
      batchId: parsed.batchId,
      targets: targets.map((target) => ({
        marketId: target.marketId,
        title: target.title,
        scope: target.scope,
        grouped: target.grouped,
        plannedBets: target.plannedBets,
        tradesCreated: target.tradesCreated,
      })),
      depositsCreated,
      tradesCreated,
      deposits,
      trades: tradeResults,
      skipped,
      errors,
      summary: {
        eventsProcessed: targets.length,
        plannedTrades: plannedBets.length,
        depositsCreated,
        tradesCreated,
        skipped: skipped.length,
        errors: errors.length,
      },
    };
  }

  return {
    seedEventActivity,
  };
}

export type AdminEventActivitySeedService = ReturnType<typeof buildAdminEventActivitySeedService>;

function parseSeedInput(input: AdminEventActivitySeedInput): ParsedInput {
  const now = Date.now();
  const startAt = parseOptionalDate(
    input.startAt,
    "startAt",
    new Date(now - 7 * 24 * 60 * 60 * 1000),
  );
  const endAt = parseOptionalDate(input.endAt, "endAt", new Date(now));

  if (endAt.getTime() < startAt.getTime()) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      "endAt must be after startAt.",
    );
  }

  const betsPerEventMin = parseInteger(input.betsPerEventMin, 8, "betsPerEventMin", 1, 200);
  const betsPerEventMax = parseInteger(input.betsPerEventMax, 24, "betsPerEventMax", 1, 200);
  if (betsPerEventMax < betsPerEventMin) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      "betsPerEventMax must be greater than or equal to betsPerEventMin.",
    );
  }

  const parsed = {
    batchId: parseBatchId(input.batchId),
    marketIds: parseStringList(input.marketIds).slice(0, 200),
    filters: parseFilters(input.filters),
    userIds: parseStringList(input.userIds).slice(0, 200),
    betsPerEventMin,
    betsPerEventMax,
    betAmountMin: parseMoney(input.betAmountMin, 5, "betAmountMin"),
    betAmountMax: parseMoney(input.betAmountMax, 150, "betAmountMax"),
    depositAmountMin: parseMoney(input.depositAmountMin, 50, "depositAmountMin"),
    depositAmountMax: parseMoney(input.depositAmountMax, 1200, "depositAmountMax"),
    depositBufferMultiplier: parseNumber(
      input.depositBufferMultiplier,
      1.35,
      "depositBufferMultiplier",
      1,
      10,
    ),
    startAt,
    endAt,
    publicActivity: input.publicActivity !== false,
    force: input.force === true,
  };

  if (parsed.userIds.length === 0) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      "userIds must contain at least one user.",
    );
  }

  if (parsed.marketIds.length === 0 && Number(parsed.filters.limit ?? 0) <= 0) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      "Provide marketIds or a positive filters.limit.",
    );
  }

  if (parsed.betAmountMax < parsed.betAmountMin) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      "betAmountMax must be greater than or equal to betAmountMin.",
    );
  }

  if (parsed.depositAmountMax < parsed.depositAmountMin) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      "depositAmountMax must be greater than or equal to depositAmountMin.",
    );
  }

  return parsed;
}

function parseBatchId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return randomUUID();
  }

  return value.trim().slice(0, 120);
}

function parseFilters(value: unknown): MarketListParams {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const limit = parseInteger(input.limit, 50, "filters.limit", 1, 200);
  const status =
    input.status === "live" ||
    input.status === "upcoming" ||
    input.status === "closed" ||
    input.status === "expired"
      ? input.status
      : "live";

  return {
    status,
    limit,
    sort: typeof input.sort === "string" ? input.sort : "popular",
    search: typeof input.search === "string" ? input.search : undefined,
    category: typeof input.category === "string" ? input.category : undefined,
    topic: typeof input.topic === "string" ? input.topic : undefined,
  };
}

function parseStringList(value: unknown) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  }

  if (typeof value === "string") {
    return [
      ...new Set(
        value
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  }

  return [];
}

function parseInteger(
  value: unknown,
  fallback: number,
  fieldName: string,
  min: number,
  max: number,
) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      `${fieldName} must be an integer between ${min} and ${max}.`,
    );
  }

  return parsed;
}

function parseMoney(value: unknown, fallback: number, fieldName: string) {
  return parseNumber(value, fallback, fieldName, 0.01, 1_000_000);
}

function parseNumber(
  value: unknown,
  fallback: number,
  fieldName: string,
  min: number,
  max: number,
) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      `${fieldName} must be a number between ${min} and ${max}.`,
    );
  }

  return parsed;
}

function parseOptionalDate(value: unknown, fieldName: string, fallback: Date) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      `${fieldName} must be an ISO date string.`,
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      `${fieldName} must be a valid ISO date string.`,
    );
  }

  return date;
}

async function loadUsers(auth: AuthService, userIds: string[]) {
  const users = await Promise.all(
    userIds.map(async (userId) => auth.repositories.users.findUserById(userId)),
  );
  const missing = users.findIndex((user) => !user);
  if (missing >= 0) {
    throw new AdminEventActivitySeedError(
      "INVALID_EVENT_ACTIVITY_SEED",
      `User ${userIds[missing]} was not found.`,
      404,
    );
  }

  return users.map((user) => ({
    id: user!.id,
    email: user!.email,
    emailVerified: user!.emailVerified,
    displayName: user!.displayName,
    role: user!.role,
    settings: user!.settings,
    createdAt: user!.createdAt,
    updatedAt: user!.updatedAt,
  }));
}

async function resolveTargets({
  marketData,
  parsed,
}: {
  marketData: MarketDataService;
  parsed: ParsedInput;
}) {
  const ids = parsed.marketIds.length > 0
    ? parsed.marketIds
    : (await marketData.listMarkets(parsed.filters)).data.map((market) => market.id);
  const targets: ResolvedTarget[] = [];
  const skipped: Array<{ scopeId?: string; marketId?: string; reason: string }> = [];
  const errors: Array<{ scopeId?: string; marketId?: string; message: string }> = [];
  const seenScopes = new Set<string>();

  for (const marketId of ids) {
    try {
      const detail = (await marketData.getMarketDetail(marketId)).data;
      const scope = getMarketPriceHistoryScope(detail);
      const scopeKey = `${scope.scopeType}:${scope.scopeId}`;

      if (seenScopes.has(scopeKey)) {
        skipped.push({ scopeId: scope.scopeId, marketId, reason: "duplicate_event_scope" });
        continue;
      }

      seenScopes.add(scopeKey);
      targets.push({
        marketId: detail.id,
        title: detail.event_title ?? detail.title,
        scope,
        detail,
        grouped: (detail.group_markets ?? []).length > 1,
      });
    } catch (error) {
      errors.push({
        marketId,
        message: error instanceof Error ? error.message : "Market lookup failed.",
      });
    }
  }

  return { targets, skipped, errors };
}

async function listExistingAdminSeedBatches(
  repository: MarketPriceHistoryRepository,
  scope: MarketPriceHistoryScope,
) {
  const points = await repository.listPoints({
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    source: "trade",
    limit: 200,
  });

  return [
    ...new Set(
      points
        .filter((point) => point.metadata.source === "admin_seed")
        .map((point) => point.metadata.batchId)
        .filter((batchId): batchId is string => typeof batchId === "string" && batchId.length > 0),
    ),
  ];
}

function planTargetBets({
  target,
  users,
  betCount,
  parsed,
  rng,
}: {
  target: ResolvedTarget;
  users: PublicUser[];
  betCount: number;
  parsed: ParsedInput;
  rng: () => number;
}) {
  const bets: PlannedBet[] = [];

  for (let index = 0; index < betCount; index += 1) {
    const user = users[(index + randomInteger(0, users.length - 1, rng)) % users.length];
    if (!user) {
      continue;
    }

    const selection = chooseMarketSelection(target.detail, rng);
    const createdAt = randomDateBetween(parsed.startAt, parsed.endAt, rng);
    const amount = randomMoney(parsed.betAmountMin, parsed.betAmountMax, rng);

    bets.push({
      target,
      user,
      index,
      marketId: selection.marketId,
      marketTitle: selection.marketTitle,
      side: selection.side,
      amount,
      createdAt,
      idempotencyKey: [
        "admin-seed",
        "event-activity",
        "trade",
        parsed.batchId,
        target.scope.scopeId,
        user.id,
        index,
      ].join(":"),
    });
  }

  return bets.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function buildTradeActivityRecord({
  displayName,
  result,
}: {
  displayName: string;
  result: {
    trade: {
      id: string;
      marketId: string;
      userId: string;
      side: TradeSide;
      action: "buy" | "sell";
      amount: number;
      stakeAmount?: number;
      price: number;
      shares: number;
      createdAt: string;
    };
  };
}): MarketTradeActivityRecord {
  return {
    id: result.trade.id,
    marketId: result.trade.marketId,
    userId: result.trade.userId,
    displayName,
    side: result.trade.side,
    action: result.trade.action,
    amount: result.trade.stakeAmount ?? result.trade.amount,
    price: result.trade.price,
    shares: result.trade.shares,
    createdAt: result.trade.createdAt,
  };
}

function chooseMarketSelection(detail: NormalizedMarketDetail, rng: () => number) {
  const groupMarkets = detail.group_markets ?? [];

  if (groupMarkets.length > 1) {
    const tradableGroupMarkets = groupMarkets.filter(isTradableGroupMarket);
    const groupMarket = chooseWeightedGroupMarket(
      tradableGroupMarkets.length > 0 ? tradableGroupMarkets : groupMarkets,
      rng,
    );
    const yesBias = clampProbability((groupMarket.yes_price ?? 0.5) + (rng() - 0.5) * 0.16);
    const side = rng() < Math.max(0.72, yesBias) ? "yes" : "no";

    return {
      marketId: groupMarket.id,
      marketTitle: groupMarket.title,
      side: side as TradeSide,
    };
  }

  const yesPrice = getBinaryPrice(detail, "yes") ?? 0.5;
  const noisyYes = clampProbability(yesPrice + (rng() - 0.5) * 0.14);
  const side = rng() < noisyYes ? "yes" : "no";

  return {
    marketId: detail.id,
    marketTitle: detail.title,
    side: side as TradeSide,
  };
}

function isTradableGroupMarket(market: NormalizedGroupMarket) {
  const endsAt = market.ends_at ? Date.parse(market.ends_at) : Number.NaN;

  return (
    market.active &&
    !market.closed &&
    !market.archived &&
    market.trading.accepting_orders !== false &&
    market.status !== "closed" &&
    market.status !== "expired" &&
    (!Number.isFinite(endsAt) || endsAt > Date.now())
  );
}

function chooseWeightedGroupMarket(groupMarkets: NormalizedGroupMarket[], rng: () => number) {
  const weighted = groupMarkets.map((market) => ({
    market,
    weight: Math.max(0.01, (market.yes_price ?? 1 / groupMarkets.length) + (rng() - 0.5) * 0.04),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rng() * total;

  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.market;
    }
  }

  return weighted.at(-1)?.market ?? groupMarkets[0]!;
}

function getBinaryPrice(detail: NormalizedMarketDetail, side: TradeSide) {
  const outcome = detail.outcomes.find((candidate) => candidate.name.trim().toLowerCase() === side);
  if (outcome?.price !== null && outcome?.price !== undefined) {
    return outcome.price;
  }

  return side === "yes" ? detail.prices.yes : detail.prices.no;
}

async function createPlannedDeposits({
  plannedBets,
  parsed,
  adminUserId,
  ledger,
  walletRepository,
  platformActivityRepository,
}: {
  plannedBets: PlannedBet[];
  parsed: ParsedInput;
  adminUserId: string;
  ledger: LedgerService;
  walletRepository: WalletRepository;
  platformActivityRepository: PlatformActivityRepository;
}) {
  const spendByUser = new Map<string, { user: PublicUser; total: number; firstBetAt: string }>();
  for (const bet of plannedBets) {
    const current = spendByUser.get(bet.user.id);
    spendByUser.set(bet.user.id, {
      user: bet.user,
      total: roundMoney((current?.total ?? 0) + bet.amount),
      firstBetAt:
        current && current.firstBetAt < bet.createdAt ? current.firstBetAt : bet.createdAt,
    });
  }

  const deposits: Array<{
    userId: string;
    amount: number;
    ledgerEntry: LedgerEntry;
    depositEvent: WalletDepositEvent;
    idempotent: boolean;
  }> = [];
  let index = 0;

  for (const { user, total, firstBetAt } of spendByUser.values()) {
    const rng = createSeededRandom(`admin-event-activity:${parsed.batchId}:deposit:${user.id}`);
    const randomFloor = randomMoney(parsed.depositAmountMin, parsed.depositAmountMax, rng);
    const amount = roundMoney(
      Math.max(randomFloor, total * parsed.depositBufferMultiplier),
    );
    const createdAt = new Date(
      Math.max(parsed.startAt.getTime(), Date.parse(firstBetAt) - 60_000),
    ).toISOString();
    const wallet = await ensureAdminSeedWallet(walletRepository, user.id);
    const depositEventId = uuidFromHash(`admin-seed:event-activity:deposit-event:${parsed.batchId}:${user.id}`);
    const txHash = `admin_seed_${createHash("sha256")
      .update(`event-activity:${parsed.batchId}:${user.id}`)
      .digest("hex")}`;
    const metadata = buildAdminSeedMetadata({
      adminUserId,
      batchId: parsed.batchId,
      publicActivity: parsed.publicActivity,
      scope: {
        scopeType: "event",
        scopeId: "batch",
        marketExternalId: "batch",
      },
    });
    const ledgerResult = await ledger.createEntry({
      userId: user.id,
      walletId: null,
      asset: WALLET_ASSET,
      entryType: "credit",
      amount,
      reason: "admin_seed_deposit",
      referenceType: "wallet_deposit_event",
      referenceId: depositEventId,
      idempotencyKey: [
        "admin-seed",
        "event-activity",
        "deposit",
        parsed.batchId,
        "batch",
        user.id,
        0,
      ].join(":"),
      metadata: {
        ...metadata,
        plannedTradeSpend: total,
        depositBufferMultiplier: parsed.depositBufferMultiplier,
        txHash,
        provider: "admin_seed",
      },
      createdAt,
    });
    const depositEvent: WalletDepositEvent = {
      id: depositEventId,
      txHash,
      logIndex: String(index),
      walletId: wallet.id,
      userId: user.id,
      amount,
      asset: WALLET_ASSET,
      network: WALLET_NETWORK,
      confirmations: 1,
      status: "credited",
      provider: "admin_seed",
      recipientAddress: wallet.address,
      eventFingerprint: createHash("sha256").update(`${txHash}:${index}`).digest("hex"),
      rawPayload: {
        source: "admin_seed",
        metadata,
      },
      rejectionReason: null,
      creditedLedgerEntryId: ledgerResult.entry.id,
      createdAt,
      updatedAt: createdAt,
    };
    const savedDepositEvent = await walletRepository.saveDepositEvent(depositEvent);
    if (parsed.publicActivity && platformActivityRepository.record) {
      await platformActivityRepository.record({
        id: savedDepositEvent.id,
        type: "deposit",
        amount,
        asset: WALLET_ASSET,
        marketTitle: null,
        createdAt,
        displayName: user.displayName,
      });
    }

    deposits.push({
      userId: user.id,
      amount,
      ledgerEntry: ledgerResult.entry,
      depositEvent: savedDepositEvent,
      idempotent: ledgerResult.idempotent,
    });
    index += 1;
  }

  return deposits;
}

async function ensureAdminSeedWallet(repository: WalletRepository, userId: string): Promise<Wallet> {
  const existing = await repository.findWallet({
    userId,
    asset: WALLET_ASSET,
    network: WALLET_NETWORK,
    provider: WALLET_PROVIDER,
  });

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  return repository.saveWallet({
    id: randomUUID(),
    userId,
    asset: WALLET_ASSET,
    network: WALLET_NETWORK,
    address: buildSyntheticAddress(userId),
    status: "active",
    provider: WALLET_PROVIDER,
    createdAt: now,
    updatedAt: now,
  });
}

async function loadMarketForBet(marketData: MarketDataService, bet: PlannedBet) {
  const detail = (await marketData.getMarketDetail(bet.marketId)).data;
  const groupMarket = detail.group_markets.find((market) => market.id === bet.marketId);

  return groupMarket ? applyGroupMarketPricesToDetail(detail, groupMarket) : detail;
}

function applyGroupMarketPricesToDetail(
  detail: NormalizedMarketDetail,
  groupMarket: NormalizedGroupMarket,
): NormalizedMarketDetail {
  const yes = groupMarket.yes_price ?? getBinaryPrice(detail, "yes") ?? 0.5;
  const no = groupMarket.no_price ?? clampProbability(1 - yes);
  const outcomes = detail.outcomes.length > 0
    ? detail.outcomes.map((outcome, index) => {
        const normalized = outcome.name.trim().toLowerCase();
        const price = normalized === "no" || index === 1 ? no : yes;

        return {
          ...outcome,
          price,
          probability: price,
          price_cents: Math.round(price * 100),
        };
      })
    : [
        { name: "Yes", price: yes, probability: yes, price_cents: Math.round(yes * 100), clobTokenId: null },
        { name: "No", price: no, probability: no, price_cents: Math.round(no * 100), clobTokenId: null },
      ];

  return {
    ...detail,
    id: groupMarket.id,
    title: groupMarket.title,
    outcomes,
    prices: {
      ...detail.prices,
      yes,
      no,
      last_trade: yes,
    },
    volume: groupMarket.volume,
    liquidity: groupMarket.liquidity,
    volume_detail: {
      volume: groupMarket.volume,
      liquidity: groupMarket.liquidity,
    },
  };
}

async function saveTradeHistoryPoints({
  priceHistoryRepository,
  createdTrades,
  adminUserId,
  createdByUserId,
  batchId,
  publicActivity,
}: {
  priceHistoryRepository: MarketPriceHistoryRepository;
  createdTrades: Array<{ target: ResolvedTarget; trade: MarketTradeActivityRecord }>;
  adminUserId: string;
  createdByUserId: string | null;
  batchId: string;
  publicActivity: boolean;
}) {
  const tradesByScope = new Map<string, Array<{ target: ResolvedTarget; trade: MarketTradeActivityRecord }>>();

  for (const item of createdTrades) {
    const key = `${item.target.scope.scopeType}:${item.target.scope.scopeId}`;
    tradesByScope.set(key, [...(tradesByScope.get(key) ?? []), item]);
  }

  for (const items of tradesByScope.values()) {
    const target = items[0]?.target;
    if (!target) {
      continue;
    }

    const history = buildHistoryFromCreatedTrades(target, items.map((item) => item.trade));
    const points = history.slice(1).map((point, index) =>
      mapTradeHistoryPoint({
        point,
        scope: target.scope,
        adminUserId,
        createdByUserId,
        batchId,
        publicActivity,
        sequence: index,
      }),
    );

    if (points.length > 0) {
      await priceHistoryRepository.savePoints(points);
    }
  }
}

function buildHistoryFromCreatedTrades(
  target: ResolvedTarget,
  trades: MarketTradeActivityRecord[],
) {
  const groupMarkets = target.detail.group_markets ?? [];

  if (groupMarkets.length > 1) {
    const tradesByMarketId = new Map<string, MarketTradeActivityRecord[]>();
    for (const trade of trades) {
      tradesByMarketId.set(trade.marketId, [...(tradesByMarketId.get(trade.marketId) ?? []), trade]);
    }

    return buildGroupedMarketHistory(groupMarkets, tradesByMarketId);
  }

  return buildOwnMarketHistory(target.detail, trades);
}

function mapTradeHistoryPoint({
  point,
  scope,
  adminUserId,
  createdByUserId,
  batchId,
  publicActivity,
  sequence,
}: {
  point: MarketPriceHistoryPoint;
  scope: MarketPriceHistoryScope;
  adminUserId: string;
  createdByUserId: string | null;
  batchId: string;
  publicActivity: boolean;
  sequence: number;
}): SaveMarketPriceHistoryPointInput {
  return {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    marketExternalId: scope.marketExternalId,
    capturedAt: point.timestamp,
    outcomes: point.outcomes ?? [],
    yes: point.yes,
    no: point.no,
    volume: point.volume,
    liquidity: point.liquidity,
    source: "trade",
    createdBy: createdByUserId,
    metadata: {
      source: "admin_seed",
      batchId,
      adminUserId,
      publicActivity,
      sequence,
    },
  };
}

async function recordPublicTradeActivity({
  platformActivityRepository,
  publicActivity,
  displayName,
  id,
  amount,
  marketTitle,
  createdAt,
}: {
  platformActivityRepository: PlatformActivityRepository;
  publicActivity: boolean;
  displayName: string;
  id: string;
  amount: number;
  marketTitle: string;
  createdAt: string;
}) {
  if (!publicActivity || !platformActivityRepository.record) {
    return;
  }

  await platformActivityRepository.record({
    id,
    type: "trade",
    amount,
    asset: WALLET_ASSET,
    marketTitle,
    createdAt,
    displayName,
  });
}

function buildAdminSeedMetadata({
  adminUserId,
  batchId,
  publicActivity,
  scope,
}: {
  adminUserId: string;
  batchId: string;
  publicActivity: boolean;
  scope: MarketPriceHistoryScope;
}) {
  return {
    source: "admin_seed",
    batchId,
    adminUserId,
    publicActivity,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
  };
}

function createSeededRandom(seed: string) {
  const hash = createHash("sha256").update(seed).digest();
  let state = hash.readUInt32BE(0) || 0x9e3779b9;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

function randomInteger(min: number, max: number, rng: () => number) {
  return Math.floor(min + rng() * (max - min + 1));
}

function randomMoney(min: number, max: number, rng: () => number) {
  return roundMoney(min + rng() * (max - min));
}

function randomDateBetween(startAt: Date, endAt: Date, rng: () => number) {
  const timestamp = startAt.getTime() + (endAt.getTime() - startAt.getTime()) * rng();
  return new Date(timestamp).toISOString();
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampProbability(value: number) {
  return Math.min(1, Math.max(0, value));
}

function buildSyntheticAddress(userId: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digest = createHash("sha256").update(`admin_seed:${userId}`).digest();
  let body = "";

  for (let index = 0; index < 33; index += 1) {
    body += alphabet[digest[index % digest.length] % alphabet.length];
  }

  return `T${body}`;
}

function uuidFromHash(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
