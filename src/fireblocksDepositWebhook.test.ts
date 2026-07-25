import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  FireblocksDepositWebhookError,
  fireblocksDepositWebhookAdapter,
  type FireblocksWebhookJwks,
} from "./realMoneyAdapters/fireblocksDepositWebhook.js";

function createSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const kid = "fireblocks-rs512-test";
  const publicJwk = publicKey.export({ format: "jwk" });
  const jwks: FireblocksWebhookJwks = {
    keys: [
      {
        kty: "RSA",
        kid,
        use: "sig",
        alg: "RS512",
        n: publicJwk.n,
        e: publicJwk.e,
      },
    ],
  };

  return {
    jwks,
    signBody(rawBody: Buffer, algorithm = "RS512") {
      const protectedHeader = Buffer.from(
        JSON.stringify({ alg: algorithm, kid }),
      ).toString("base64url");
      const signingInput =
        `${protectedHeader}.${rawBody.toString("base64url")}`;
      const signature = sign(
        algorithm === "RS512" ? "RSA-SHA512" : "RSA-SHA256",
        Buffer.from(signingInput),
        privateKey,
      );
      return `${protectedHeader}..${signature.toString("base64url")}`;
    },
  };
}

test("Fireblocks detached JWS verifies the exact raw body with RS512", async () => {
  const signer = createSigner();
  const rawBody = Buffer.from(
    JSON.stringify({
      id: "event-1",
      eventType: "TRANSACTION_STATUS_UPDATED",
      data: { id: "transaction-1", status: "COMPLETED" },
    }),
  );

  const result = await fireblocksDepositWebhookAdapter.verifyDepositWebhook({
    rawBody,
    headers: {
      "Fireblocks-Webhook-Signature": signer.signBody(rawBody),
    },
    config: { jwks: signer.jwks },
  });

  assert.equal(result.verified, true);
  assert.equal(result.provider, "fireblocks");
  assert.equal(result.signatureKid, "fireblocks-rs512-test");
  assert.equal(result.eventType, "TRANSACTION_STATUS_UPDATED");
  assert.equal(result.transactionId, "transaction-1");
});

test("Fireblocks webhook rejects unsupported algorithms and raw-body tampering", async () => {
  const signer = createSigner();
  const rawBody = Buffer.from(JSON.stringify({ id: "event-2" }));

  await assert.rejects(
    fireblocksDepositWebhookAdapter.verifyDepositWebhook({
      rawBody,
      headers: {
        "Fireblocks-Webhook-Signature": signer.signBody(rawBody, "RS256"),
      },
      config: { jwks: signer.jwks },
    }),
    (error: unknown) =>
      error instanceof FireblocksDepositWebhookError &&
      error.code === "SIGNATURE_ALG_UNSUPPORTED",
  );

  await assert.rejects(
    fireblocksDepositWebhookAdapter.verifyDepositWebhook({
      rawBody: Buffer.from(JSON.stringify({ id: "tampered" })),
      headers: {
        "Fireblocks-Webhook-Signature": signer.signBody(rawBody),
      },
      config: { jwks: signer.jwks },
    }),
    (error: unknown) =>
      error instanceof FireblocksDepositWebhookError &&
      error.code === "SIGNATURE_INVALID",
  );
});
