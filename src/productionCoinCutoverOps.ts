import { timingSafeEqual } from "node:crypto";

type ProductionCoinCutoverEndpointConfig = {
  productionCoinCutoverEndpointEnabled: boolean;
  cronSecret: string | null;
};

export type ProductionCoinCutoverEndpointAccess =
  | { ok: true }
  | {
      ok: false;
      statusCode: 401 | 404 | 503;
      code: "UNAUTHORIZED" | "NOT_FOUND" | "PRODUCTION_RUNTIME_REQUIRED";
      message: string;
    };

export function authorizeProductionCoinCutoverEndpoint(input: {
  config: ProductionCoinCutoverEndpointConfig;
  vercelEnvironment: string | undefined;
  authorization: string | string[] | undefined;
}): ProductionCoinCutoverEndpointAccess {
  if (!input.config.productionCoinCutoverEndpointEnabled) {
    return {
      ok: false,
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Not found.",
    };
  }
  if (input.vercelEnvironment !== "production") {
    return {
      ok: false,
      statusCode: 503,
      code: "PRODUCTION_RUNTIME_REQUIRED",
      message: "The production Coin cutover endpoint is unavailable.",
    };
  }
  if (
    !hasValidBearerAuthorization(
      input.authorization,
      input.config.cronSecret,
    )
  ) {
    return {
      ok: false,
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized.",
    };
  }
  return { ok: true };
}

export function toSafeProductionDatabaseIdentity(input: {
  hostname: string;
  port: number;
  databaseName: string;
  fingerprint: string;
}) {
  return {
    hostname: input.hostname,
    port: input.port,
    databaseName: input.databaseName,
    fingerprint: input.fingerprint,
  };
}

export function toSafeProductionCoinCutoverResult(
  result:
    | {
        skipped: true;
        reason: "not-production";
      }
    | {
        skipped: false;
        releaseMarker: string;
        databaseTargetFingerprint: string;
        schemaMigrationsApplied: string[];
        schemaMigrationsSkipped: string[];
        reconciliation: {
          status: "passed" | "failed";
          discrepancyCount: number;
        };
        noOp: boolean;
      },
) {
  if (result.skipped) {
    return {
      status: "skipped" as const,
      reason: result.reason,
    };
  }
  return {
    status: "completed" as const,
    releaseMarker: result.releaseMarker,
    databaseTargetFingerprint: result.databaseTargetFingerprint,
    schemaMigrationsApplied: [...result.schemaMigrationsApplied],
    schemaMigrationsSkippedCount: result.schemaMigrationsSkipped.length,
    reconciliationStatus: result.reconciliation.status,
    reconciliationDiscrepancyCount:
      result.reconciliation.discrepancyCount,
    noOp: result.noOp,
  };
}

function hasValidBearerAuthorization(
  authorization: string | string[] | undefined,
  secret: string | null,
) {
  if (
    typeof authorization !== "string" ||
    !secret ||
    secret.length < 32
  ) {
    return false;
  }
  const provided = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}
