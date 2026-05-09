import type { FastifyInstance } from "fastify";
import { type AuthService, getAuthContext, requireAuth } from "../auth.js";
import { type ComplianceService } from "../compliance.js";
import type { AppConfig } from "../config.js";

export function registerComplianceRoutes(
  app: FastifyInstance,
  auth: AuthService,
  compliance: ComplianceService,
  config: AppConfig,
) {
  app.get(
    "/api/compliance/me",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new Error("Authentication context missing");
      }

      return {
        data: await compliance.getMe(context.user.id),
      };
    },
  );

  app.patch<{
    Body: unknown;
  }>(
    "/api/compliance/me",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new Error("Authentication context missing");
      }

      return {
        data: await compliance.updateProfile({
          userId: context.user.id,
          sessionId: context.session.id,
          body: request.body,
        }),
      };
    },
  );

  app.post<{
    Body: unknown;
  }>(
    "/api/compliance/accept-terms",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new Error("Authentication context missing");
      }

      return {
        data: await compliance.acceptTerms({
          userId: context.user.id,
          sessionId: context.session.id,
          body: request.body,
        }),
      };
    },
  );

  app.get(
    "/api/compliance/eligibility",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new Error("Authentication context missing");
      }

      return {
        data: await compliance.getEligibility({
          userId: context.user.id,
          sessionId: context.session.id,
        }),
      };
    },
  );
}
