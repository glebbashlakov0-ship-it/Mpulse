import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";

export const CSRF_HEADER_NAME = "x-csrf-token";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isStateChangingMethod(method: string) {
  return unsafeMethods.has(method.toUpperCase());
}

export function createCsrfToken(config: AppConfig) {
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${signCsrfNonce(config, nonce)}`;
}

export function setCsrfCookie(reply: FastifyReply, config: AppConfig, token: string) {
  const secure = config.sessionCookieSecure ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${config.csrfCookieName}=${encodeURIComponent(token)}; Path=/; SameSite=Lax${secure}`,
  );
}

export function getCookieValue(request: FastifyRequest, cookieName: string) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  for (const cookiePart of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookiePart.trim().split("=");
    if (rawName === cookieName) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function validateCsrfRequest(request: FastifyRequest, config: AppConfig) {
  const header = request.headers[CSRF_HEADER_NAME];
  const headerToken = Array.isArray(header) ? header[0] : header;
  const cookieToken = getCookieValue(request, config.csrfCookieName);

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return false;
  }

  return verifyCsrfToken(config, headerToken);
}

function signCsrfNonce(config: AppConfig, nonce: string) {
  return createHmac("sha256", `${config.sessionSecret}:csrf`).update(nonce).digest("base64url");
}

function verifyCsrfToken(config: AppConfig, token: string) {
  const [nonce, signature] = token.split(".");
  if (!nonce || !signature) {
    return false;
  }

  const expected = Buffer.from(signCsrfNonce(config, nonce));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
