import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type AuthService, type AdminRole } from "../auth.js";
import { type AdminService } from "../admin.js";
import { type AuditService } from "../audit.js";
import type { AppConfig } from "../config.js";
import { createCsrfToken, setCsrfCookie } from "../csrf.js";
import {
  AdminPanelAuthError,
  getAdminPanelSession,
  type AdminPanelAuthService,
} from "../adminPanelAuth.js";
import type { SettlementService } from "../settlement.js";
import type { CoinWalletService } from "../coinWallets.js";
import { MarketSeedError, type MarketSeedService } from "../marketSeedService.js";

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
  settlement?: SettlementService,
  marketSeed?: MarketSeedService,
  adminPanelAuth?: AdminPanelAuthService,
  coinWallets?: CoinWalletService | null,
) {
  if (!adminPanelAuth) {
    throw new Error("Admin panel auth service is required.");
  }
  const panelAuth = adminPanelAuth;

  function getActor(request: FastifyRequest) {
    const session = getAdminPanelSession(request);
    if (!session) {
      throw new AdminPanelAuthError(
        "ADMIN_PANEL_UNAUTHENTICATED",
        "Admin login is required.",
      );
    }

    return {
      username: session.username,
      role: session.role,
      dbUserId: null as string | null,
      auditUserId: null as string | null,
      auditSessionId: null as string | null,
    };
  }

  function adminPreHandler(roles?: AdminRole[]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const session = panelAuth.requireSession(request, reply);
      if (!session) {
        return;
      }

      if (roles && !roles.includes(session.role)) {
        await audit.record({
          eventType: "admin.rejected",
          userId: null,
          sessionId: null,
          metadata: {
            method: request.method,
            url: request.url,
            requiredRoles: roles,
            role: session.role,
            adminUsername: session.username,
            manualReview: true,
          },
        });
        reply.status(403).send({
          data: null,
          error: {
            code: "ADMIN_PANEL_ROLE_FORBIDDEN",
            message: "This admin login is not allowed for this action.",
          },
        });
      }
    };
  }

  app.get("/api/admin/csrf", async (_request, reply) => {
    const token = createCsrfToken(config);
    setCsrfCookie(reply, config, token);

    return {
      data: {
        csrfToken: token,
      },
    };
  });

  app.get("/api/admin/session", async (request) => {
    const session = panelAuth.authenticate(request);

    return {
      data: {
        authenticated: Boolean(session),
        admin: session
          ? {
              username: session.username,
              role: session.role,
              expiresAt: session.expiresAt,
            }
          : null,
      },
    };
  });

  app.post<{
    Body: { username?: unknown; password?: unknown };
  }>("/api/admin/login", async (request, reply) => {
    const result = panelAuth.login(request.body ?? {});
    panelAuth.setCookie(reply, result.token);
    await audit.record({
      eventType: "admin.login",
      userId: null,
      sessionId: null,
      metadata: {
        adminUsername: result.session.username,
        manualReview: true,
      },
    });

    return {
      data: {
        authenticated: true,
        admin: {
          username: result.session.username,
          role: result.session.role,
          expiresAt: result.session.expiresAt,
        },
      },
    };
  });

  app.post("/api/admin/logout", async (request, reply) => {
    const session = panelAuth.authenticate(request);
    panelAuth.clearCookie(reply);
    await audit.record({
      eventType: "admin.logout",
      userId: null,
      sessionId: null,
      metadata: {
        adminUsername: session?.username ?? null,
        manualReview: true,
      },
    });

    return {
      data: {
        authenticated: false,
        admin: null,
      },
    };
  });

  app.get(
    "/api/admin/users",
    {
      preHandler: adminPreHandler(),
    },
    async (request, reply) => {
      const actor = getActor(request);

      const users = await auth.listUsers(parseAdminLimit((request.query as { limit?: unknown }).limit));
      await audit.record({
        eventType: "admin.user_view",
        userId: actor.auditUserId,
        sessionId: actor.auditSessionId,
        metadata: {
          adminUsername: actor.username,
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
      const actor = getActor(request);

      await audit.record({
        eventType: "admin.audit_view",
        userId: actor.auditUserId,
        sessionId: actor.auditSessionId,
        metadata: {
          adminUsername: actor.username,
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
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      const actor = getActor(request);

      await audit.record({
        eventType: "admin.audit_view",
        userId: actor.auditUserId,
        sessionId: actor.auditSessionId,
        metadata: {
          adminUsername: actor.username,
          resource: "wallet_withdrawals",
          manualReview: true,
        },
      });

      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Admin Coin withdrawal views require PostgreSQL.",
          },
        });
      }
      return {
        data: {
          withdrawalRequests: await coinWallets.listAdminWithdrawals(
            parseAdminLimit((request.query as { limit?: unknown }).limit),
          ),
          reviewOnly: true,
        },
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>(
    "/api/admin/wallet-withdrawals/:id/reject",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      const actor = getActor(request);
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Coin withdrawal rejection requires PostgreSQL.",
          },
        });
      }
      return {
        data: await coinWallets.rejectWithdrawal({
          withdrawalId: request.params.id,
          adminActor: actor.username,
          reason: request.body?.reason,
        }),
      };
    },
  );

  app.get(
    "/api/admin/wallet-deposit-requests",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      const actor = getActor(request);
      await audit.record({
        eventType: "admin.deposit_request_view",
        userId: actor.auditUserId,
        sessionId: actor.auditSessionId,
        metadata: {
          adminUsername: actor.username,
          resource: "wallet_deposit_requests",
          manualReview: true,
        },
      });
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Admin Coin deposit views require PostgreSQL.",
          },
        });
      }
      return {
        data: {
          deposits: await coinWallets.listAdminDeposits(
            parseAdminLimit((request.query as { limit?: unknown }).limit),
          ),
          reviewOnly: true,
        },
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/wallet-deposit-requests/:id/approve",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (_request, reply) =>
      reply.status(410).send({
        data: null,
        error: {
          code: "LEGACY_ADMIN_DEPOSIT_CREDIT_RETIRED",
          message:
            "Direct manual deposit credits are retired; retry a verified crypto deposit or create a compensating correction.",
        },
      }),
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/wallet-deposit-requests/:id/reject",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (_request, reply) =>
      reply.status(410).send({
        data: null,
        error: {
          code: "LEGACY_ADMIN_DEPOSIT_REVIEW_RETIRED",
          message:
            "Legacy deposit review is retired; use the verified crypto-deposit money endpoints.",
        },
      }),
  );

  app.get<{ Params: { userId: string } }>(
    "/api/admin/money/users/:userId",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Admin Coin money views require PostgreSQL.",
          },
        });
      }
      return { data: await coinWallets.getAdminMoneyUser(request.params.userId) };
    },
  );

  app.post<{
    Params: { userId: string };
    Body: {
      deltaCoinMicros?: unknown;
      idempotencyKey?: unknown;
      reason?: unknown;
      relatedEntityType?: unknown;
      relatedEntityId?: unknown;
    };
  }>(
    "/api/admin/money/users/:userId/corrections",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Coin corrections require PostgreSQL.",
          },
        });
      }
      const actor = getActor(request);
      return {
        data: await coinWallets.createCorrection({
          userId: request.params.userId,
          deltaCoinMicros: request.body?.deltaCoinMicros,
          idempotencyKey: getIdempotencyKey(request, request.body),
          adminActor: actor.username,
          reason: request.body?.reason,
          relatedEntityType: request.body?.relatedEntityType,
          relatedEntityId: request.body?.relatedEntityId,
        }),
      };
    },
  );

  app.get(
    "/api/admin/money/deposits",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Admin crypto deposit views require PostgreSQL.",
          },
        });
      }
      return {
        data: {
          deposits: await coinWallets.listAdminDeposits(
            parseAdminLimit((request.query as { limit?: unknown }).limit),
          ),
          reviewOnly: true,
        },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/admin/money/deposits/:id",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Crypto deposit detail requires PostgreSQL.",
          },
        });
      }
      return { data: await coinWallets.getAdminDepositDetail(request.params.id) };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>(
    "/api/admin/money/deposits/:id/retry",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Crypto deposit retry requires PostgreSQL.",
          },
        });
      }
      const actor = getActor(request);
      return {
        data: await coinWallets.retryDeposit({
          depositId: request.params.id,
          adminActor: actor.username,
          reason: request.body?.reason,
        }),
      };
    },
  );

  app.get(
    "/api/admin/money/withdrawals",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Admin Coin withdrawal views require PostgreSQL.",
          },
        });
      }
      return {
        data: {
          withdrawalRequests: await coinWallets.listAdminWithdrawals(
            parseAdminLimit((request.query as { limit?: unknown }).limit),
          ),
          reviewOnly: true,
        },
      };
    },
  );

  for (const action of ["approve", "reject", "retry"] as const) {
    app.post<{ Params: { id: string }; Body: { reason?: unknown } }>(
      `/api/admin/money/withdrawals/:id/${action}`,
      {
        preHandler: adminPreHandler(["finance_admin", "super_admin"]),
      },
      async (request, reply) => {
        if (!coinWallets) {
          return reply.status(503).send({
            data: null,
            error: {
              code: "COIN_WALLET_DATABASE_REQUIRED",
              message: "Coin withdrawal review requires PostgreSQL.",
            },
          });
        }
        const actor = getActor(request);
        const input = {
          withdrawalId: request.params.id,
          adminActor: actor.username,
          reason: request.body?.reason,
        };
        const data =
          action === "approve"
            ? await coinWallets.approveWithdrawalForReview(input)
            : action === "reject"
              ? await coinWallets.rejectWithdrawal(input)
              : await coinWallets.safeRetryWithdrawal(input);
        return { data };
      },
    );
  }

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>(
    "/api/admin/markets/:id/hide",
    {
      preHandler: adminPreHandler(["compliance_admin", "super_admin"]),
    },
    async (request) => {
      const actor = getActor(request);

      const result = await admin.hideMarket({
        marketId: request.params.id,
        reason: request.body?.reason,
        adminUserId: actor.dbUserId,
      });
      await audit.record({
        eventType: "admin.market_hide",
        userId: actor.auditUserId,
        sessionId: actor.auditSessionId,
        metadata: {
          adminUsername: actor.username,
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
      const actor = getActor(request);

      const result = await admin.unhideMarket({
        marketId: request.params.id,
        adminUserId: actor.dbUserId,
      });
      await audit.record({
        eventType: "admin.market_unhide",
        userId: actor.auditUserId,
        sessionId: actor.auditSessionId,
        metadata: {
          adminUsername: actor.username,
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

  app.post<{
    Params: { id: string };
    Body: { force?: unknown; points?: unknown; volatility?: unknown };
  }>(
    "/api/admin/markets/:id/seed-odds-history",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      const actor = getActor(request);

      if (!marketSeed) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "MARKET_SEED_UNAVAILABLE",
            message: "Market seed service is unavailable.",
          },
        });
      }

      try {
        const result = await marketSeed.seedOddsHistory({
          marketId: request.params.id,
          adminUserId: actor.dbUserId,
          options: request.body,
        });

        await audit.record({
          eventType: "admin.market_seed_odds",
          userId: actor.auditUserId,
          sessionId: actor.auditSessionId,
          metadata: {
            adminUsername: actor.username,
            marketId: request.params.id,
            scope: result.scope,
            created: result.created,
            pointCount: result.pointCount,
            manualReview: true,
          },
        });

        return {
          data: result,
        };
      } catch (error) {
        if (error instanceof MarketSeedError) {
          return reply.status(error.statusCode).send({
            data: null,
            error: {
              code: error.code,
              message: error.message,
            },
          });
        }

        throw error;
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { outcomes?: unknown; reason?: unknown };
  }>(
    "/api/admin/markets/:id/odds",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      const actor = getActor(request);

      if (!marketSeed) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "MARKET_SEED_UNAVAILABLE",
            message: "Market seed service is unavailable.",
          },
        });
      }

      try {
        const result = await marketSeed.overrideOdds({
          marketId: request.params.id,
          adminUserId: actor.dbUserId,
          body: request.body,
        });

        await audit.record({
          eventType: "admin.market_odds_override",
          userId: actor.auditUserId,
          sessionId: actor.auditSessionId,
          metadata: {
            adminUsername: actor.username,
            marketId: request.params.id,
            scope: result.scope,
            pointId: result.point.id,
            reason: typeof request.body?.reason === "string" ? request.body.reason : null,
            manualReview: true,
          },
        });

        return {
          data: result,
        };
      } catch (error) {
        if (error instanceof MarketSeedError) {
          return reply.status(error.statusCode).send({
            data: null,
            error: {
              code: error.code,
              message: error.message,
            },
          });
        }

        throw error;
      }
    },
  );

  app.post<{
    Body: {
      batchId?: unknown;
      marketIds?: unknown;
      filters?: unknown;
      userIds?: unknown;
      betsPerEventMin?: unknown;
      betsPerEventMax?: unknown;
      betAmountMin?: unknown;
      betAmountMax?: unknown;
      depositAmountMin?: unknown;
      depositAmountMax?: unknown;
      depositBufferMultiplier?: unknown;
      startAt?: unknown;
      endAt?: unknown;
      publicActivity?: unknown;
      force?: unknown;
    };
  }>(
    "/api/admin/markets/seed-event-activity",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (_request, reply) =>
      reply.status(410).send({
        data: null,
        error: {
          code: "LEGACY_EVENT_MONEY_SEED_RETIRED",
          message: "The legacy event money seed is retired after the Coin ledger cutover.",
        },
      }),
  );

  app.post<{
    Body: {
      userIds?: unknown;
      kind?: unknown;
      amountMin?: unknown;
      amountMax?: unknown;
      count?: unknown;
      startAt?: unknown;
      endAt?: unknown;
      publicActivity?: unknown;
    };
  }>(
    "/api/admin/ledger/seed-activity",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (_request, reply) =>
      reply.status(410).send({
        data: null,
        error: {
          code: "LEGACY_LEDGER_ACTIVITY_SEED_RETIRED",
          message: "The legacy ledger activity seed is retired after the Coin ledger cutover.",
        },
      }),
  );

  app.post<{ Params: { id: string }; Body: { winningSide?: unknown; idempotencyKey?: unknown } }>(
    "/api/admin/markets/:id/resolve",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      const actor = getActor(request);

      if (!settlement || !coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_SETTLEMENT_DATABASE_REQUIRED",
            message: "Coin settlement requires PostgreSQL.",
          },
        });
      }

      return {
        data: await settlement.resolveMarket({
          marketId: request.params.id,
          winningSide: request.body?.winningSide,
          adminUserId: actor.dbUserId,
          adminActorId: actor.username,
          sessionId: actor.auditSessionId,
          idempotencyKey: getIdempotencyKey(request, request.body),
        }),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { idempotencyKey?: unknown } }>(
    "/api/admin/markets/:id/cancel",
    {
      preHandler: adminPreHandler(["finance_admin", "super_admin"]),
    },
    async (request, reply) => {
      const actor = getActor(request);

      if (!settlement || !coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_SETTLEMENT_DATABASE_REQUIRED",
            message: "Coin settlement requires PostgreSQL.",
          },
        });
      }

      return {
        data: await settlement.cancelMarket({
          marketId: request.params.id,
          adminUserId: actor.dbUserId,
          adminActorId: actor.username,
          sessionId: actor.auditSessionId,
          idempotencyKey: getIdempotencyKey(request, request.body),
        }),
      };
    },
  );
}

function getIdempotencyKey(
  request: FastifyRequest,
  body: { idempotencyKey?: unknown } | null | undefined,
) {
  const header = request.headers["idempotency-key"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const value =
    typeof headerValue === "string" && headerValue.trim()
      ? headerValue
      : typeof body?.idempotencyKey === "string"
        ? body.idempotencyKey
        : null;

  return value?.trim() || null;
}
