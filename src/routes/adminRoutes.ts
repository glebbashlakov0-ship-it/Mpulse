import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, type AuthService, getAuthContext, requireAdmin, requireAdminRole, type AdminRole } from "../auth.js";
import { type AdminService } from "../admin.js";
import { type AuditService } from "../audit.js";
import type { AppConfig } from "../config.js";

function parseAdminLimit(value: unknown) {
  if (typeof value !== "string") {
    return 100;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
}

function buildUserRoleSummary(users: Array<{ role: string }>) {
  return users.reduce<Record<string, number>>(
    (summary, user) => ({
      ...summary,
      [user.role]: (summary[user.role] ?? 0) + 1,
    }),
    {
      user: 0,
      support: 0,
      compliance_admin: 0,
      finance_admin: 0,
      super_admin: 0,
    },
  );
}

export function registerAdminRoutes(
  app: FastifyInstance,
  auth: AuthService,
  audit: AuditService,
  admin: AdminService,
  config: AppConfig,
) {
  function adminPreHandler(roles?: AdminRole[]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (roles) {
        await requireAdminRole(roles)(request, reply, auth, config);
      } else {
        await requireAdmin(request, reply, auth, config);
      }

      if (reply.sent) {
        const context = getAuthContext(request);
        if (context) {
          await audit.record({
            eventType: "admin.rejected",
            userId: context.user.id,
            sessionId: context.session.id,
            metadata: {
              method: request.method,
              url: request.url,
              requiredRoles: roles ?? "any_admin",
              role: context.user.role,
              manualReview: true,
            },
          });
        }
      }
    };
  }

  app.get(
    "/api/admin/users",
    {
      preHandler: adminPreHandler(),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const users = await auth.listUsers(parseAdminLimit((request.query as { limit?: unknown }).limit));
      await audit.record({
        eventType: "admin.user_view",
        userId: context.user.id,
        sessionId: context.session.id,
        metadata: {
          count: users.length,
          manualReview: true,
        },
      });

      return {
        data: {
          mode: "core_admin_only",
          users,
          summary: buildUserRoleSummary(users),
        },
      };
    },
  );

  app.get(
    "/api/admin/audit-logs",
    {
      preHandler: adminPreHandler(),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      await audit.record({
        eventType: "admin.audit_view",
        userId: context.user.id,
        sessionId: context.session.id,
        metadata: {
          manualReview: true,
        },
      });
      const auditLogs = await audit.repository.listRecent(
        parseAdminLimit((request.query as { limit?: unknown }).limit),
      );

      return {
        data: {
          mode: "core_admin_only",
          auditLogs,
          hiddenMarkets: await admin.listHiddenMarkets(),
        },
      };
    },
  );

  app.get(
    "/api/admin/wallet-withdrawals",
    {
      preHandler: adminPreHandler(),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      await audit.record({
        eventType: "admin.audit_view",
        userId: context.user.id,
        sessionId: context.session.id,
        metadata: {
          resource: "wallet_withdrawals",
          manualReview: true,
        },
      });

      return {
        data: await admin.listWithdrawalRequests(
          parseAdminLimit((request.query as { limit?: unknown }).limit),
        ),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/wallet-withdrawals/:id/reject",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const result = await admin.reviewWithdrawal({
        id: request.params.id,
        status: "rejected",
      });
      await audit.record({
        eventType: "admin.withdrawal_review",
        userId: context.user.id,
        sessionId: context.session.id,
        metadata: {
          withdrawalRequestId: result.withdrawalRequest.id,
          status: result.withdrawalRequest.status,
          realTransferBlocked: true,
          ledgerMutationBlocked: true,
          manualReview: true,
        },
      });

      return {
        data: result,
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>(
    "/api/admin/markets/:id/hide",
    {
      preHandler: adminPreHandler(["compliance_admin", "super_admin"]),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const result = await admin.hideMarket({
        marketId: request.params.id,
        reason: request.body?.reason,
        adminUserId: context.user.id,
      });
      await audit.record({
        eventType: "admin.market_hide",
        userId: context.user.id,
        sessionId: context.session.id,
        metadata: {
          marketId: result.rule.marketId,
          reason: result.rule.reason,
          manualReview: true,
        },
      });

      return {
        data: result,
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/markets/:id/unhide",
    {
      preHandler: adminPreHandler(["compliance_admin", "super_admin"]),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const result = await admin.unhideMarket({
        marketId: request.params.id,
        adminUserId: context.user.id,
      });
      await audit.record({
        eventType: "admin.market_unhide",
        userId: context.user.id,
        sessionId: context.session.id,
        metadata: {
          marketId: request.params.id,
          ruleId: result.rule?.id ?? null,
          manualReview: true,
        },
      });

      return {
        data: result,
      };
    },
  );
}
