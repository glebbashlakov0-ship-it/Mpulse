import type { FastifyInstance } from "fastify";
import { AuthError, type AuthService, getAuthContext, requireAuth } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { PostgresCoinLedgerRepository } from "../coins.js";
import {
  SUPPORTED_SETTLEMENT_ASSET,
  SUPPORTED_SETTLEMENT_NETWORK,
  USDT_TRC20_DECIMALS,
} from "../exchangeRates.js";

export function registerCoinRoutes(
  app: FastifyInstance,
  auth: AuthService,
  config: AppConfig,
  coins: PostgresCoinLedgerRepository | null,
) {
  app.get("/api/money/supported-assets", async () => ({
    data: {
      internalCurrency: {
        code: "COIN",
        name: "Coins",
        microsPerCoin: "1000000",
        usdParity: "1",
        blockchainAsset: false,
      },
      settlementAssets: [
        {
          asset: SUPPORTED_SETTLEMENT_ASSET,
          network: SUPPORTED_SETTLEMENT_NETWORK,
          rail: "TRC-20",
          decimals: USDT_TRC20_DECIMALS,
          depositEnabled: false,
          withdrawalEnabled: false,
          reviewOnly: true,
        },
      ],
    },
  }));

  app.get(
    "/api/coins/balance",
    { preHandler: (request, reply) => requireAuth(request, reply, auth, config) },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }
      if (!coins) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_LEDGER_DATABASE_REQUIRED",
            message: "The persistent Coin ledger requires PostgreSQL.",
          },
        });
      }
      return { data: await coins.getBalance(context.user.id) };
    },
  );

  app.get<{
    Querystring: { limit?: unknown };
  }>(
    "/api/coins/ledger",
    { preHandler: (request, reply) => requireAuth(request, reply, auth, config) },
    async (request, reply) => {
      const context = getAuthContext(request);
      if (!context) {
        throw new AuthError("UNAUTHENTICATED", "Authentication is required.", 401);
      }
      if (!coins) {
        return reply.status(503).send({
          data: null,
          error: {
            code: "COIN_LEDGER_DATABASE_REQUIRED",
            message: "The persistent Coin ledger requires PostgreSQL.",
          },
        });
      }
      const rawLimit = typeof request.query.limit === "string" ? request.query.limit : "100";
      const parsedLimit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : 100;
      const limit = Number.isSafeInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100;
      return { data: { entries: await coins.listEntries(context.user.id, limit) } };
    },
  );
}
