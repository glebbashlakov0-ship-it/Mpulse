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
  } finally {
    await app.close();
  }
});
