import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService, getAuthContext, requireAuth } from "../auth.js";
import { type AuditService } from "../audit.js";
import type { AppConfig } from "../config.js";
import { type WalletService, WalletError } from "../wallets.js";
import { isRecord } from "../utils.js";

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

function isValidLocalWebhookSecret(request: FastifyRequest, config: AppConfig) {
  if (!config.walletDepositWebhookSecret) {
    return false;
  }

  const header = request.headers["x-deposit-webhook-secret"];
  const value = Array.isArray(header) ? header[0] : header;

  return value === config.walletDepositWebhookSecret;
}

export function registerWalletRoutes(
  app: FastifyInstance,
  auth: AuthService,
  audit: AuditService,
  wallets: WalletService,
  config: AppConfig,
) {
  app.get(
    "/api/wallets/me",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      const result = await wallets.getOrCreateWallet(context.user.id);

      if (result.created) {
        await audit.record({
          eventType: "wallet.created",
          userId: context.user.id,
          sessionId: context.session.id,
          metadata: {
            walletId: result.wallet.id,
            asset: result.wallet.asset,
            network: result.wallet.network,
            provider: result.wallet.provider,
            manualReview: true,
          },
        });
      }

      return {
        data: result,
      };
    },
  );

  app.post<{
    Body: unknown;
  }>(
    "/api/wallets/deposit-intents",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      try {
        const result = await wallets.createDepositIntent({
          userId: context.user.id,
          body: request.body,
        });

        if (result.walletCreated) {
          await audit.record({
            eventType: "wallet.created",
            userId: context.user.id,
            sessionId: context.session.id,
            metadata: {
              walletId: result.wallet.id,
              asset: result.wallet.asset,
              network: result.wallet.network,
              provider: result.wallet.provider,
              manualReview: true,
            },
          });
        }

        await audit.record({
          eventType: "wallet.deposit_intent_created",
          userId: context.user.id,
          sessionId: context.session.id,
          metadata: {
            depositIntentId: result.depositIntent.id,
            walletId: result.wallet.id,
            asset: result.depositIntent.asset,
            network: result.depositIntent.network,
            expectedAmount: result.depositIntent.expectedAmount,
            manualReview: true,
          },
        });

        return {
          data: result,
        };
      } catch (error) {
        if (error instanceof WalletError) {
          await audit.record({
            eventType: "wallet.rejected",
            userId: context.user.id,
            sessionId: context.session.id,
            metadata: {
              reason: error.code,
              endpoint: "POST /api/wallets/deposit-intents",
              manualReview: true,
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

  app.post<{
    Body: {
      idempotencyKey?: unknown;
    } & Record<string, unknown>;
  }>(
    "/api/wallets/withdrawal-requests",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }
      const body = isRecord(request.body)
        ? { ...request.body, idempotencyKey: getIdempotencyKey(request, request.body) }
        : request.body;

      try {
        const result = await wallets.createWithdrawalRequest({
          userId: context.user.id,
          body,
        });

        if (!result.idempotent) {
          await audit.record({
            eventType: "wallet.withdrawal_request_created",
            userId: context.user.id,
            sessionId: context.session.id,
            metadata: {
              withdrawalRequestId: result.withdrawalRequest.id,
              asset: result.withdrawalRequest.asset,
              network: result.withdrawalRequest.network,
              amount: result.withdrawalRequest.amount,
              status: result.withdrawalRequest.status,
              idempotencyKey: result.withdrawalRequest.idempotencyKey,
              realTransferBlocked: true,
              reason: "TRANSFERS_UNAVAILABLE",
              manualReview: true,
            },
          });
        }

        return {
          data: result,
        };
      } catch (error) {
        if (error instanceof WalletError) {
          await audit.record({
            eventType: "wallet.rejected",
            userId: context.user.id,
            sessionId: context.session.id,
            metadata: {
              reason: error.code,
              endpoint: "POST /api/wallets/withdrawal-requests",
              idempotencyKey: getIdempotencyKey(request, request.body),
              manualReview: true,
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

  app.get(
    "/api/wallets/deposits",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      return {
        data: await wallets.listDeposits(context.user.id),
      };
    },
  );

  app.get(
    "/api/wallets/withdrawal-requests",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      return {
        data: await wallets.listWithdrawalRequests(context.user.id),
      };
    },
  );

  app.post<{
    Body: unknown;
  }>("/api/wallets/webhooks/deposits", async (request, reply) => {
    if (!isValidLocalWebhookSecret(request, config)) {
      return reply.status(401).send({
        data: null,
        error: {
          code: "MOCK_WEBHOOK_SECRET_REQUIRED",
          message: "Deposit webhook secret is required.",
        },
      });
    }

    try {
      const result = await wallets.receiveLocalWebhook(request.body);

      for (const eventType of result.auditEvents) {
        await audit.record({
          eventType,
          userId: result.depositEvent.userId,
          metadata: {
            depositEventId: result.depositEvent.id,
            txHash: result.depositEvent.txHash,
            logIndex: result.depositEvent.logIndex,
            walletId: result.depositEvent.walletId,
            amount: result.depositEvent.amount,
            asset: result.depositEvent.asset,
            network: result.depositEvent.network,
            confirmations: result.depositEvent.confirmations,
            status: result.depositEvent.status,
            rejectionReason: result.depositEvent.rejectionReason,
            creditBlockedReason: result.creditBlockedReason,
            idempotent: result.idempotent,
            manualReview: true,
          },
        });
      }

      if (result.conflict) {
        return reply.status(409).send({
          data: result,
          error: {
            code: "DEPOSIT_EVENT_FINGERPRINT_MISMATCH",
            message:
              "Webhook txHash/logIndex was already used for a different deposit payload.",
          },
        });
      }

      return {
        data: result,
      };
    } catch (error) {
      if (error instanceof WalletError) {
        await audit.record({
          eventType: "wallet.rejected",
          metadata: {
            reason: error.code,
            endpoint: "POST /api/wallets/webhooks/deposits",
            manualReview: true,
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
  });
}
