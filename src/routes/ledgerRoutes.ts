import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService, getAuthContext, requireAuth } from "../auth.js";
import { type AuditService } from "../audit.js";
import type { AppConfig } from "../config.js";
import { type LedgerService, LedgerError } from "../ledger.js";
import { isRecord } from "../utils.js";

function parseLedgerAsset(value: unknown) {
  return value === undefined || value === "USDT" ? "USDT" : undefined;
}

function parseLedgerLimit(value: unknown) {
  if (typeof value !== "string") {
    return 100;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
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

export function registerLedgerRoutes(
  app: FastifyInstance,
  auth: AuthService,
  audit: AuditService,
  ledger: LedgerService,
  config: AppConfig,
) {
  app.get<{
    Querystring: {
      asset?: unknown;
      walletId?: unknown;
    };
  }>(
    "/api/ledger/balance",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }
      const query = request.query;

      return {
        data: {
          mode: "ledger",
          balance: await ledger.getBalance({
            userId: context.user.id,
            asset: parseLedgerAsset(query.asset),
            walletId: typeof query.walletId === "string" && query.walletId.trim()
              ? query.walletId.trim()
              : undefined,
          }),
        },
      };
    },
  );

  app.get<{
    Querystring: {
      asset?: unknown;
      walletId?: unknown;
      limit?: unknown;
    };
  }>(
    "/api/ledger/entries",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }
      const query = request.query;

      return {
        data: {
          mode: "ledger",
          entries: await ledger.listEntries({
            userId: context.user.id,
            asset: parseLedgerAsset(query.asset),
            walletId: typeof query.walletId === "string" && query.walletId.trim()
              ? query.walletId.trim()
              : undefined,
            limit: parseLedgerLimit(query.limit),
          }),
        },
      };
    },
  );

  app.post<{
    Body: {
      amount?: unknown;
      idempotencyKey?: unknown;
      metadata?: unknown;
    };
  }>(
    "/api/ledger/credits",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }
      const idempotencyKey = getIdempotencyKey(request, request.body);
      const amount = typeof request.body?.amount === "number" ? request.body.amount : NaN;

      try {
        const result = await ledger.createEntry({
          userId: context.user.id,
          asset: "USDT",
          entryType: "credit",
          amount,
          reason: "ledger_credit",
          referenceType: "ledger_credit",
          referenceId: idempotencyKey,
          idempotencyKey: idempotencyKey ?? "",
          metadata: {
            ...(isRecord(request.body?.metadata) ? request.body.metadata : {}),
            source: "ledger_credit",
          },
        });

        await audit.record({
          eventType: "ledger.ledger_credit",
          userId: context.user.id,
          sessionId: context.session.id,
          metadata: {
            amount,
            asset: "USDT",
            idempotencyKey,
            idempotent: result.idempotent,
          },
        });

        return {
          data: {
            mode: "ledger",
            complianceMode: "ledger_restricted",
            ...result,
          },
        };
      } catch (error) {
        if (error instanceof LedgerError) {
          await audit.record({
            eventType: "ledger.rejected",
            userId: context.user.id,
            sessionId: context.session.id,
            metadata: {
              reason: error.code,
              endpoint: "POST /api/ledger/credits",
              idempotencyKey,
            },
          });

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
}
