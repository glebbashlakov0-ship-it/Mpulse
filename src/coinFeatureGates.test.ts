import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCoinFeatureGateConfiguration,
  buildCoinFeatureCapabilities,
} from "./coinFeatureGates.js";
import { buildRealMoneyLaunchApprovalCapabilities } from "./realMoneyLaunchApproval.js";

test("Coin feature gates default fail-closed without enabling outbound funds providers", () => {
  const capabilities = buildCoinFeatureCapabilities({});

  assert.equal(capabilities.deposits.creditsEnabled, false);
  assert.equal(capabilities.deposits.intentCreationEnabled, false);
  assert.equal(capabilities.withdrawals.requestsEnabled, false);
  assert.equal(capabilities.withdrawals.broadcastEnabled, false);
  assert.equal(capabilities.trading.internalExecutionEnabled, false);
  assert.equal(capabilities.trading.externalExecutionEnabled, false);
  assert.equal(capabilities.outboundFundsProviderCallsEnabled, false);
});

test("review-only withdrawals and internal Coin trading can be enabled without custody or execution calls", () => {
  const capabilities = buildCoinFeatureCapabilities({
    coinWithdrawalRequestsEnabled: true,
    coinInternalTradingEnabled: true,
    exchangeRateProvider: "coinbase",
  });

  assert.equal(capabilities.deposits.creditsEnabled, false);
  assert.equal(capabilities.withdrawals.requestsEnabled, true);
  assert.equal(capabilities.withdrawals.reviewOnly, true);
  assert.equal(capabilities.withdrawals.broadcastEnabled, false);
  assert.equal(capabilities.trading.internalExecutionEnabled, true);
  assert.equal(capabilities.trading.externalExecutionEnabled, false);
  assert.equal(capabilities.outboundFundsProviderCallsEnabled, false);
  assert.doesNotThrow(() =>
    assertCoinFeatureGateConfiguration({
      coinWithdrawalRequestsEnabled: true,
      coinInternalTradingEnabled: true,
      exchangeRateProvider: "coinbase",
    }),
  );
});

test("controlling launch denial blocks deposit credits without weakening safe review gates", () => {
  const config = {
    coinDepositCreditsEnabled: true,
    coinWithdrawalRequestsEnabled: true,
    coinInternalTradingEnabled: true,
    walletDepositWebhookEnabled: true,
    realMoneyDepositProvider: "fireblocks",
    exchangeRateProvider: "coinbase",
    usdtTronContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  };
  const capabilities = buildCoinFeatureCapabilities(config);

  assert.equal(capabilities.deposits.requested, true);
  assert.equal(capabilities.deposits.signedWebhookIngestionEnabled, true);
  assert.equal(capabilities.deposits.intentCreationEnabled, false);
  assert.equal(capabilities.deposits.creditsEnabled, false);
  assert.equal(
    capabilities.deposits.blockReason,
    "REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED",
  );
  assert.equal(capabilities.withdrawals.requestsEnabled, true);
  assert.equal(capabilities.withdrawals.reviewOnly, true);
  assert.equal(capabilities.withdrawals.broadcastEnabled, false);
  assert.equal(capabilities.trading.internalExecutionEnabled, true);
  assert.equal(capabilities.trading.externalExecutionEnabled, false);
  assert.equal(capabilities.outboundFundsProviderCallsEnabled, false);
  assert.throws(
    () => assertCoinFeatureGateConfiguration(config),
    /REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED/,
  );
});

test("a future approved launch artifact still requires every deposit prerequisite", () => {
  const realMoneyLaunchApproval = buildRealMoneyLaunchApprovalCapabilities({
    realMoneyLaunchApprovalRef: "docs/future-real-money-launch-approval.md",
    realMoneyLaunchApprovalArtifactApproved: true,
  });

  assert.throws(
    () =>
      assertCoinFeatureGateConfiguration({
        coinDepositCreditsEnabled: true,
        exchangeRateProvider: "coinbase",
        realMoneyLaunchApproval,
      }),
    /COIN_DEPOSIT_SIGNED_WEBHOOK_REQUIRED/,
  );
  assert.throws(
    () =>
      assertCoinFeatureGateConfiguration({
        coinDepositCreditsEnabled: true,
        walletDepositWebhookEnabled: true,
        realMoneyDepositProvider: "fireblocks",
        exchangeRateProvider: "disabled",
        realMoneyLaunchApproval,
      }),
    /COIN_DEPOSIT_RATE_PROVIDER_REQUIRED/,
  );
  assert.doesNotThrow(() =>
    assertCoinFeatureGateConfiguration({
      coinDepositCreditsEnabled: true,
      walletDepositWebhookEnabled: true,
      realMoneyDepositProvider: "fireblocks",
      exchangeRateProvider: "coinbase",
      usdtTronContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      realMoneyLaunchApproval,
    }),
  );
});
