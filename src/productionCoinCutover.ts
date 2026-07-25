import { createHash } from "node:crypto";

export type ProductionCoinCutoverReleaseMarker = {
  enabled: boolean;
  releaseMarker: string;
  migrationVersion: string;
  vercelEnvironment: "production";
  expectedVercelProductionHost: string;
  databaseUrlEnvironment: "DATABASE_URL";
  expectedDatabaseTargetFingerprint: string;
};

export type ProductionDatabaseUrlTarget = {
  hostname: string;
  port: number;
  databaseName: string;
  databasePrincipalSha256: string;
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

  const resolved = resolveProductionDatabaseTarget(env);
  if (
    !/^[a-f0-9]{64}$/.test(marker.expectedDatabaseTargetFingerprint) ||
    marker.expectedDatabaseTargetFingerprint !== resolved.target.fingerprint
  ) {
    throw new Error(
      "Production Coin cutover blocked: DATABASE_URL target fingerprint does not match the committed release marker.",
    );
  }

  return {
    shouldRun: true,
    ...resolved,
  };
}

export function resolveProductionDatabaseTarget(env: NodeJS.ProcessEnv): {
  databaseUrl: string;
  databaseSsl: true;
  target: ProductionDatabaseUrlTarget;
} {
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
  return {
    databaseUrl,
    databaseSsl: true,
    target: deriveProductionDatabaseUrlTarget(databaseUrl),
  };
}

/**
 * Produces a stable, non-secret database identity. The database username is
 * hashed separately because Supabase transaction-pooler hosts and database
 * names are shared across projects. Neither this result nor guard errors expose
 * the username or password.
 */
export function deriveProductionDatabaseUrlTarget(
  databaseUrl: string,
): ProductionDatabaseUrlTarget {
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

  let databaseName: string;
  let databasePrincipal: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    databasePrincipal = decodeURIComponent(parsed.username);
  } catch {
    throw new Error(
      "Production Coin cutover blocked: DATABASE_URL contains invalid percent encoding.",
    );
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (
    !hostname ||
    !databaseName ||
    !databasePrincipal ||
    databaseName.includes("/") ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(
      "Production Coin cutover blocked: DATABASE_URL must identify one exact host, port, database, and database principal.",
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

  const databasePrincipalSha256 = createHash("sha256")
    .update(databasePrincipal)
    .digest("hex");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        hostname,
        port,
        databaseName,
        databasePrincipalSha256,
      }),
    )
    .digest("hex");

  return {
    hostname,
    port,
    databaseName,
    databasePrincipalSha256,
    fingerprint,
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
