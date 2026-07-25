import assert from "node:assert/strict";
import test from "node:test";
import {
  CoinLedgerError,
  PostgresCoinLedgerRepository,
  publicCoinAmount,
} from "./coins.js";

test("Coin API serialization never returns a JavaScript number", () => {
  assert.equal(publicCoinAmount(9_007_199_254_740_993n), "9007199254740993");
  assert.equal(typeof publicCoinAmount(1n), "string");
});

test("Coin ledger errors have stable public codes", () => {
  const error = new CoinLedgerError("INSUFFICIENT_COIN_BALANCE", "insufficient", 409);
  assert.equal(error.code, "INSUFFICIENT_COIN_BALANCE");
  assert.equal(error.statusCode, 409);
});

test("Coin ledger rejects entries without a related entity id before querying", async () => {
  const repository = new PostgresCoinLedgerRepository({
    async query() {
      throw new Error("query must not run");
    },
  });
  await assert.rejects(
    repository.postEntry({
      userId: "user-1",
      operationType: "bonus_credit",
      availableDeltaCoinMicros: 1n,
      idempotencyKey: "bonus-1",
      sourceType: "bonus",
      sourceId: "",
      reason: "test bonus",
    }),
    (error: unknown) =>
      error instanceof CoinLedgerError && error.code === "COIN_SOURCE_REQUIRED",
  );
});
