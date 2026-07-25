import assert from "node:assert/strict";
import test from "node:test";
import {
  coinWalletSafetyTestUtils,
  isValidTronAddress,
  type DepositImmutableComparison,
} from "./coinWallets.js";

test("TRON validation verifies Base58Check checksum, not only address shape", () => {
  assert.equal(isValidTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"), true);
  assert.equal(isValidTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj61"), false);
  assert.equal(isValidTronAddress("0x0000000000000000000000000000000000000000"), false);
});

test("withdrawal reserve remains locked for every non-confirmed provider failure", () => {
  const {
    canReleaseWithdrawalReserve,
    withdrawalRetryBlockedReason,
  } = coinWalletSafetyTestUtils;

  assert.equal(
    canReleaseWithdrawalReserve("failed", "PROVIDER_CONFIRMED_FAILED"),
    true,
  );
  for (const failureState of [
    null,
    "PROVIDER_STATE_UNKNOWN",
    "FINAL_AMOUNT_RATE_MISMATCH",
    "PROVIDER_TRANSACTION_HASH_REQUIRED",
    "RATE_STALE",
  ]) {
    assert.equal(canReleaseWithdrawalReserve("failed", failureState), false);
    assert.equal(
      withdrawalRetryBlockedReason(failureState),
      "WITHDRAWAL_RESERVE_LOCKED_PROVIDER_OUTCOME_NOT_CONFIRMED",
    );
  }
  assert.equal(
    withdrawalRetryBlockedReason("PROVIDER_CONFIRMED_FAILED"),
    "REAL_MONEY_LAUNCH_NOT_APPROVED",
  );
  assert.equal(canReleaseWithdrawalReserve("pending_review", null), true);
});

test("deposit immutable comparison covers identity, coordinates, and every money field", () => {
  const stored: DepositImmutableComparison = {
    asset: "USDT",
    network: "TRON",
    providerTransactionId: "provider-transaction-1",
    blockchainTxHash: "chain-transaction-1",
    eventIndex: "3",
    tokenContract: "contract-1",
    destinationAddress: "destination-1",
    grossUsdtAtomic: "10000000",
    networkFeeUsdtAtomic: "100000",
    providerFeeUsdtAtomic: "200000",
    netUsdtAtomic: "9700000",
  };
  const { immutableDepositMismatchFields } = coinWalletSafetyTestUtils;
  assert.deepEqual(immutableDepositMismatchFields(stored, { ...stored }), []);

  const cases: Array<[keyof DepositImmutableComparison, string | null]> = [
    ["asset", "BTC"],
    ["network", "ETH"],
    ["providerTransactionId", "provider-transaction-2"],
    ["blockchainTxHash", "chain-transaction-2"],
    ["eventIndex", "4"],
    ["tokenContract", "contract-2"],
    ["destinationAddress", "destination-2"],
    ["grossUsdtAtomic", "11000000"],
    ["networkFeeUsdtAtomic", "110000"],
    ["providerFeeUsdtAtomic", "210000"],
    ["netUsdtAtomic", "10680000"],
  ];
  for (const [field, value] of cases) {
    assert.deepEqual(
      immutableDepositMismatchFields(stored, { ...stored, [field]: value }),
      [field],
    );
  }
});

test("credited and reversed deposits preserve their financial state on conflicting evidence", () => {
  const { isDepositFinancialStateImmutable } = coinWalletSafetyTestUtils;
  assert.equal(isDepositFinancialStateImmutable("credited"), true);
  assert.equal(isDepositFinancialStateImmutable("reversal_pending"), true);
  assert.equal(isDepositFinancialStateImmutable("reversed"), true);
  assert.equal(isDepositFinancialStateImmutable("detected"), false);
  assert.equal(isDepositFinancialStateImmutable("manual_review"), false);
});

test("deposit intent selection fails closed when an address has multiple live matches", () => {
  const { selectUnambiguousDepositIntent } = coinWalletSafetyTestUtils;
  const onlyIntent = { id: "intent-1" };

  assert.deepEqual(selectUnambiguousDepositIntent([]), {
    value: null,
    ambiguous: false,
  });
  assert.deepEqual(selectUnambiguousDepositIntent([onlyIntent]), {
    value: onlyIntent,
    ambiguous: false,
  });
  assert.deepEqual(
    selectUnambiguousDepositIntent([
      { id: "newest-intent" },
      { id: "older-intent" },
    ]),
    {
      value: null,
      ambiguous: true,
    },
  );
});
