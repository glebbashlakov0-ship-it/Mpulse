import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { buildAdminService, MemoryAdminRepository } from "./admin.js";
import { buildApp } from "./server.js";
import { buildDatabase, type Database } from "./db.js";
import { buildLedgerService, PostgresLedgerRepository } from "./ledger.js";
import { testConfig } from "./testUtils.js";
import {
  buildWalletService,
  WalletProviderAdapter,
  PostgresWalletRepository,
} from "./wallets.js";

const postgresTestUrl = process.env.TEST_DATABASE_URL;
const postgresTestSsl = ["1", "true", "yes", "on"].includes(
  (process.env.TEST_DATABASE_SSL ?? "").toLowerCase(),
);
const VALID_TRON_ADDRESS = "TQ7mYw3xFv8pLk2nR6sD4hJ9aBcEfGhijK";

function getCookieHeader(response: {
  headers: Record<string, string | number | string[] | undefined>;
}) {
  const header = response.headers["set-cookie"];
  const cookie = Array.isArray(header) ? header[0] : String(header ?? "");
  assert.ok(cookie.length > 0);
  return cookie.split(";")[0];
}

test(
  "postgres auth can revoke the current session without breaking audit foreign keys",
  { skip: postgresTestUrl ? false : "Set TEST_DATABASE_URL to run Postgres auth tests." },
  async () => {
    const email = `postgres-current-session-${randomUUID()}@example.com`;
    const db = buildPostgresTestDatabase();

    await cleanupTestUserByEmail(db, email);
    await db.close();

    const app = buildApp(
      testConfig({
        databaseUrl: postgresTestUrl,
        databaseSsl: postgresTestSsl,
      }),
    );

    try {
      const register = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email,
          password: "password12345",
          displayName: "Postgres Session",
        },
      });
      assert.equal(register.statusCode, 200);
      const cookie = getCookieHeader(register);

      const sessions = await app.inject({
        method: "GET",
        url: "/api/auth/sessions",
        headers: { cookie },
      });
      const sessionsBody = JSON.parse(sessions.body) as {
        data: { sessions: Array<{ id: string; current: boolean }> };
      };
      const currentSession = sessionsBody.data.sessions.find((session) => session.current);
      assert.ok(currentSession);

      const revoke = await app.inject({
        method: "DELETE",
        url: `/api/auth/sessions/${currentSession.id}`,
        headers: { cookie },
      });
      assert.equal(revoke.statusCode, 200);
      assert.match(String(revoke.headers["set-cookie"] ?? ""), /Max-Age=0/);

      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      assert.equal(me.statusCode, 401);
    } finally {
      await app.close();
      const cleanupDb = buildPostgresTestDatabase();
      await cleanupTestUserByEmail(cleanupDb, email);
      await cleanupDb.close();
    }
  },
);

test(
  "postgres ledger repository persists credit/debit, idempotency, and balance protection",
  { skip: postgresTestUrl ? false : "Set TEST_DATABASE_URL to run Postgres core tests." },
  async () => {
    const db = buildPostgresTestDatabase();
    const userId = randomUUID();

    try {
      await insertTestUser(db, userId, "postgres-core-ledger@example.com");
      const ledger = buildLedgerService(new PostgresLedgerRepository(db));

      const credit = await ledger.createEntry({
        userId,
        entryType: "credit",
        amount: 100,
        reason: "postgres_test_credit",
        idempotencyKey: "pg-credit-1",
      });
      const idempotentCredit = await ledger.createEntry({
        userId,
        entryType: "credit",
        amount: 100,
        reason: "postgres_test_credit",
        idempotencyKey: "pg-credit-1",
      });
      await assert.rejects(
        () =>
          ledger.createEntry({
            userId,
            entryType: "credit",
            amount: 101,
            reason: "postgres_test_credit",
            idempotencyKey: "pg-credit-1",
          }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "IDEMPOTENCY_KEY_REUSE_MISMATCH");
          assert.equal((error as { statusCode?: number }).statusCode, 409);
          return true;
        },
      );
      await ledger.createEntry({
        userId,
        entryType: "debit",
        amount: 35,
        reason: "postgres_test_debit",
        idempotencyKey: "pg-debit-1",
      });

      await assert.rejects(
        () =>
          ledger.createEntry({
            userId,
            entryType: "debit",
            amount: 1000,
            reason: "postgres_test_insufficient",
            idempotencyKey: "pg-debit-too-large",
          }),
        /Insufficient ledger-derived balance/,
      );

      const balance = await ledger.getBalance({ userId });
      const entries = await ledger.listEntries({ userId });

      assert.equal(idempotentCredit.idempotent, true);
      assert.equal(idempotentCredit.entry.id, credit.entry.id);
      assert.equal(balance.availableBalance, 65);
      assert.equal(balance.totalCredited, 100);
      assert.equal(balance.totalDebited, 35);
      assert.equal(entries.length, 2);
    } finally {
      await cleanupTestUser(db, userId);
      await db.close();
    }
  },
);

test(
  "postgres wallet repository supports create/reuse, withdrawal idempotency, and admin reject without ledger debit",
  { skip: postgresTestUrl ? false : "Set TEST_DATABASE_URL to run Postgres core tests." },
  async () => {
    const db = buildPostgresTestDatabase();
    const userId = randomUUID();
    const runId = randomUUID();
    const depositTxHash = `pg-deposit-credit-${runId}`;
    const depositLogIndex = `log-${runId}`;
    const legacyDepositId = randomUUID();
    const legacyDepositTxHash = `pg-legacy-fingerprint-${runId}`;
    const legacyDepositLogIndex = `legacy-log-${runId}`;
    const invalidDepositTxHash = `pg-invalid-deposit-amount-${runId}`;

    try {
      await insertTestUser(db, userId, "postgres-core-wallet@example.com");
      const ledger = buildLedgerService(new PostgresLedgerRepository(db));
      const walletRepository = new PostgresWalletRepository(db);
      const wallets = buildWalletService({
        repository: walletRepository,
        provider: new WalletProviderAdapter(),
        ledger,
        depositMinConfirmations: 2,
        getComplianceEligibility: async () => ({ canUseRealMoney: false }),
      });
      const admin = buildAdminService({
        repository: new MemoryAdminRepository(),
        walletRepository,
      });

      await ledger.createEntry({
        userId,
        entryType: "credit",
        amount: 50,
        reason: "postgres_admin_reject_credit",
        idempotencyKey: `pg-admin-reject-credit-${runId}`,
      });
      const firstWallet = await wallets.getOrCreateWallet(userId);
      const secondWallet = await wallets.getOrCreateWallet(userId);
      const depositCredit = await wallets.receiveLocalWebhook({
        txHash: depositTxHash,
        logIndex: depositLogIndex,
        provider: "internal_wallet",
        recipientAddress: firstWallet.wallet.address,
        amount: 20,
        asset: "USDT",
        network: "TRON",
        confirmations: 2,
      });
      const duplicateDepositCredit = await wallets.receiveLocalWebhook({
        txHash: depositTxHash,
        logIndex: depositLogIndex,
        provider: "internal_wallet",
        recipientAddress: firstWallet.wallet.address,
        amount: 20,
        asset: "USDT",
        network: "TRON",
        confirmations: 2,
      });
      const legacyDepositPayload = {
        txHash: legacyDepositTxHash,
        logIndex: legacyDepositLogIndex,
        provider: "internal_wallet",
        recipientAddress: firstWallet.wallet.address,
        amount: 20,
        asset: "USDT",
        network: "TRON",
        confirmations: 2,
      };
      await db.query(
        `insert into wallet_deposit_events (
           id, tx_hash, log_index, wallet_id, user_id, amount, asset, network, confirmations,
           status, provider, recipient_address, event_fingerprint, raw_payload, created_at,
           updated_at
         )
         values (
           $1, $2, $3, $4, $5, $6, 'USDT', 'TRON', 2, 'credited', 'internal_wallet',
           $7, $8, $9::jsonb, now(), now()
         )`,
        [
          legacyDepositId,
          legacyDepositPayload.txHash,
          legacyDepositPayload.logIndex,
          firstWallet.wallet.id,
          userId,
          legacyDepositPayload.amount,
          firstWallet.wallet.address,
          createHash("md5").update(`legacy-008-backfill-${runId}`).digest("hex"),
          JSON.stringify(legacyDepositPayload),
        ],
      );
      const legacyDepositReplay = await wallets.receiveLocalWebhook(legacyDepositPayload);
      const invalidDepositId = randomUUID();
      let insertedInvalidDeposit = false;
      try {
        await db.query(
          `insert into wallet_deposit_events (
             id, tx_hash, log_index, wallet_id, user_id, amount, asset, network, confirmations,
             status, provider, recipient_address, event_fingerprint, raw_payload, created_at,
             updated_at
           )
           values (
             $1, $2, '0', $3, $4, 0, 'USDT', 'TRON', 2,
             'confirmed', 'internal_wallet', $5, $6, '{}'::jsonb,
             now(), now()
           )`,
          [
            invalidDepositId,
            invalidDepositTxHash,
            firstWallet.wallet.id,
            userId,
            firstWallet.wallet.address,
            `invalid-amount-fingerprint-${runId}`,
          ],
        );
        insertedInvalidDeposit = true;
      } catch (error) {
        assert.match(
          String(error),
          /wallet_deposit_events_amount_positive_check|check constraint/,
        );
      } finally {
        if (insertedInvalidDeposit) {
          await db.query("delete from wallet_deposit_events where id = $1", [invalidDepositId]);
        }
      }
      const deposit = await wallets.createDepositIntent({
        userId,
        body: { expectedAmount: 25, reference: "pg-local-deposit" },
      });
      const withdrawal = await wallets.createWithdrawalRequest({
        userId,
        body: {
          destinationAddress: VALID_TRON_ADDRESS,
          amount: 15,
          idempotencyKey: `pg-withdrawal-${runId}`,
          manualReview: true,
        },
      });
      const idempotentWithdrawal = await wallets.createWithdrawalRequest({
        userId,
        body: {
          destinationAddress: VALID_TRON_ADDRESS,
          amount: 15,
          idempotencyKey: `pg-withdrawal-${runId}`,
          manualReview: true,
        },
      });

      await assert.rejects(
        () =>
          wallets.createWithdrawalRequest({
            userId,
            body: {
              destinationAddress: VALID_TRON_ADDRESS,
              amount: 16,
              idempotencyKey: `pg-withdrawal-${runId}`,
              manualReview: true,
            },
          }),
        /different withdrawal request/,
      );

      const review = await admin.reviewWithdrawal({
        id: withdrawal.withdrawalRequest.id,
        status: "rejected",
      });
      const balance = await ledger.getBalance({ userId });
      const list = await wallets.listWithdrawalRequests(userId);

      assert.equal(firstWallet.created, true);
      assert.equal(secondWallet.wallet.id, firstWallet.wallet.id);
      assert.equal(deposit.depositIntent.status, "waiting");
      assert.equal(idempotentWithdrawal.idempotent, true);
      assert.equal(idempotentWithdrawal.withdrawalRequest.id, withdrawal.withdrawalRequest.id);
      assert.equal(list.withdrawalRequests.length, 1);
      assert.equal(review.withdrawalRequest.status, "rejected");
      assert.equal(review.withdrawalRequest.realTransferBlocked, true);
      assert.equal(review.ledgerMutationBlocked, true);
      assert.equal(depositCredit.depositEvent.status, "credited");
      assert.equal(depositCredit.ledgerCredit?.idempotent, false);
      assert.equal(duplicateDepositCredit.idempotent, true);
      assert.equal(duplicateDepositCredit.ledgerCredit, null);
      assert.equal(legacyDepositReplay.idempotent, true);
      assert.equal(legacyDepositReplay.conflict, false);
      assert.equal(legacyDepositReplay.depositEvent.id, legacyDepositId);
      assert.equal(legacyDepositReplay.depositEvent.status, "credited");
      assert.equal(insertedInvalidDeposit, false);
      assert.equal(balance.availableBalance, 70);
      assert.equal(balance.totalDebited, 0);
    } finally {
      await db.query("delete from wallet_deposit_events where id = $1", [legacyDepositId]);
      await cleanupTestUser(db, userId);
      await db.close();
    }
  },
);

function buildPostgresTestDatabase() {
  assert.ok(postgresTestUrl);
  return buildDatabase(
    testConfig({
      databaseUrl: postgresTestUrl,
      databaseSsl: postgresTestSsl,
    }),
  );
}

async function insertTestUser(db: Database, userId: string, email: string) {
  await db.query(
    `insert into users (
       id, email, email_verified, display_name, password_hash, password_salt, role,
       created_at, updated_at
     )
     values ($1, $2, false, 'Postgres Core Test', 'test-hash', 'test-salt', 'user', now(), now())`,
    [userId, email],
  );
}

async function cleanupTestUser(db: Database, userId: string) {
  await db.query("delete from users where id = $1", [userId]);
}

async function cleanupTestUserByEmail(db: Database, email: string) {
  await db.query("delete from users where email = $1", [email]);
}
