import { getConfig } from "../src/config.js";

const vercelEnvironment = process.env.VERCEL_ENV?.trim() || null;

if (vercelEnvironment && vercelEnvironment !== "production") {
  console.log(
    JSON.stringify({
      ok: true,
      check: "runtime-environment",
      skipped: true,
      reason: "non-production-vercel-build",
      vercelEnvironment,
    }),
  );
} else {
  const config = getConfig();
  console.log(
    JSON.stringify({
      ok: true,
      check: "runtime-environment",
      skipped: false,
      nodeEnv: config.nodeEnv,
      vercelEnvironment,
      appMode: config.appMode,
      productionDeployment: config.productionDeployment,
      databaseConfigured: Boolean(config.databaseUrl),
      databaseSsl: config.databaseSsl,
      moneyOutboxWorkerEnabled: config.moneyOutboxWorkerEnabled,
      moneyOutboxDrainEndpointEnabled:
        config.moneyOutboxDrainEndpointEnabled,
      productionCoinCutoverEndpointEnabled:
        config.productionCoinCutoverEndpointEnabled,
    }),
  );
}
