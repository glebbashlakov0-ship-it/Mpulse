import type { IncomingMessage, ServerResponse } from "node:http";
import { getConfig } from "../../src/config.js";
import {
  authorizeProductionCoinCutoverEndpoint,
  toSafeProductionCoinCutoverError,
  toSafeProductionCoinCutoverResult,
} from "../../src/productionCoinCutoverOps.js";

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
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
    const { runProductionCoinCutover } = await import(
      "../../scripts/productionCoinCutover.js"
    );
    const result = await runProductionCoinCutover(process.env);
    return sendJson(response, 200, {
      data: toSafeProductionCoinCutoverResult(result),
      error: null,
    });
  } catch (error) {
    console.error(
      "Production Coin cutover failed.",
      toSafeProductionCoinCutoverError(error),
    );
    return sendJson(response, 409, {
      data: null,
      error: {
        code: "PRODUCTION_COIN_CUTOVER_FAILED",
        message:
          "The production Coin cutover did not complete. Inspect restricted runtime logs and retained database evidence.",
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
