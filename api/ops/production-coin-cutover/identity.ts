import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { getConfig } from "../../../src/config.js";
import {
  authorizeProductionCoinCutoverEndpoint,
  toSafeProductionDatabaseIdentity,
} from "../../../src/productionCoinCutoverOps.js";
import {
  guardProductionCoinCutover,
  type ProductionCoinCutoverReleaseMarker,
} from "../../../src/productionCoinCutover.js";

const markerPath = join(
  process.cwd(),
  "releases",
  "2026-07-25-coins-v1-production-cutover.json",
);

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    return sendJson(response, 405, {
      data: null,
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." },
    });
  }

  let config;
  try {
    config = getConfig();
  } catch {
    return sendJson(response, 503, {
      data: null,
      error: {
        code: "CUTOVER_ENDPOINT_CONFIGURATION_ERROR",
        message: "The production Coin cutover endpoint is unavailable.",
      },
    });
  }

  const access = authorizeProductionCoinCutoverEndpoint({
    config,
    vercelEnvironment: process.env.VERCEL_ENV,
    authorization: request.headers.authorization,
  });
  if (!access.ok) {
    return sendJson(response, access.statusCode, {
      data: null,
      error: { code: access.code, message: access.message },
    });
  }

  try {
    const marker = JSON.parse(
      await readFile(markerPath, "utf8"),
    ) as ProductionCoinCutoverReleaseMarker;
    const guarded = guardProductionCoinCutover(
      process.env,
      marker,
      "coins-v1-legacy-usdt-parity",
    );
    if (!guarded.shouldRun) {
      throw new Error("Production guard did not resolve a database target.");
    }
    return sendJson(response, 200, {
      data: {
        database: toSafeProductionDatabaseIdentity(guarded.target),
      },
      error: null,
    });
  } catch {
    return sendJson(response, 503, {
      data: null,
      error: {
        code: "CUTOVER_IDENTITY_UNAVAILABLE",
        message: "The production database identity could not be verified.",
      },
    });
  }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
