import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { getConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";

let appPromise: Promise<FastifyInstance> | null = null;

function getReadyApp() {
  if (!appPromise) {
    appPromise = Promise.resolve()
      .then(() => {
        const app = buildApp(getConfig());
        return app.ready().then(() => app);
      })
      .catch((error) => {
        appPromise = null;
        throw error;
      });
  }

  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getReadyApp();
    await forwardToFastify(app, req, res);
  } catch (error) {
    console.error("Vercel API startup failed", error);
    sendStartupDiagnostic(res, error);
  }
}

function forwardToFastify(
  app: FastifyInstance,
  req: IncomingMessage,
  res: ServerResponse,
) {
  return new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("close", resolve);
    res.once("error", reject);
    app.server.emit("request", req, res);
  });
}

function sendStartupDiagnostic(res: ServerResponse, error: unknown) {
  if (res.headersSent || res.writableEnded) {
    return;
  }

  const missing = requiredProductionEnv.filter((name) => !process.env[name]?.trim());

  res.statusCode = 500;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      data: null,
      error: {
        code: "STARTUP_CONFIGURATION_ERROR",
        message: "API startup failed. Check the Vercel environment variables.",
        details: {
          configError: error instanceof Error ? error.message : "Unknown startup error.",
          requiredProductionEnv,
          missing,
        },
      },
    }),
  );
}

const requiredProductionEnv = [
  "APP_MODE",
  "NODE_ENV",
  "DATABASE_URL",
  "DATABASE_SSL",
  "SESSION_SECRET",
  "SESSION_COOKIE_SECURE",
  "CORS_ALLOWED_ORIGINS",
  "WALLET_DEPOSIT_WEBHOOK_SECRET",
  "APP_BASE_URL",
];
