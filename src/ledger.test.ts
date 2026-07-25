import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLedgerRuntimeCapabilities,
  buildLedgerService,
  getLedgerRuntimeReadinessBlockerDetails,
  LedgerError,
  MemoryLedgerRepository,
  PostgresLedgerRepository,
} from "./ledger.js";
import { MemoryAuditLogRepository } from "./audit.js";
import type { Database, Queryable } from "./db.js";

function buildTestLedger() {
  return buildLedgerService(new MemoryLedgerRepository());
}

test("ledger runtime policy blocks direct local self-credit when tooling is disabled", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository(), {
    appMode: "local",
    nodeEnv: "test",
    localLedgerCreditApiEnabled: false,
  });

  await assert.rejects(
    () =>
      ledger.createEntry({
        userId: "policy-self-credit",
        entryType: "credit",
        amount: 100,
        reason: "ledger_credit",
        referenceType: "ledger_credit",
        referenceId: "policy-self-credit",
        idempotencyKey: "policy-self-credit",
        metadata: {
          source: "ledger_credit",
        },
      }),
    (error) =>
      error instanceof LedgerError &&
      error.code === "LEDGER_ENTRY_POLICY_DISABLED" &&
      error.statusCode === 403,
  );

  const balance = await ledger.getBalance({ userId: "policy-self-credit" });
  assert.equal(balance.availableBalance, 0);
  assert.equal(balance.totalCredited, 0);
});

test("memory ledger owner records audit events without route compensation", async () => {
  const auditRepository = new MemoryAuditLogRepository();
  const ledger = buildLedgerService(
    new MemoryLedgerRepository(),
    {
      appMode: "local",
      nodeEnv: "test",
      localLedgerCreditApiEnabled: true,
    },
    auditRepository,
  );

  const result = await ledger.createEntry({
    userId: "memory-audit-user",
    entryType: "credit",
    amount: 10,
    reason: "ledger_credit",
    referenceType: "ledger_credit",
    referenceId: "memory-audit",
    idempotencyKey: "memory-audit",
    metadata: {
      source: "ledger_credit",
    },
    auditEvent: ({ entry, idempotent }) => ({
      id: "11111111-1111-4111-8111-111111111155",
      eventType: "ledger.ledger_credit",
      userId: entry.userId,
      sessionId: "memory-audit-session",
      metadata: {
        ledgerEntryId: entry.id,
        idempotent,
      },
      createdAt: entry.createdAt,
    }),
  });

  const auditEvents = await auditRepository.listRecent();

  assert.equal(result.audit?.committed, true);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.eventType, "ledger.ledger_credit");
  assert.equal(auditEvents[0]?.metadata.ledgerEntryId, result.entry.id);
  assert.equal(auditEvents[0]?.metadata.idempotent, false);
});

test("ledger runtime policy blocks unclassified balance credits in production", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository(), {
    appMode: "local",
    nodeEnv: "production",
  });

  await assert.rejects(
    () =>
      ledger.createEntry({
        userId: "policy-prod-credit",
        entryType: "credit",
        amount: 100,
        reason: "operator_credit",
        referenceType: "operator_credit",
        referenceId: "manual",
        idempotencyKey: "policy-prod-credit",
      }),
    (error) =>
      error instanceof LedgerError &&
      error.code === "LEDGER_ENTRY_POLICY_DISABLED" &&
      error.statusCode === 403,
  );

  const balance = await ledger.getBalance({ userId: "policy-prod-credit" });
  assert.equal(balance.availableBalance, 0);
  assert.equal(balance.totalCredited, 0);
});

test("ledger runtime policy blocks production deployment credits before NODE_ENV is corrected", async () => {
  const ledger = buildLedgerService(new MemoryLedgerRepository(), {
    appMode: "local",
    nodeEnv: "development",
    productionDeployment: true,
  });

  await assert.rejects(
    () =>
      ledger.createEntry({
        userId: "policy-prod-deploy-credit",
        entryType: "credit",
        amount: 100,
        reason: "operator_credit",
        referenceType: "operator_credit",
        referenceId: "manual",
        idempotencyKey: "policy-prod-deploy-credit",
      }),
    (error) =>
      error instanceof LedgerError &&
      error.code === "LEDGER_ENTRY_POLICY_DISABLED" &&
      error.statusCode === 403,
  );

  const capabilities = buildLedgerRuntimeCapabilities({
    appMode: "local",
    nodeEnv: "development",
    productionDeployment: true,
  });
  assert.equal(capabilities.unclassifiedProductionCreditsBlocked, true);
});

test("ledger owner disables local credit surfaces in production even when policy booleans are true", async () => {
  const policy = {
    appMode: "local",
    nodeEnv: "production",
    localDepositWebhookCreditEnabled: true,
    adminManualDepositCreditEnabled: true,
    adminActivitySeedApiEnabled: true,
    localSimulatedTradingEnabled: true,
  };
  const capabilities = buildLedgerRuntimeCapabilities(policy);
  const ledger = buildLedgerService(new MemoryLedgerRepository(), policy);
  const inputs = [
    {
      userId: "policy-local-deposit-prod",
      entryType: "credit" as const,
      amount: 100,
      reason: "wallet_deposit_confirmed",
      referenceType: "wallet_deposit_event",
      referenceId: "deposit-event",
      idempotencyKey: "policy-local-deposit-prod",
      metadata: { source: "local_deposit_webhook" },
    },
    {
      userId: "policy-admin-deposit-prod",
      entryType: "credit" as const,
      amount: 100,
      reason: "wallet_deposit_admin_approved",
      referenceType: "wallet_deposit_event",
      referenceId: "admin-deposit-event",
      idempotencyKey: "policy-admin-deposit-prod",
      metadata: { source: "admin_deposit_review" },
    },
    {
      userId: "policy-admin-seed-prod",
      entryType: "credit" as const,
      amount: 100,
      reason: "admin_seed_deposit",
      referenceType: "wallet_deposit_event",
      referenceId: "admin-seed-event",
      idempotencyKey: "policy-admin-seed-prod",
      metadata: { source: "admin_seed" },
    },
    {
      userId: "policy-local-sim-prod",
      entryType: "credit" as const,
      amount: 100,
      reason: "Initial trading balance",
      referenceType: "local_init",
      referenceId: "policy-local-sim-prod",
      idempotencyKey: "policy-local-sim-prod",
    },
  ];

  assert.equal(capabilities.localDepositWebhookCreditEnabled, false);
  assert.equal(capabilities.adminManualDepositCreditEnabled, false);
  assert.equal(capabilities.adminActivitySeedCreditEnabled, false);
  assert.equal(capabilities.localSimulatedTradingEnabled, false);

  for (const input of inputs) {
    await assert.rejects(
      () => ledger.createEntry(input),
      (error) =>
        error instanceof LedgerError &&
        error.code === "LEDGER_ENTRY_POLICY_DISABLED" &&
        error.statusCode === 403,
    );
    assert.equal((await ledger.getBalance({ userId: input.userId })).availableBalance, 0);
  }
});

test("persistent ledger writes fail closed when runtime policy is omitted", async () => {
  let queryWasCalled = false;
  const db: Queryable = {
    async query() {
      queryWasCalled = true;
      throw new Error("query should not run without a ledger runtime policy");
    },
  };
  const ledger = buildLedgerService(new PostgresLedgerRepository(db));

  await assert.rejects(
    () =>
      ledger.createEntry({
        userId: "policy-required",
        entryType: "credit",
        amount: 100,
        reason: "operator_credit",
        referenceType: "operator_credit",
        referenceId: "manual",
        idempotencyKey: "policy-required-credit",
      }),
    (error) =>
      error instanceof LedgerError &&
      error.code === "LEDGER_RUNTIME_POLICY_REQUIRED" &&
      error.statusCode === 500,
  );

  assert.equal(queryWasCalled, false);
});

test("postgres ledger owner writes local credit audit inside the transaction", async () => {
  const queries: string[] = [];
  const userId = "ledger-audit-user";
  const balanceRows = [
    {
      total_credited: "0",
      total_debited: "0",
      total_held: "0",
      total_released: "0",
      available_balance: "0",
    },
    {
      total_credited: "25",
      total_debited: "0",
      total_held: "0",
      total_released: "0",
      available_balance: "25",
    },
  ];
  let ledgerEntryId: unknown = null;
  let auditInsertValues: readonly unknown[] | undefined;
  const db: Database = {
    enabled: true,
    async query() {
      throw new Error("outer query should not be used");
    },
    async transaction<T>(callback: (client: Queryable) => Promise<T>) {
      const client: Queryable = {
        async query<TQuery = Record<string, unknown>>(text: string, values?: readonly unknown[]) {
          if (text.includes("pg_advisory_xact_lock")) {
            queries.push("lock");
            return { rows: [] as TQuery[] };
          }

          if (text.includes("where user_id = $1 and idempotency_key = $2")) {
            queries.push("idempotency");
            return { rows: [] as TQuery[] };
          }

          if (text.includes("as available_balance")) {
            queries.push("balance");
            const row = balanceRows.shift();
            assert.ok(row, "Test fixture should provide every balance row.");
            return { rows: [row] as TQuery[] };
          }

          if (text.includes("insert into ledger_entries")) {
            queries.push("ledger_insert");
            ledgerEntryId = values?.[0] ?? null;
            assert.equal(values?.[1], userId);
            assert.equal(values?.[4], "credit");
            assert.equal(values?.[5], 25);
            assert.equal(values?.[7], "ledger_credit");
            return { rows: [] as TQuery[] };
          }

          if (text.includes("insert into audit_logs")) {
            queries.push("audit_insert");
            auditInsertValues = values;
            return { rows: [] as TQuery[] };
          }

          throw new Error(`Unexpected query: ${text}`);
        },
      };

      return callback(client);
    },
    async close() {
      // No-op.
    },
  };
  const ledger = buildLedgerService(
    new PostgresLedgerRepository(db, {
      appMode: "local",
      nodeEnv: "test",
      localLedgerCreditApiEnabled: true,
    }),
    {
      appMode: "local",
      nodeEnv: "test",
      localLedgerCreditApiEnabled: true,
    },
  );

  const result = await ledger.createEntry({
    userId,
    entryType: "credit",
    amount: 25,
    reason: "ledger_credit",
    referenceType: "ledger_credit",
    referenceId: "ledger-audit-key",
    idempotencyKey: "ledger-audit-key",
    metadata: {
      source: "ledger_credit",
    },
    auditEvent: ({ entry, idempotent }) => ({
      id: "11111111-1111-4111-8111-111111111133",
      eventType: "ledger.ledger_credit",
      userId: entry.userId,
      sessionId: "ledger-audit-session",
      metadata: {
        ledgerEntryId: entry.id,
        idempotent,
      },
      createdAt: entry.createdAt,
    }),
  });

  assert.equal(result.audit?.committed, true);
  assert.equal(result.entry.id, ledgerEntryId);
  assert.deepEqual(queries, [
    "lock",
    "idempotency",
    "balance",
    "ledger_insert",
    "balance",
    "audit_insert",
  ]);
  assert.equal(auditInsertValues?.[1], "ledger.ledger_credit");
  assert.equal(auditInsertValues?.[2], userId);
  assert.equal(auditInsertValues?.[3], "ledger-audit-session");
  assert.deepEqual(JSON.parse(String(auditInsertValues?.[4])), {
    ledgerEntryId: result.entry.id,
    idempotent: false,
  });
  assert.equal(balanceRows.length, 0);
});

test("ledger runtime readiness reports real-money unsafe credit surfaces", () => {
  const capabilities = buildLedgerRuntimeCapabilities({
    appMode: "local",
    nodeEnv: "development",
    localLedgerCreditApiEnabled: true,
    localDepositWebhookCreditEnabled: true,
    adminManualDepositCreditEnabled: true,
    adminActivitySeedApiEnabled: true,
    localSimulatedTradingEnabled: true,
    realWithdrawalTransferEnabled: false,
    marketSettlementCreditEnabled: false,
  });
  const blockerDetails = getLedgerRuntimeReadinessBlockerDetails(capabilities);
  const blockerCodes = blockerDetails.map((blocker) => blocker.code);

  assert.deepEqual(blockerDetails.map((blocker) => blocker.source), [
    "ledger",
    "ledger",
    "ledger",
    "ledger",
    "ledger",
    "ledger",
    "ledger",
    "ledger",
    "ledger",
  ]);
  assert.deepEqual(blockerCodes, [
    "LOCAL_LEDGER_CREDIT_API_ENABLED",
    "LOCAL_DEPOSIT_WEBHOOK_CREDIT_ENABLED",
    "ADMIN_MANUAL_DEPOSIT_CREDIT_ENABLED",
    "ADMIN_ACTIVITY_SEED_CREDIT_ENABLED",
    "LOCAL_SIMULATED_LEDGER_ENABLED",
    "REAL_TRADING_LEDGER_DISABLED",
    "REAL_WITHDRAWAL_LEDGER_DISABLED",
    "MARKET_SETTLEMENT_LEDGER_DISABLED",
    "UNCLASSIFIED_PRODUCTION_CREDITS_NOT_BLOCKED",
  ]);

  const realExecutionCapabilities = buildLedgerRuntimeCapabilities({
    appMode: "real_money",
    nodeEnv: "production",
    productionDeployment: true,
    realTradingExecutionEnabled: true,
    realWithdrawalTransferEnabled: true,
    marketSettlementCreditEnabled: true,
  });
  const realExecutionBlockerCodes = getLedgerRuntimeReadinessBlockerDetails(
    realExecutionCapabilities,
  ).map((blocker) => blocker.code);

  assert.equal(realExecutionBlockerCodes.includes("REAL_TRADING_LEDGER_DISABLED"), false);
  assert.equal(realExecutionBlockerCodes.includes("REAL_WITHDRAWAL_LEDGER_DISABLED"), false);
});

test("ledger credit increases available balance", async () => {
  const ledger = buildTestLedger();

  await ledger.createEntry({
    userId: "user-credit",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    idempotencyKey: "credit-1",
  });
  const balance = await ledger.getBalance({ userId: "user-credit", asset: "USDT" });

  assert.equal(balance.availableBalance, 100);
  assert.equal(balance.totalCredited, 100);
});

test("ledger debit decreases available balance", async () => {
  const ledger = buildTestLedger();

  await ledger.createEntry({
    userId: "user-debit",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    idempotencyKey: "credit-1",
  });
  await ledger.createEntry({
    userId: "user-debit",
    entryType: "debit",
    amount: 35,
    reason: "test_debit",
    idempotencyKey: "debit-1",
  });
  const balance = await ledger.getBalance({ userId: "user-debit", asset: "USDT" });
  const totals = await ledger.getTotals({ userId: "user-debit", asset: "USDT" });

  assert.equal(balance.availableBalance, 65);
  assert.equal(balance.totalDebited, 35);
  assert.equal(totals.totalCredited, 100);
  assert.equal(totals.totalDebited, 35);
});

test("ledger rejects insufficient balance", async () => {
  const ledger = buildTestLedger();

  await assert.rejects(
    () =>
      ledger.createEntry({
        userId: "user-insufficient",
        entryType: "debit",
        amount: 1,
        reason: "test_debit",
        idempotencyKey: "debit-1",
      }),
    /Insufficient ledger-derived balance/,
  );
});

test("ledger release cannot create available balance without a hold", async () => {
  const ledger = buildTestLedger();

  await ledger.createEntry({
    userId: "user-release",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    idempotencyKey: "credit-1",
  });
  await assert.rejects(
    () =>
      ledger.createEntry({
        userId: "user-release",
        entryType: "release",
        amount: 1,
        reason: "test_release",
        idempotencyKey: "release-1",
      }),
    /Insufficient held ledger balance/,
  );
});

test("ledger hold and release update available and held balances", async () => {
  const ledger = buildTestLedger();

  await ledger.createEntry({
    userId: "user-hold-release",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    idempotencyKey: "credit-1",
  });
  await ledger.createEntry({
    userId: "user-hold-release",
    entryType: "hold",
    amount: 40,
    reason: "test_hold",
    idempotencyKey: "hold-1",
  });
  await ledger.createEntry({
    userId: "user-hold-release",
    entryType: "release",
    amount: 15,
    reason: "test_release",
    idempotencyKey: "release-1",
  });
  const balance = await ledger.getBalance({ userId: "user-hold-release" });

  assert.equal(balance.availableBalance, 75);
  assert.equal(balance.totalHeld, 40);
  assert.equal(balance.totalReleased, 15);
});

test("ledger idempotency prevents duplicate credit and debit", async () => {
  const ledger = buildTestLedger();

  const firstCredit = await ledger.createEntry({
    userId: "user-idempotent",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    idempotencyKey: "same-credit",
  });
  const secondCredit = await ledger.createEntry({
    userId: "user-idempotent",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    idempotencyKey: "same-credit",
  });
  const firstDebit = await ledger.createEntry({
    userId: "user-idempotent",
    entryType: "debit",
    amount: 25,
    reason: "test_debit",
    idempotencyKey: "same-debit",
  });
  const secondDebit = await ledger.createEntry({
    userId: "user-idempotent",
    entryType: "debit",
    amount: 25,
    reason: "test_debit",
    idempotencyKey: "same-debit",
  });
  const balance = await ledger.getBalance({ userId: "user-idempotent" });
  const entries = await ledger.listEntries({ userId: "user-idempotent" });

  assert.equal(secondCredit.idempotent, true);
  assert.equal(secondCredit.entry.id, firstCredit.entry.id);
  assert.equal(secondDebit.idempotent, true);
  assert.equal(secondDebit.entry.id, firstDebit.entry.id);
  assert.equal(balance.availableBalance, 75);
  assert.equal(entries.length, 2);
});

test("ledger idempotency rejects same key with a different payload", async () => {
  const ledger = buildTestLedger();

  await ledger.createEntry({
    userId: "user-idempotent-mismatch",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    referenceType: "test",
    referenceId: "reference-1",
    idempotencyKey: "same-key-different-payload",
    metadata: {
      source: "first",
      nested: {
        a: 1,
        b: 2,
      },
    },
  });

  await assert.rejects(
    () =>
      ledger.createEntry({
        userId: "user-idempotent-mismatch",
        entryType: "credit",
        amount: 101,
        reason: "test_credit",
        referenceType: "test",
        referenceId: "reference-1",
        idempotencyKey: "same-key-different-payload",
        metadata: {
          source: "first",
          nested: {
            b: 2,
            a: 1,
          },
        },
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "IDEMPOTENCY_KEY_REUSE_MISMATCH");
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      return true;
    },
  );

  const entries = await ledger.listEntries({ userId: "user-idempotent-mismatch" });
  assert.equal(entries.length, 1);
});

test("ledger idempotency accepts stable metadata with different object key order", async () => {
  const ledger = buildTestLedger();

  const first = await ledger.createEntry({
    userId: "user-idempotent-metadata-order",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    idempotencyKey: "same-key-stable-metadata",
    metadata: {
      nested: {
        a: 1,
        b: 2,
      },
      source: "first",
    },
  });
  const second = await ledger.createEntry({
    userId: "user-idempotent-metadata-order",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    idempotencyKey: "same-key-stable-metadata",
    metadata: {
      source: "first",
      nested: {
        b: 2,
        a: 1,
      },
    },
  });

  assert.equal(second.idempotent, true);
  assert.equal(second.entry.id, first.entry.id);
});

test("ledger entries are user-scoped", async () => {
  const ledger = buildTestLedger();

  await ledger.createEntry({
    userId: "ledger-user-a",
    entryType: "credit",
    amount: 100,
    reason: "test_credit",
    idempotencyKey: "same-key",
  });
  await ledger.createEntry({
    userId: "ledger-user-b",
    entryType: "credit",
    amount: 40,
    reason: "test_credit",
    idempotencyKey: "same-key",
  });

  const firstBalance = await ledger.getBalance({ userId: "ledger-user-a" });
  const secondBalance = await ledger.getBalance({ userId: "ledger-user-b" });
  const firstEntries = await ledger.listEntries({ userId: "ledger-user-a" });

  assert.equal(firstBalance.availableBalance, 100);
  assert.equal(secondBalance.availableBalance, 40);
  assert.equal(firstEntries.length, 1);
  assert.equal(firstEntries[0]?.userId, "ledger-user-a");
});
