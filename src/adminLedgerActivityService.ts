import { createHash, randomUUID } from "node:crypto";
import { LedgerError, type LedgerEntry, type LedgerService } from "./ledger.js";
import type { PlatformActivityRepository } from "./platformActivity.js";
import {
  WALLET_ASSET,
  WALLET_NETWORK,
  WALLET_PROVIDER,
  type Wallet,
  type WalletDepositEvent,
  type WalletRepository,
} from "./wallets.js";

export type AdminLedgerSeedKind = "deposit" | "payment";

export type AdminLedgerSeedActivityInput = {
  userIds?: unknown;
  kind?: unknown;
  amountMin?: unknown;
  amountMax?: unknown;
  count?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  publicActivity?: unknown;
};

export class AdminLedgerActivityError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ADMIN_LEDGER_ACTIVITY"
      | "ADMIN_LEDGER_ACTIVITY_UNAVAILABLE",
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function buildAdminLedgerActivityService({
  ledger,
  walletRepository,
  platformActivityRepository,
}: {
  ledger: LedgerService;
  walletRepository: WalletRepository;
  platformActivityRepository: PlatformActivityRepository;
}) {
  async function seedActivity(input: {
    body: AdminLedgerSeedActivityInput;
    adminUserId: string;
  }) {
    const parsed = parseSeedInput(input.body);
    const created: Array<{
      userId: string;
      ledgerEntry: LedgerEntry;
      depositEvent: WalletDepositEvent | null;
    }> = [];
    const skipped: Array<{ userId: string; reason: string }> = [];
    const errors: Array<{ userId: string; message: string }> = [];
    const batchId = randomUUID();

    for (let index = 0; index < parsed.count; index += 1) {
      const userId = parsed.userIds[index % parsed.userIds.length];
      if (!userId) {
        continue;
      }

      const amount = randomAmount(parsed.amountMin, parsed.amountMax);
      const createdAt = interpolateDate(parsed.startAt, parsed.endAt, index, parsed.count);

      try {
        if (parsed.kind === "deposit") {
          const wallet = await ensureAdminSeedWallet(walletRepository, userId);
          const depositEventId = randomUUID();
          const txHash = `admin_seed_${randomUUID().replace(/-/g, "")}`;
          const metadata = buildAdminSeedMetadata(input.adminUserId, parsed.publicActivity, batchId);
          const ledgerResult = await ledger.createEntry({
            userId,
            walletId: wallet.id,
            asset: WALLET_ASSET,
            entryType: "credit",
            amount,
            reason: "admin_seed_deposit",
            referenceType: "wallet_deposit_event",
            referenceId: depositEventId,
            idempotencyKey: `admin-seed:deposit:${batchId}:${index}`,
            metadata: {
              ...metadata,
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
            userId,
            amount,
            asset: WALLET_ASSET,
            network: WALLET_NETWORK,
            confirmations: 1,
            status: "credited",
            provider: "admin_seed",
            recipientAddress: wallet.address,
            eventFingerprint: buildDepositFingerprint(txHash, index),
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

          created.push({
            userId,
            ledgerEntry: ledgerResult.entry,
            depositEvent: savedDepositEvent,
          });
          await recordPublicActivity({
            platformActivityRepository,
            publicActivity: parsed.publicActivity,
            id: savedDepositEvent.id,
            type: "deposit",
            userId,
            amount,
            createdAt,
          });
        } else {
          const metadata = buildAdminSeedMetadata(input.adminUserId, parsed.publicActivity, batchId);
          const ledgerResult = await ledger.createEntry({
            userId,
            walletId: null,
            asset: WALLET_ASSET,
            entryType: "debit",
            amount,
            reason: "admin_seed_payment",
            referenceType: "admin_seed_payment",
            referenceId: batchId,
            idempotencyKey: `admin-seed:payment:${batchId}:${index}`,
            metadata,
            createdAt,
          });

          created.push({
            userId,
            ledgerEntry: ledgerResult.entry,
            depositEvent: null,
          });
          await recordPublicActivity({
            platformActivityRepository,
            publicActivity: parsed.publicActivity,
            id: ledgerResult.entry.id,
            type: "payment",
            userId,
            amount,
            createdAt,
          });
        }
      } catch (error) {
        if (
          parsed.kind === "payment" &&
          error instanceof LedgerError &&
          error.code === "INSUFFICIENT_LEDGER_BALANCE"
        ) {
          skipped.push({ userId, reason: "insufficient_balance" });
          continue;
        }

        errors.push({
          userId,
          message: error instanceof Error ? error.message : "Ledger seed failed.",
        });
      }
    }

    return {
      batchId,
      kind: parsed.kind,
      created,
      skipped,
      errors,
      summary: {
        requested: parsed.count,
        created: created.length,
        skipped: skipped.length,
        errors: errors.length,
      },
    };
  }

  return {
    seedActivity,
  };
}

export type AdminLedgerActivityService = ReturnType<typeof buildAdminLedgerActivityService>;

function parseSeedInput(input: AdminLedgerSeedActivityInput) {
  const userIds = Array.isArray(input.userIds)
    ? input.userIds.map((userId) => String(userId).trim()).filter(Boolean)
    : [];
  if (userIds.length === 0 || userIds.length > 100) {
    throw new AdminLedgerActivityError(
      "INVALID_ADMIN_LEDGER_ACTIVITY",
      "userIds must contain between 1 and 100 users.",
    );
  }

  const kind = input.kind === "deposit" || input.kind === "payment" ? input.kind : null;
  if (!kind) {
    throw new AdminLedgerActivityError(
      "INVALID_ADMIN_LEDGER_ACTIVITY",
      "kind must be deposit or payment.",
    );
  }

  const amountMin = Number(input.amountMin);
  const amountMax = Number(input.amountMax);
  if (
    !Number.isFinite(amountMin) ||
    !Number.isFinite(amountMax) ||
    amountMin <= 0 ||
    amountMax < amountMin
  ) {
    throw new AdminLedgerActivityError(
      "INVALID_ADMIN_LEDGER_ACTIVITY",
      "amountMin and amountMax must be positive numbers with amountMax >= amountMin.",
    );
  }

  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    throw new AdminLedgerActivityError(
      "INVALID_ADMIN_LEDGER_ACTIVITY",
      "count must be an integer between 1 and 500.",
    );
  }

  const startAt = parseDate(input.startAt, "startAt");
  const endAt = parseDate(input.endAt, "endAt");
  if (endAt.getTime() < startAt.getTime()) {
    throw new AdminLedgerActivityError(
      "INVALID_ADMIN_LEDGER_ACTIVITY",
      "endAt must be after startAt.",
    );
  }

  return {
    userIds,
    kind,
    amountMin,
    amountMax,
    count,
    startAt,
    endAt,
    publicActivity: input.publicActivity === true,
  };
}

function parseDate(value: unknown, fieldName: string) {
  if (typeof value !== "string") {
    throw new AdminLedgerActivityError(
      "INVALID_ADMIN_LEDGER_ACTIVITY",
      `${fieldName} must be an ISO date string.`,
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AdminLedgerActivityError(
      "INVALID_ADMIN_LEDGER_ACTIVITY",
      `${fieldName} must be a valid ISO date string.`,
    );
  }

  return date;
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

function buildSyntheticAddress(userId: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digest = createHash("sha256").update(`admin_seed:${userId}`).digest();
  let body = "";

  for (let index = 0; index < 33; index += 1) {
    body += alphabet[digest[index % digest.length] % alphabet.length];
  }

  return `T${body}`;
}

function buildAdminSeedMetadata(adminUserId: string, publicActivity: boolean, batchId: string) {
  return {
    source: "admin_seed",
    publicActivity,
    adminUserId,
    batchId,
  };
}

function randomAmount(min: number, max: number) {
  const value = min + Math.random() * (max - min);
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function interpolateDate(startAt: Date, endAt: Date, index: number, count: number) {
  const progress = count <= 1 ? 1 : index / (count - 1);
  const timestamp = startAt.getTime() + (endAt.getTime() - startAt.getTime()) * progress;

  return new Date(timestamp).toISOString();
}

function buildDepositFingerprint(txHash: string, index: number) {
  return createHash("sha256").update(`${txHash}:${index}`).digest("hex");
}

async function recordPublicActivity({
  platformActivityRepository,
  publicActivity,
  id,
  type,
  userId,
  amount,
  createdAt,
}: {
  platformActivityRepository: PlatformActivityRepository;
  publicActivity: boolean;
  id: string;
  type: "deposit" | "payment";
  userId: string;
  amount: number;
  createdAt: string;
}) {
  if (!publicActivity || !platformActivityRepository.record) {
    return;
  }

  await platformActivityRepository.record({
    id,
    type,
    amount,
    asset: WALLET_ASSET,
    marketTitle: null,
    createdAt,
    displayName: userId,
  });
}
