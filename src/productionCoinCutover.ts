import { createHash } from "node:crypto";

export type ProductionCoinCutoverReleaseMarker = {
  enabled: true;
  releaseMarker: string;
  migrationVersion: string;
  vercelEnvironment: "production";
  expectedVercelProductionHost: string;
  databaseUrlEnvironment: "DATABASE_URL";
};

export type ProductionDatabaseUrlTarget = {
  hostname: string;
  port: number;
  databaseName: string;
  fingerprint: string;
};

export type ProductionCoinCutoverGuardResult =
  | {
      shouldRun: false;
      reason: "not-production";
    }
  | {
      shouldRun: true;
      databaseUrl: string;
      databaseSsl: true;
      target: ProductionDatabaseUrlTarget;
    };

export function guardProductionCoinCutover(
  env: NodeJS.ProcessEnv,
  marker: ProductionCoinCutoverReleaseMarker,
  expectedMigrationVersion: string,
): ProductionCoinCutoverGuardResult {
  if (env.VERCEL_ENV !== "production") {
    return { shouldRun: false, reason: "not-production" };
  }

  if (
    marker.enabled !== true ||
    marker.vercelEnvironment !== "production" ||
    marker.databaseUrlEnvironment !== "DATABASE_URL" ||
    marker.migrationVersion !== expectedMigrationVersion ||
    !marker.releaseMarker.trim()
  ) {
    throw new Error(
      "Production Coin cutover blocked: committed release marker is invalid.",
    );
  }

  const productionHost = normalizeHost(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (productionHost !== marker.expectedVercelProductionHost) {
    throw new Error(
      "Production Coin cutover blocked: Vercel production project identity does not match the release marker.",
    );
  }

  if (env.TEST_DATABASE_URL?.trim()) {
    throw new Error(
      "Production Coin cutover blocked: TEST_DATABASE_URL must not be set.",
    );
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "Production Coin cutover blocked: DATABASE_URL is required.",
    );
  }
  if (!isTrue(env.DATABASE_SSL)) {
    throw new Error(
      "Production Coin cutover blocked: DATABASE_SSL must be true.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(
      "Production Coin cutover blocked: DATABASE_URL must be a valid PostgreSQL URL.",
    );
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(
      "Production Coin cutover blocked: DATABASE_URL must use postgres or postgresql.",
    );
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (
    !hostname ||
    !databaseName ||
    databaseName.includes("/") ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(
      "Production Coin cutover blocked: DATABASE_URL must identify one exact host, port, and database.",
    );
  }
  if (
    ["localhost", "127.0.0.1", "::1"].includes(hostname) ||
    ["template0", "template1"].includes(databaseName.toLowerCase()) ||
    (
      databaseName.toLowerCase() === "postgres" &&
      !hostname.endsWith(".supabase.com")
    ) ||
    /(^|[_-])(test|testing|ci)([_-]|$)/i.test(databaseName)
  ) {
    throw new Error(
      "Production Coin cutover blocked: DATABASE_URL points to a local, maintenance, or test-scoped target.",
    );
  }

  const fingerprint = createHash("sha256")
    .update(`${hostname}:${port}/${databaseName}`)
    .digest("hex");

  return {
    shouldRun: true,
    databaseUrl,
    databaseSsl: true,
    target: {
      hostname,
      port,
      databaseName,
      fingerprint,
    },
  };
}

function normalizeHost(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  try {
    const url = new URL(
      normalized.includes("://") ? normalized : `https://${normalized}`,
    );
    return url.hostname;
  } catch {
    return "";
  }
}

function isTrue(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(
    (value ?? "").trim().toLowerCase(),
  );
}
