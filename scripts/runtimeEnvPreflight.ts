import { getConfig } from "../src/config.js";

const config = getConfig();

console.log(
  JSON.stringify(
    {
      ok: true,
      check: "runtime-environment",
      nodeEnv: config.nodeEnv,
      vercelEnvironment: process.env.VERCEL_ENV?.trim() || null,
      appMode: config.appMode,
      productionDeployment: config.productionDeployment,
      databaseConfigured: Boolean(config.databaseUrl),
      databaseSsl: config.databaseSsl,
      moneyOutboxWorkerEnabled: config.moneyOutboxWorkerEnabled,
      moneyOutboxDrainEndpointEnabled:
        config.moneyOutboxDrainEndpointEnabled,
      productionCoinCutoverEndpointEnabled:
        config.productionCoinCutoverEndpointEnabled,
    },
    null,
    2,
  ),
);
