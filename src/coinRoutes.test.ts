import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./server.js";
import { testConfig } from "./testUtils.js";

test("supported money rails expose Coins internally and only USDT TRC-20 externally", async () => {
  const app = buildApp(testConfig());
  try {
    const response = await app.inject({ method: "GET", url: "/api/money/supported-assets" });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.deepEqual(payload.data.internalCurrency, {
      code: "COIN",
      name: "Coins",
      microsPerCoin: "1000000",
      usdParity: "1",
      blockchainAsset: false,
    });
    assert.deepEqual(payload.data.settlementAssets, [
      {
        asset: "USDT",
        network: "TRON",
        rail: "TRC-20",
        decimals: 6,
        depositEnabled: false,
        withdrawalEnabled: false,
        reviewOnly: true,
      },
    ]);
    assert.deepEqual(payload.data.capabilities, {
      depositCreditsEnabled: false,
      depositBlockReason: "COIN_DEPOSIT_CREDITS_DISABLED",
      withdrawalRequestsEnabled: false,
      withdrawalBroadcastEnabled: false,
      withdrawalBlockReason: "COIN_WITHDRAWAL_REQUESTS_DISABLED",
      internalTradingEnabled: true,
      externalTradingEnabled: false,
      outboundFundsProviderCallsEnabled: false,
    });
  } finally {
    await app.close();
  }
});

test("supported money rails expose explicitly enabled review-only withdrawals", async () => {
  const app = buildApp(
    testConfig({
      coinWithdrawalRequestsEnabled: true,
      exchangeRateProvider: "coinbase",
    }),
  );
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/money/supported-assets",
    });
    const payload = response.json();

    assert.equal(payload.data.settlementAssets[0]?.depositEnabled, false);
    assert.equal(payload.data.settlementAssets[0]?.withdrawalEnabled, true);
    assert.equal(payload.data.settlementAssets[0]?.reviewOnly, true);
    assert.equal(payload.data.capabilities.withdrawalRequestsEnabled, true);
    assert.equal(payload.data.capabilities.withdrawalBroadcastEnabled, false);
    assert.equal(
      payload.data.capabilities.outboundFundsProviderCallsEnabled,
      false,
    );
  } finally {
    await app.close();
  }
});

test("supported money rails keep deposit credits disabled under the controlling launch denial", async () => {
  const app = buildApp(
    testConfig({
      coinDepositCreditsEnabled: true,
      coinWithdrawalRequestsEnabled: true,
      coinInternalTradingEnabled: true,
      walletDepositWebhookEnabled: true,
      realMoneyDepositProvider: "fireblocks",
      exchangeRateProvider: "coinbase",
      usdtTronContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    }),
  );
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/money/supported-assets",
    });
    const payload = response.json();

    assert.equal(payload.data.settlementAssets[0]?.depositEnabled, false);
    assert.equal(payload.data.settlementAssets[0]?.withdrawalEnabled, true);
    assert.equal(payload.data.capabilities.depositCreditsEnabled, false);
    assert.equal(
      payload.data.capabilities.depositBlockReason,
      "REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED",
    );
    assert.equal(payload.data.capabilities.withdrawalRequestsEnabled, true);
    assert.equal(payload.data.capabilities.withdrawalBroadcastEnabled, false);
    assert.equal(payload.data.capabilities.internalTradingEnabled, true);
    assert.equal(payload.data.capabilities.externalTradingEnabled, false);
    assert.equal(
      payload.data.capabilities.outboundFundsProviderCallsEnabled,
      false,
    );
  } finally {
    await app.close();
  }
});
