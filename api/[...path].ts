import type { IncomingMessage, ServerResponse } from "node:http";
import appHandler from "../src/server.js";
import cutoverHandler from "./ops/production-coin-cutover.js";
import identityHandler from "./ops/production-coin-cutover/identity.js";

export default function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const pathname = new URL(
    request.url ?? "/",
    "https://mpulse.vercel.app",
  ).pathname;
  if (pathname === "/api/ops/production-coin-cutover/identity") {
    return identityHandler(request, response);
  }
  if (pathname === "/api/ops/production-coin-cutover") {
    return cutoverHandler(request, response);
  }
  return appHandler(request, response);
}
