import assert from "node:assert/strict";
import test from "node:test";
import { buildLedgerService, MemoryLedgerRepository } from "./ledger.js";

function buildTestLedger() {
  return buildLedgerService(new MemoryLedgerRepository());
}

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
