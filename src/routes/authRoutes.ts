import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AuthError,
  type AuthService,
  clearSessionCookie,
  getAuthContext,
  getSessionTokenFromRequest,
  requireAuth,
  setSessionCookie,
} from "../auth.js";
import { type AuditService } from "../audit.js";
import type { AppConfig } from "../config.js";
import { RATE_LIMIT_MESSAGE, buildAuthRateLimitKeys, type AuthRateLimiter } from "../rateLimit.js";
import type { VerificationService } from "../authVerification.js";
import type { TwoFactorService } from "../authTwoFactor.js";
import { createCsrfToken, setCsrfCookie } from "../csrf.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  audit: AuditService,
  config: AppConfig,
  authRateLimiter: AuthRateLimiter,
  verification: VerificationService,
  twoFactor: TwoFactorService,
) {
  async function checkAuthRateLimit({
    request,
    reply,
    endpoint,
    email,
  }: {
    request: FastifyRequest;
    reply: FastifyReply;
    endpoint: string;
    email?: string | null;
  }) {
    let result;
    try {
      result = await authRateLimiter.check(
        buildAuthRateLimitKeys({
          request,
          endpoint,
          email,
        }),
      );
    } catch {
      reply.status(503).send({
        data: null,
        error: {
          code: "RATE_LIMIT_UNAVAILABLE",
          message: "Rate limit service is unavailable.",
        },
      });
      return false;
    }

    if (!result.ok) {
      reply.status(429).send({
        data: null,
        error: {
          code: "RATE_LIMITED",
          message: RATE_LIMIT_MESSAGE,
          retryAfterMs: result.retryAfterMs,
        },
      });
      return false;
    }

    return true;
  }

  app.get("/api/auth/csrf", async (_request, reply) => {
    const token = createCsrfToken(config);
    setCsrfCookie(reply, config, token);

    return {
      data: {
        csrfToken: token,
      },
    };
  });

  app.post<{
    Body: {
      email?: unknown;
    };
  }>(
    "/api/auth/lookup",
    {
      preHandler: async (request, reply) => {
        const allowed = await checkAuthRateLimit({
          request,
          reply,
          endpoint: "POST /api/auth/lookup",
          email:
            request.body && typeof request.body.email === "string" ? request.body.email : null,
        });

        if (!allowed) {
          return;
        }
      },
    },
    async (request, reply) => {
      const email =
        typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";

      if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.status(400).send({
          data: null,
          error: {
            code: "INVALID_EMAIL",
            message: "Enter a valid email address.",
          },
        });
      }

      const user = await auth.repositories.users.findUserByEmail(email);

      return {
        data: {
          exists: Boolean(user),
        },
      };
    },
  );

  app.post<{
    Body: {
      email?: unknown;
      password?: unknown;
      displayName?: unknown;
    };
  }>(
    "/api/auth/register",
    {
      preHandler: async (request, reply) => {
        await checkAuthRateLimit({
          request,
          reply,
          endpoint: "POST /api/auth/register",
        });
      },
    },
    async (request, reply) => {
      const result = await auth.register({
        ...(request.body ?? {}),
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      setSessionCookie(reply, config, result.session.token);
      await audit.record({
        eventType: "auth.register",
        userId: result.user.id,
        sessionId: result.session.session.id,
      });

      // Send verification email after registration
      await verification.sendVerificationEmail(
        result.user.id,
        result.user.email,
        result.user.displayName,
      );

      return {
        data: {
          user: result.user,
        },
      };
    },
  );

  app.post<{
    Body: {
      token?: unknown;
    };
  }>("/api/auth/verify-email", async (request, reply) => {
    const token = typeof request.body?.token === "string" ? request.body.token : "";
    
    const result = await verification.verifyEmail(token);
    const user = await auth.repositories.users.markEmailVerified(result.userId);
    
    if (!user) {
      return reply.status(404).send({
        data: null,
        error: {
          code: "USER_NOT_FOUND",
          message: "User not found.",
        },
      });
    }

    await audit.record({
      eventType: "auth.email_verified",
      userId: result.userId,
    });

    return {
      data: {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
        },
      },
    };
  });

  app.post(
    "/api/auth/resend-verification",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      await verification.sendVerificationEmail(
        context.user.id,
        context.user.email,
        context.user.displayName,
      );
      await audit.record({
        eventType: "auth.email_verification_requested",
        userId: context.user.id,
        sessionId: context.session.id,
      });

      return {
        data: {
          success: true,
        },
      };
    },
  );

  app.post<{
    Body: {
      email?: unknown;
    };
  }>(
    "/api/auth/request-password-reset",
    {
      preHandler: async (request, reply) => {
        await checkAuthRateLimit({
          request,
          reply,
          endpoint: "POST /api/auth/request-password-reset",
          email:
            request.body && typeof request.body.email === "string" ? request.body.email : null,
        });
      },
    },
    async (request, reply) => {
      const email = typeof request.body?.email === "string" ? request.body.email : "";
      const user = await auth.repositories.users.findUserByEmail(email);

      // Always return success to prevent email enumeration
      if (!user) {
        return {
          data: {
            success: true,
            message: "If the email exists, a password reset link has been sent.",
          },
        };
      }

      await verification.sendPasswordResetEmail(user.id, user.email, user.displayName);
      await audit.record({
        eventType: "auth.password_reset_requested",
        userId: user.id,
      });

      return {
        data: {
          success: true,
          message: "If the email exists, a password reset link has been sent.",
        },
      };
    },
  );

  app.post<{
    Body: {
      token?: unknown;
      password?: unknown;
    };
  }>(
    "/api/auth/reset-password",
    {
      preHandler: async (request, reply) => {
        await checkAuthRateLimit({
          request,
          reply,
          endpoint: "POST /api/auth/reset-password",
        });
      },
    },
    async (request, reply) => {
      const token = typeof request.body?.token === "string" ? request.body.token : "";
      const password = typeof request.body?.password === "string" ? request.body.password : "";

      // Validate password format
      if (
        password.length < 10 ||
        password.length > 200 ||
        !/[A-Za-z]/.test(password) ||
        !/[0-9]/.test(password)
      ) {
        return reply.status(400).send({
          data: null,
          error: {
            code: "INVALID_PASSWORD",
            message: "Password must be 10-200 characters and include letters and numbers.",
          },
        });
      }

      const result = await verification.verifyPasswordResetToken(token);
      
      await auth.updatePassword(result.userId, password);

      await audit.record({
        eventType: "auth.password_reset",
        userId: result.userId,
      });

      return {
        data: {
          success: true,
        },
      };
    },
  );

  app.post<{
    Body: {
      email?: unknown;
      password?: unknown;
      twoFactorCode?: unknown;
    };
  }>(
    "/api/auth/login",
    {
      preHandler: async (request, reply) => {
        await checkAuthRateLimit({
          request,
          reply,
          endpoint: "POST /api/auth/login",
          email:
            request.body && typeof request.body.email === "string" ? request.body.email : null,
        });
      },
    },
    async (request, reply) => {
      const result = await auth.login({
        ...(request.body ?? {}),
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      setSessionCookie(reply, config, result.session.token);
      await audit.record({
        eventType: "auth.login",
        userId: result.user.id,
        sessionId: result.session.session.id,
      });

      return {
        data: {
          user: result.user,
        },
      };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = getSessionTokenFromRequest(request, config.sessionCookieName);
    const context = await auth.authenticateToken(token);
    if (context) {
      await audit.record({
        eventType: "auth.logout",
        userId: context.user.id,
        sessionId: context.session.id,
      });
      await auth.deleteSession(context.session.id);
    }
    clearSessionCookie(reply, config);

    return {
      data: {
        ok: true,
      },
    };
  });

  app.get("/api/auth/me", async (request, reply) => {
    const context = await auth.authenticateToken(
      getSessionTokenFromRequest(request, config.sessionCookieName),
    );

    if (!context) {
      return reply.status(401).send({
        data: null,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required.",
        },
      });
    }

    return {
      data: {
        user: context.user,
      },
    };
  });

  app.get("/api/auth/session", async (request) => {
    const context = await auth.authenticateToken(
      getSessionTokenFromRequest(request, config.sessionCookieName),
    );

    return {
      data: {
        user: context?.user ?? null,
      },
    };
  });

  app.get(
    "/api/auth/sessions",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const sessions = await auth.listSessions(context.user.id);
      return {
        data: {
          sessions: sessions.map((session) => ({
            id: session.id,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            lastSeenAt: session.lastSeenAt,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
            current: session.id === context.session.id,
          })),
        },
      };
    },
  );

  app.delete<{
    Params: { id: string };
  }>(
    "/api/auth/sessions/:id",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const sessions = await auth.listSessions(context.user.id);
      const targetSession = sessions.find((session) => session.id === request.params.id);
      if (!targetSession) {
        throw new AuthError("SESSION_NOT_FOUND", "Session was not found.", 404);
      }

      if (targetSession.id === context.session.id) {
        clearSessionCookie(reply, config);
      }

      await audit.record({
        eventType: "auth.session_revoked",
        userId: context.user.id,
        sessionId: context.session.id,
        metadata: { revokedSessionId: targetSession.id },
      });
      await auth.deleteSession(targetSession.id);

      return {
        data: {
          ok: true,
        },
      };
    },
  );

  app.post(
    "/api/auth/sessions/revoke-others",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      await auth.deleteOtherSessions(context.user.id, context.session.id);
      await audit.record({
        eventType: "auth.sessions_revoked",
        userId: context.user.id,
        sessionId: context.session.id,
        metadata: { currentSessionId: context.session.id },
      });

      return {
        data: {
          ok: true,
        },
      };
    },
  );

  app.post(
    "/api/auth/sessions/revoke-all",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      await audit.record({
        eventType: "auth.sessions_revoked_all",
        userId: context.user.id,
        sessionId: context.session.id,
        metadata: { currentSessionId: context.session.id },
      });
      await auth.deleteSessionsByUserId(context.user.id);
      clearSessionCookie(reply, config);

      return {
        data: {
          ok: true,
        },
      };
    },
  );

  app.get(
    "/api/auth/2fa",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      return {
        data: await twoFactor.getStatus(context.user.id),
      };
    },
  );

  app.post(
    "/api/auth/2fa/setup",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      await audit.record({
        eventType: "auth.two_factor_setup_started",
        userId: context.user.id,
        sessionId: context.session.id,
      });

      return {
        data: await twoFactor.startSetup(context.user),
      };
    },
  );

  app.post<{
    Body: { code?: unknown };
  }>(
    "/api/auth/2fa/confirm",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const data = await twoFactor.confirm(
        context.user.id,
        typeof request.body?.code === "string" ? request.body.code : "",
      );
      await audit.record({
        eventType: "auth.two_factor_enabled",
        userId: context.user.id,
        sessionId: context.session.id,
      });

      return { data };
    },
  );

  app.post<{
    Body: { code?: unknown };
  }>(
    "/api/auth/2fa/disable",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const data = await twoFactor.disable(
        context.user.id,
        typeof request.body?.code === "string" ? request.body.code : "",
      );
      await audit.record({
        eventType: "auth.two_factor_disabled",
        userId: context.user.id,
        sessionId: context.session.id,
      });

      return { data };
    },
  );

  app.post<{
    Body: { code?: unknown };
  }>(
    "/api/auth/2fa/backup-codes/regenerate",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const result = await twoFactor.regenerateBackupCodes(
        context.user.id,
        typeof request.body?.code === "string" ? request.body.code : "",
      );
      await audit.record({
        eventType: "auth.two_factor_backup_codes_regenerated",
        userId: context.user.id,
        sessionId: context.session.id,
      });

      return {
        data: result,
      };
    },
  );
  app.patch<{
    Body: unknown;
  }>(
    "/api/users/me/settings",
    {
      preHandler: [
        async (request, reply) => {
          await checkAuthRateLimit({
            request,
            reply,
            endpoint: "PATCH /api/users/me/settings",
          });
        },
        (request, reply) => requireAuth(request, reply, auth, config),
      ],
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new Error("Authentication context missing");
      }
      const user = await auth.updateSettings(context.user.id, request.body);
      await audit.record({
        eventType: "user.settings_update",
        userId: context.user.id,
        sessionId: context.session.id,
      });

      return {
        data: {
          user,
        },
      };
    },
  );
}
