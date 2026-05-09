import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { buildLedgerService, MemoryLedgerRepository } from "./ledger.js";
import {
  buildWalletService,
  MemoryWalletRepository,
  WalletProviderAdapter,
  validateTronAddressShape,
  WalletError,
  WALLET_REVIEW_MODE,
} from "./wallets.js";

const VALID_TRON_ADDRESS = "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK";

function buildTestWalletService() {
  const ledger = buildLedgerService(new MemoryLedgerRepository());
  return buildWalletService({
    repository: new MemoryWalletRepository(),
    provider: new WalletProviderAdapter(),
    ledger,
    depositMinConfirmations: 2,
    now: () => new Date("2026-04-29T12:00:00.000Z"),
    getComplianceEligibility: async () => ({ canUseRealMoney: false }),
  });
}

test("wallet service creates and reuses a wallet", async () => {
  const wallets = buildTestWalletService();

  const first = await wallets.getOrCreateWallet("wallet-user");
  const second = await wallets.getOrCreateWallet("wallet-user");

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.wallet.id, first.wallet.id);
  assert.equal(first.wallet.asset, "USDT");
  assert.equal(first.wallet.network, "TRON");
  assert.equal(first.wallet.provider, "internal_wallet");
  assert.equal(validateTronAddressShape(first.wallet.address), true);
  assert.equal(first.mode, WALLET_REVIEW_MODE);
});

test("wallet service validates TRON address shape", () => {
  assert.equal(validateTronAddressShape(VALID_TRON_ADDRESS), true);
  assert.equal(validateTronAddressShape("0Q7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK"), false);
  assert.equal(validateTronAddressShape("TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhi"), false);
});

test("deposit intent rejects invalid amount", async () => {
  const wallets = buildTestWalletService();

  await assert.rejects(
    () =>
      wallets.createDepositIntent({
        userId: "deposit-user",
        body: {
          expectedAmount: 0,
        },
      }),
    /Amount must be greater than zero/,
  );
});

test("deposit intent creates a reusable wallet payment instruction", async () => {
  const wallets = buildTestWalletService();

  const result = await wallets.createDepositIntent({
    userId: "deposit-create-user",
    body: {
      expectedAmount: 42,
      reference: "local-ref",
    },
  });
  const wallet = await wallets.getOrCreateWallet("deposit-create-user");

  assert.equal(result.depositIntent.expectedAmount, 42);
  assert.equal(result.depositIntent.status, "waiting");
  assert.equal(result.depositIntent.reference, "local-ref");
  assert.equal(result.depositIntent.walletId, wallet.wallet.id);
  assert.equal(result.depositIntent.address, wallet.wallet.address);
  assert.equal(wallet.created, false);
});

test("withdrawal request idempotency reuses the existing withdrawal request", async () => {
  const wallets = buildTestWalletService();
  const body = {
    asset: "USDT",
    network: "TRON",
    destinationAddress: VALID_TRON_ADDRESS,
    amount: 25,
    idempotencyKey: "withdrawal-same-key",
    manualReview: true,
  };

  const first = await wallets.createWithdrawalRequest({
    userId: "withdrawal-user",
    body,
  });
  const second = await wallets.createWithdrawalRequest({
    userId: "withdrawal-user",
    body,
  });
  const list = await wallets.listWithdrawalRequests("withdrawal-user");

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.withdrawalRequest.id, first.withdrawalRequest.id);
  assert.equal(second.withdrawalRequest.status, "pending_review");
  assert.equal(second.compliance.realTransferBlocked, true);
  assert.equal(second.compliance.reason, "TRANSFERS_UNAVAILABLE");
  assert.equal(list.withdrawalRequests.length, 1);
});

test("withdrawal idempotency rejects mismatched payload reuse", async () => {
  const wallets = buildTestWalletService();

  await wallets.createWithdrawalRequest({
    userId: "withdrawal-mismatch-user",
    body: {
      asset: "USDT",
      network: "TRON",
      destinationAddress: VALID_TRON_ADDRESS,
      amount: 25,
      idempotencyKey: "withdrawal-mismatch-key",
      manualReview: true,
    },
  });

  await assert.rejects(
    () =>
      wallets.createWithdrawalRequest({
        userId: "withdrawal-mismatch-user",
        body: {
          asset: "USDT",
          network: "TRON",
          destinationAddress: VALID_TRON_ADDRESS,
          amount: 26,
          idempotencyKey: "withdrawal-mismatch-key",
          manualReview: true,
        },
      }),
    /already used for a different withdrawal request/,
  );
});

test("frontend cannot set withdrawal status to approved", async () => {
  const wallets = buildTestWalletService();

  await assert.rejects(
    () =>
      wallets.createWithdrawalRequest({
        userId: "approval-user",
        body: {
          destinationAddress: VALID_TRON_ADDRESS,
          amount: 25,
          idempotencyKey: "withdrawal-approved",
          manualReview: true,
          status: "approved",
        },
      }),
    /cannot be set by this API/,
  );
});

test("local deposit webhook records and idempotently credits a confirmed wallet deposit", async () => {
  const wallets = buildTestWalletService();
  const wallet = await wallets.getOrCreateWallet("deposit-webhook-user");
  const body = {
    txHash: "ABC123",
    logIndex: "0",
    provider: "internal_wallet",
    recipientAddress: wallet.wallet.address,
    amount: 10,
    asset: "USDT",
    network: "TRON",
    confirmations: 2,
  };

  const first = await wallets.receiveLocalWebhook(body);
  const second = await wallets.receiveLocalWebhook(body);
  const deposits = await wallets.listDeposits("deposit-webhook-user");

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.depositEvent.status, "credited");
  assert.equal(second.depositEvent.id, first.depositEvent.id);
  assert.equal(second.ledgerCredit, null);
  assert.equal(deposits.depositEvents.length, 1);
  assert.equal(deposits.depositEvents[0]?.status, "credited");
});

test("local deposit webhook flags same tx/log with a different payload as manual review", async () => {
  const wallets = buildTestWalletService();
  const wallet = await wallets.getOrCreateWallet("deposit-fingerprint-user");
  const body = {
    txHash: "fingerprint-tx",
    logIndex: "0",
    provider: "internal_wallet",
    recipientAddress: wallet.wallet.address,
    amount: 10,
    asset: "USDT",
    network: "TRON",
    confirmations: 2,
  };

  const first = await wallets.receiveLocalWebhook(body);
  const mismatch = await wallets.receiveLocalWebhook({
    ...body,
    amount: 11,
  });

  assert.equal(first.depositEvent.status, "credited");
  assert.equal(mismatch.conflict, true);
  assert.equal(mismatch.depositEvent.status, "manual_review");
  assert.equal(mismatch.depositEvent.rejectionReason, "IDEMPOTENCY_PAYLOAD_MISMATCH");
  assert.equal(mismatch.ledgerCredit, null);
  assert.equal(mismatch.creditBlockedReason, "IDEMPOTENCY_PAYLOAD_MISMATCH");
  assert.deepEqual(mismatch.auditEvents, ["wallet.deposit_rejected"]);
});

test("local deposit webhook accepts a harmless replay for a legacy md5 fingerprint row", async () => {
  const wallets = buildTestWalletService();
  const wallet = await wallets.getOrCreateWallet("deposit-legacy-fingerprint-user");
  const body = {
    txHash: "legacy-fingerprint-tx",
    logIndex: "0",
    provider: "internal_wallet",
    recipientAddress: wallet.wallet.address,
    amount: 10,
    asset: "USDT",
    network: "TRON",
    confirmations: 2,
  };
  const eventId = randomUUID();

  await wallets.repository.saveDepositEvent({
    id: eventId,
    txHash: body.txHash,
    logIndex: body.logIndex,
    walletId: wallet.wallet.id,
    userId: wallet.wallet.userId,
    amount: body.amount,
    asset: "USDT",
    network: "TRON",
    confirmations: body.confirmations,
    status: "credited",
    provider: body.provider,
    recipientAddress: body.recipientAddress,
    eventFingerprint: createHash("md5").update("legacy-008-backfill-shape").digest("hex"),
    rawPayload: body,
    rejectionReason: null,
    creditedLedgerEntryId: "legacy-ledger-entry",
    createdAt: "2026-04-29T12:00:00.000Z",
    updatedAt: "2026-04-29T12:00:00.000Z",
  });

  const replay = await wallets.receiveLocalWebhook(body);
  const mismatch = await wallets.receiveLocalWebhook({
    ...body,
    amount: 11,
  });

  assert.equal(replay.idempotent, true);
  assert.equal(replay.conflict, false);
  assert.equal(replay.depositEvent.id, eventId);
  assert.equal(replay.depositEvent.status, "credited");
  assert.equal(replay.ledgerCredit, null);
  assert.deepEqual(replay.auditEvents, []);
  assert.equal(mismatch.conflict, true);
  assert.equal(mismatch.depositEvent.status, "manual_review");
});

test("local deposit webhook requires an explicit log index or provider event id", async () => {
  const wallets = buildTestWalletService();
  const wallet = await wallets.getOrCreateWallet("deposit-event-key-user");

  await assert.rejects(
    () =>
      wallets.receiveLocalWebhook({
        txHash: "missing-event-key",
        provider: "internal_wallet",
        recipientAddress: wallet.wallet.address,
        amount: 10,
        asset: "USDT",
        network: "TRON",
        confirmations: 2,
      }),
    (error) => error instanceof WalletError && error.code === "INVALID_WEBHOOK_EVENT",
  );

  const accepted = await wallets.receiveLocalWebhook({
    txHash: "provider-event-key",
    providerEventId: "wallet-event-123",
    provider: "internal_wallet",
    recipientAddress: wallet.wallet.address,
    amount: 10,
    asset: "USDT",
    network: "TRON",
    confirmations: 2,
  });

  assert.equal(accepted.depositEvent.logIndex, "event:wallet-event-123");
  assert.equal(accepted.depositEvent.status, "credited");
});

test("local deposit webhook rejects non-positive amounts and unsupported rails", async () => {
  const wallets = buildTestWalletService();
  const wallet = await wallets.getOrCreateWallet("deposit-reject-user");

  const badAmount = await wallets.receiveLocalWebhook({
    txHash: "reject-bad-amount",
    logIndex: "0",
    recipientAddress: wallet.wallet.address,
    amount: 0,
    asset: "USDT",
    network: "TRON",
    confirmations: 2,
  });
  const badAsset = await wallets.receiveLocalWebhook({
    txHash: "reject-bad-asset",
    logIndex: "0",
    recipientAddress: wallet.wallet.address,
    amount: 10,
    asset: "USDC",
    network: "TRON",
    confirmations: 2,
  });
  const badNetwork = await wallets.receiveLocalWebhook({
    txHash: "reject-bad-network",
    logIndex: "0",
    recipientAddress: wallet.wallet.address,
    amount: 10,
    asset: "USDT",
    network: "ETHEREUM",
    confirmations: 2,
  });

  assert.equal(badAmount.depositEvent.status, "rejected");
  assert.equal(badAmount.depositEvent.rejectionReason, "INVALID_AMOUNT");
  assert.equal(badAsset.depositEvent.status, "rejected");
  assert.equal(badAsset.depositEvent.rejectionReason, "UNSUPPORTED_ASSET");
  assert.equal(badNetwork.depositEvent.status, "rejected");
  assert.equal(badNetwork.depositEvent.rejectionReason, "UNSUPPORTED_NETWORK");
});
