import type { IncomingMessage, ServerResponse } from "node:http";
import { getConfig } from "../../../src/config.js";
import {
  authorizeProductionCoinCutoverEndpoint,
  toSafeProductionCoinCutoverError,
  toSafeProductionDatabaseIdentity,
} from "../../../src/productionCoinCutoverOps.js";
import { resolveProductionDatabaseTarget } from "../../../src/productionCoinCutover.js";

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
  } catch (error) {
    console.error(
      "Production Coin cutover identity failed.",
      toSafeProductionCoinCutoverError(error),
    );
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
    const resolved = resolveProductionDatabaseTarget(process.env);
    return sendJson(response, 200, {
      data: {
        database: toSafeProductionDatabaseIdentity(resolved.target),
      },
      error: null,
    });
  } catch (error) {
    console.error(
      "Production Coin cutover identity resolution failed.",
      toSafeProductionCoinCutoverError(error),
    );
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
