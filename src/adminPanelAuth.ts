import type { FastifyReply, FastifyRequest } from "fastify";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AdminRole } from "./auth.js";
import type { AppConfig } from "./config.js";

export type AdminPanelSession = {
  id: string;
  username: string;
  role: Extract<AdminRole, "super_admin">;
  createdAt: string;
  expiresAt: string;
};

export class AdminPanelAuthError extends Error {
  constructor(
    public readonly code:
      | "ADMIN_PANEL_UNAUTHENTICATED"
      | "ADMIN_PANEL_INVALID_LOGIN"
      | "ADMIN_PANEL_UNAVAILABLE",
    message: string,
    public readonly statusCode = 401,
  ) {
    super(message);
  }
}

export function buildAdminPanelAuthService(config: AppConfig) {
  function login(input: { username?: unknown; password?: unknown }) {
    const username = typeof input.username === "string" ? input.username.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";

    if (!config.adminPanelUsername || !config.adminPanelPassword) {
      throw new AdminPanelAuthError(
        "ADMIN_PANEL_UNAVAILABLE",
        "Admin panel credentials are not configured.",
        503,
      );
    }

    if (
      !constantTimeEquals(username, config.adminPanelUsername) ||
      !constantTimeEquals(password, config.adminPanelPassword)
    ) {
      throw new AdminPanelAuthError(
        "ADMIN_PANEL_INVALID_LOGIN",
        "Invalid admin login or password.",
      );
    }

    const now = Date.now();
    const session: AdminPanelSession = {
      id: randomUUID(),
      username: config.adminPanelUsername,
      role: "super_admin",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + config.adminPanelTtlMs).toISOString(),
    };

    return {
      session,
      token: signSession(session, config),
    };
  }

  function authenticate(request: FastifyRequest) {
    const token = getCookieValue(request, config.adminPanelCookieName);
    if (!token) {
      return null;
    }

    return verifySession(token, config);
  }

  function requireSession(request: FastifyRequest, reply: FastifyReply) {
    const session = authenticate(request);
    if (!session) {
      reply.status(401).send({
        data: null,
        error: {
          code: "ADMIN_PANEL_UNAUTHENTICATED",
          message: "Admin login is required.",
        },
      });
      return null;
    }

    (request as FastifyRequest & { adminPanel?: AdminPanelSession }).adminPanel = session;
    return session;
  }

  function setCookie(reply: FastifyReply, token: string) {
    const maxAgeSeconds = Math.floor(config.adminPanelTtlMs / 1000);
    const secure = config.sessionCookieSecure ? "; Secure" : "";
    reply.header(
      "Set-Cookie",
      `${config.adminPanelCookieName}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/api/admin; HttpOnly; SameSite=Lax${secure}`,
    );
  }

  function clearCookie(reply: FastifyReply) {
    const secure = config.sessionCookieSecure ? "; Secure" : "";
    reply.header(
      "Set-Cookie",
      `${config.adminPanelCookieName}=; Max-Age=0; Path=/api/admin; HttpOnly; SameSite=Lax${secure}`,
    );
  }

  return {
    login,
    authenticate,
    requireSession,
    setCookie,
    clearCookie,
  };
}

export type AdminPanelAuthService = ReturnType<typeof buildAdminPanelAuthService>;

export function getAdminPanelSession(request: FastifyRequest) {
  return (request as FastifyRequest & { adminPanel?: AdminPanelSession }).adminPanel ?? null;
}

function signSession(session: AdminPanelSession, config: AppConfig) {
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function verifySession(token: string, config: AppConfig) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("base64url");
  if (!constantTimeEquals(signature, expected)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminPanelSession;
    if (
      !session ||
      typeof session.id !== "string" ||
      typeof session.username !== "string" ||
      session.role !== "super_admin" ||
      typeof session.expiresAt !== "string" ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function getCookieValue(request: FastifyRequest, cookieName: string) {
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

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
