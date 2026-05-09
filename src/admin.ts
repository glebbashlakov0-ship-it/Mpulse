import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.js";
import { toIsoString } from "./utils.js";
import {
  coreFields,
  type PublicWithdrawalRequest,
  type WalletRepository,
  type WithdrawalRequestStatus,
} from "./wallets.js";

export const adminMode = "wallet_review_only" as const;

export const marketModerationReasons = [
  "legal_risk",
  "compliance",
  "sensitive_topic",
  "manual_review",
] as const;

export type MarketModerationReason = (typeof marketModerationReasons)[number];

export type AdminMarketVisibilityRule = {
  id: string;
  marketId: string;
  action: "hide";
  reason: MarketModerationReason;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminRepository = {
  hideMarket(input: {
    marketId: string;
    reason: MarketModerationReason;
    adminUserId: string;
  }): Promise<AdminMarketVisibilityRule>;
  unhideMarket(input: {
    marketId: string;
    adminUserId: string;
  }): Promise<AdminMarketVisibilityRule | null>;
  listHiddenMarkets(): Promise<AdminMarketVisibilityRule[]>;
};

export class AdminError extends Error {
  constructor(
    public readonly code:
      | "INVALID_MARKET_MODERATION_REASON"
      | "INVALID_MARKET_ID"
      | "WITHDRAWAL_REQUEST_NOT_FOUND",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export class MemoryAdminRepository implements AdminRepository {
  private readonly marketRulesByMarketId = new Map<string, AdminMarketVisibilityRule>();

  async hideMarket(input: {
    marketId: string;
    reason: MarketModerationReason;
    adminUserId: string;
  }) {
    const now = new Date().toISOString();
    const existing = this.marketRulesByMarketId.get(input.marketId);
    const rule: AdminMarketVisibilityRule = {
      id: existing?.id ?? randomUUID(),
      marketId: input.marketId,
      action: "hide",
      reason: input.reason,
      active: true,
      createdBy: existing?.createdBy ?? input.adminUserId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.marketRulesByMarketId.set(input.marketId, rule);
    return rule;
  }

  async unhideMarket(input: { marketId: string; adminUserId: string }) {
    const existing = this.marketRulesByMarketId.get(input.marketId);
    if (!existing) {
      return null;
    }

    const rule = {
      ...existing,
      active: false,
      updatedAt: new Date().toISOString(),
    };
    this.marketRulesByMarketId.set(input.marketId, rule);
    return rule;
  }

  async listHiddenMarkets() {
    return [...this.marketRulesByMarketId.values()]
      .filter((rule) => rule.active)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

type AdminMarketVisibilityRuleRow = {
  id: string;
  source: string;
  market_external_id: string;
  action: "hide";
  reason: MarketModerationReason;
  active: boolean;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export class PostgresAdminRepository implements AdminRepository {
  constructor(private readonly db: Queryable) {}

  async hideMarket(input: {
    marketId: string;
    reason: MarketModerationReason;
    adminUserId: string;
  }) {
    const result = await this.db.query<AdminMarketVisibilityRuleRow>(
      `insert into admin_market_visibility_rules (
         source, market_external_id, action, reason, active, created_by, created_at, updated_at
       )
       values ('polymarket', $1, 'hide', $2, true, $3, now(), now())
       on conflict (source, market_external_id) do update set
         action = excluded.action,
         reason = excluded.reason,
         active = excluded.active,
         updated_at = excluded.updated_at
       returning id, source, market_external_id, action, reason, active, created_by, created_at, updated_at`,
      [input.marketId, input.reason, input.adminUserId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Admin market visibility rule insert returned no row.");
    }

    return mapAdminMarketVisibilityRule(row);
  }

  async unhideMarket(input: { marketId: string; adminUserId: string }) {
    const result = await this.db.query<AdminMarketVisibilityRuleRow>(
      `update admin_market_visibility_rules
       set active = false, updated_at = now()
       where source = 'polymarket' and market_external_id = $1
       returning id, source, market_external_id, action, reason, active, created_by, created_at, updated_at`,
      [input.marketId],
    );

    const row = result.rows[0];
    return row ? mapAdminMarketVisibilityRule(row) : null;
  }

  async listHiddenMarkets() {
    const result = await this.db.query<AdminMarketVisibilityRuleRow>(
      `select id, source, market_external_id, action, reason, active, created_by, created_at, updated_at
       from admin_market_visibility_rules
       where source = 'polymarket' and active = true
       order by updated_at desc`,
    );

    return result.rows.map(mapAdminMarketVisibilityRule);
  }
}

function mapAdminMarketVisibilityRule(row: AdminMarketVisibilityRuleRow): AdminMarketVisibilityRule {
  return {
    id: row.id,
    marketId: row.market_external_id,
    action: row.action,
    reason: row.reason,
    active: row.active,
    createdBy: row.created_by ?? "unknown",
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export function buildAdminService({
  repository,
  walletRepository,
}: {
  repository: AdminRepository;
  walletRepository: WalletRepository;
}) {
  async function listWithdrawalRequests(limit = 100) {
    return {
      withdrawalRequests: (await walletRepository.listAllWithdrawalRequests(limit)).map(
        toAdminWithdrawalRequest,
      ),
      ...manualReviewFields(),
    };
  }

  async function reviewWithdrawal(input: {
    id: string;
    status: Extract<WithdrawalRequestStatus, "rejected" | "approved_for_review">;
  }) {
    const withdrawalRequest = await walletRepository.updateWithdrawalRequestStatus({
      id: validateId(input.id),
      status: input.status,
    });

    if (!withdrawalRequest) {
      throw new AdminError(
        "WITHDRAWAL_REQUEST_NOT_FOUND",
        "Withdrawal request was not found.",
        404,
      );
    }

    return {
      withdrawalRequest: toAdminWithdrawalRequest(withdrawalRequest),
      ledgerMutationBlocked: true,
      ...manualReviewFields(),
    };
  }

  async function hideMarket(input: {
    marketId: string;
    reason: unknown;
    adminUserId: string;
  }) {
    const reason = validateMarketModerationReason(input.reason);
    const rule = await repository.hideMarket({
      marketId: validateId(input.marketId),
      reason,
      adminUserId: input.adminUserId,
    });

    return {
      rule,
      hiddenMarkets: await repository.listHiddenMarkets(),
      ...manualReviewFields(),
    };
  }

  async function unhideMarket(input: { marketId: string; adminUserId: string }) {
    const rule = await repository.unhideMarket({
      marketId: validateId(input.marketId),
      adminUserId: input.adminUserId,
    });

    return {
      rule,
      hiddenMarkets: await repository.listHiddenMarkets(),
      ...manualReviewFields(),
    };
  }

  return {
    repository,
    listWithdrawalRequests,
    reviewWithdrawal,
    hideMarket,
    unhideMarket,
    listHiddenMarkets: () => repository.listHiddenMarkets(),
  };
}

export type AdminService = ReturnType<typeof buildAdminService>;

function manualReviewFields() {
  return {
    ...coreFields(),
    realTransferBlocked: true as const,
    mode: adminMode,
  };
}

function toAdminWithdrawalRequest(
  request: PublicWithdrawalRequest,
): PublicWithdrawalRequest & {
  realTransferBlocked: true;
  mode: typeof adminMode;
} {
  return {
    ...request,
    realTransferBlocked: true,
    mode: adminMode,
  };
}

function validateMarketModerationReason(value: unknown): MarketModerationReason {
  if (
    typeof value === "string" &&
    (marketModerationReasons as readonly string[]).includes(value)
  ) {
    return value as MarketModerationReason;
  }

  throw new AdminError(
    "INVALID_MARKET_MODERATION_REASON",
    "Market hide reason must be legal_risk, compliance, sensitive_topic, or manual_review.",
  );
}

function validateId(value: string) {
  const id = value.trim();
  if (!id) {
    throw new AdminError("INVALID_MARKET_ID", "A non-empty id is required.");
  }

  return id;
}
