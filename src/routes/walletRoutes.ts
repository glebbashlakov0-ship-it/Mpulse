import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, type AuthService, getAuthContext, requireAuth } from "../auth.js";
import { type AuditService } from "../audit.js";
import type { CoinWalletService } from "../coinWallets.js";
import { buildCoinFeatureCapabilities } from "../coinFeatureGates.js";
import type { AppConfig } from "../config.js";
import {
  FireblocksDepositWebhookError,
  fireblocksDepositWebhookAdapter,
} from "../realMoneyAdapters/fireblocksDepositWebhook.js";
import { WalletError } from "../wallets.js";
import { isRecord } from "../utils.js";

type RequestWithRawBody = FastifyRequest & {
  rawBody?: Buffer;
};

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

function isFireblocksDepositProvider(config: AppConfig) {
  return normalizeProvider(config.realMoneyDepositProvider) === "fireblocks";
}

function normalizeProvider(value: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, "-") ?? "";
}

function getRawBody(request: FastifyRequest) {
  const rawBody = (request as RequestWithRawBody).rawBody;
  return rawBody && rawBody.length > 0 ? rawBody : null;
}

export function registerWalletRoutes(
  app: FastifyInstance,
  auth: AuthService,
  audit: AuditService,
  config: AppConfig,
  coinWallets: CoinWalletService | null = null,
) {
  const features = buildCoinFeatureCapabilities(config);

  app.get(
    "/api/wallets/me",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Verified deposit address lookup requires PostgreSQL.",
          },
        });
      }
      return { data: await coinWallets.getDepositAddress(context.user.id) };
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
        if (!coinWallets) {
          return reply.status(503).send({
            data: null,
            error: {
              code: "COIN_WALLET_DATABASE_REQUIRED",
              message: "Coin deposit intents require PostgreSQL.",
            },
          });
        }
        if (!features.deposits.intentCreationEnabled) {
          return reply.status(503).send({
            data: null,
            error: {
              code: "COIN_DEPOSITS_DISABLED",
              message:
                "Coin deposit intake is disabled until signed provider crediting is explicitly enabled.",
              reason: features.deposits.blockReason,
            },
          });
        }
        const body = isRecord(request.body) ? request.body : {};
        const result = await coinWallets.createDepositIntent({
          userId: context.user.id,
          expectedUsdtAtomic: body.expectedUsdtAtomic,
          memo: body.memo,
        });
        await audit.record({
          eventType: "wallet.deposit_intent_created",
          userId: context.user.id,
          sessionId: context.session.id,
          metadata: {
            depositIntentId: result.depositIntent.id,
            asset: result.depositIntent.asset,
            network: result.depositIntent.network,
            expectedUsdtAtomic: result.depositIntent.expectedUsdtAtomic,
            reviewOnly: result.reviewOnly,
          },
        });
        return { data: result };
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
        if (!coinWallets) {
          return reply.status(503).send({
            data: null,
            error: {
              code: "COIN_WALLET_DATABASE_REQUIRED",
              message: "Coin withdrawals require PostgreSQL.",
            },
          });
        }
        if (!features.withdrawals.requestsEnabled) {
          return reply.status(503).send({
            data: null,
            error: {
              code: "COIN_WITHDRAWAL_REQUESTS_DISABLED",
              message: "Review-only Coin withdrawal requests are disabled.",
              reason: features.withdrawals.blockReason,
            },
          });
        }
        const coinBody: Record<string, unknown> = isRecord(body) ? body : {};
        const result = await coinWallets.confirmWithdrawal({
          userId: context.user.id,
          quoteId: coinBody["quoteId"],
          idempotencyKey: coinBody["idempotencyKey"],
        });
        if (!result.idempotent) {
          await audit.record({
            eventType: "wallet.withdrawal_request_created",
            userId: context.user.id,
            sessionId: context.session.id,
            metadata: {
              withdrawalRequestId: result.withdrawalRequest.id,
              withdrawalQuoteId: result.withdrawalRequest.withdrawalQuoteId,
              coinReservedMicros: result.withdrawalRequest.coinReservedMicros,
              estimatedUsdtAtomic: result.withdrawalRequest.estimatedUsdtAtomic,
              status: result.withdrawalRequest.status,
              realTransferBlocked: true,
              manualReview: true,
            },
          });
        }
        return { data: result };
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

  app.post<{
    Body: {
      coinAmountMicros?: unknown;
      destinationAddress?: unknown;
      idempotencyKey?: unknown;
    };
  }>(
    "/api/wallets/withdrawal-quotes",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Coin withdrawal quotes require PostgreSQL.",
          },
        });
      }
      if (!features.withdrawals.requestsEnabled) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WITHDRAWAL_REQUESTS_DISABLED",
            message: "Review-only Coin withdrawal requests are disabled.",
            reason: features.withdrawals.blockReason,
          },
        });
      }
      const quote = await coinWallets.createWithdrawalQuote({
        userId: context.user.id,
        destinationAddress: request.body?.destinationAddress,
        coinAmountMicros: request.body?.coinAmountMicros,
        idempotencyKey: getIdempotencyKey(request, request.body),
      });
      return { data: { quote } };
    },
  );

  app.get(
    "/api/wallets/deposits",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Coin deposit history requires PostgreSQL.",
          },
        });
      }
      return { data: { deposits: await coinWallets.listDeposits(context.user.id) } };
    },
  );

  app.get(
    "/api/wallets/withdrawal-requests",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }

      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Coin withdrawal history requires PostgreSQL.",
          },
        });
      }
      return {
        data: {
          withdrawalRequests: await coinWallets.listWithdrawals(context.user.id),
          reviewOnly: true,
        },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/wallets/withdrawal-requests/:id",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Coin withdrawal status requires PostgreSQL.",
          },
        });
      }
      return {
        data: {
          withdrawalRequest: await coinWallets.getWithdrawal(
            context.user.id,
            request.params.id,
          ),
        },
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>(
    "/api/wallets/withdrawal-requests/:id/cancel",
    {
      preHandler: (request, reply) => requireAuth(request, reply, auth, config),
    },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }
      if (!coinWallets) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Coin withdrawal cancellation requires PostgreSQL.",
          },
        });
      }
      return {
        data: await coinWallets.cancelWithdrawal({
          userId: context.user.id,
          withdrawalId: request.params.id,
          reason: request.body?.reason,
        }),
      };
    },
  );

  app.post<{
    Body: unknown;
  }>("/api/wallets/webhooks/deposits", async (request, reply) => {
    if (features.deposits.signedWebhookIngestionEnabled) {
      try {
        const verified = await fireblocksDepositWebhookAdapter.verifyDepositWebhook({
          rawBody: getRawBody(request) ?? "",
          headers: request.headers,
        });
        if (coinWallets) {
          const result = await coinWallets.processFireblocksWebhook(verified);
          if (result.conflict) {
            return reply.status(409).send({
              data: result,
              error: {
                code: "DEPOSIT_PROVIDER_EVENT_CONFLICT",
                message: "Provider event id was reused with a different payload.",
              },
            });
          }
          return { data: result };
        }
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_WALLET_DATABASE_REQUIRED",
            message: "Signed deposit processing requires the PostgreSQL Coin ledger.",
          },
        });
      } catch (error) {
        if (error instanceof FireblocksDepositWebhookError) {
          await audit.record({
            eventType: "wallet.rejected",
            metadata: {
              reason: error.code,
              endpoint: "POST /api/wallets/webhooks/deposits",
              provider: "fireblocks",
              manualReview: true,
            },
          });

          return reply.status(401).send({
            data: null,
            error: {
              code: error.code,
              message: error.message,
            },
          });
        }

        if (error instanceof WalletError) {
          await audit.record({
            eventType: "wallet.rejected",
            metadata: {
              reason: error.code,
              endpoint: "POST /api/wallets/webhooks/deposits",
              provider: "fireblocks",
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
    }

    if (isFireblocksDepositProvider(config)) {
      return reply.status(503).send({
        data: null,
        error: {
          code: "COIN_DEPOSIT_WEBHOOK_DISABLED",
          message: "Signed deposit webhook ingestion is disabled.",
        },
      });
    }

    return reply.status(410).send({
      data: null,
      error: {
        code: "LEGACY_DEPOSIT_WEBHOOK_RETIRED",
        message: "The unsigned legacy deposit webhook cannot mutate Coin balances.",
      },
    });
  });
}
