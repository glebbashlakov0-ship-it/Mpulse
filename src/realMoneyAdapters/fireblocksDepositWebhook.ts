import { createPublicKey, verify } from "node:crypto";
import type { VerifiedRealMoneyProviderAdapterRuntimeExport } from "../realMoneyAdapterRuntime.js";

export type FireblocksWebhookJwk = {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
};

export type FireblocksWebhookJwks = {
  keys: readonly FireblocksWebhookJwk[];
};

export type FireblocksDepositWebhookInput = {
  rawBody: string | Buffer | Uint8Array;
  headers: Record<string, string | string[] | undefined>;
  config?: {
    jwks?: FireblocksWebhookJwks;
    jwksUrl?: string;
  };
  fetchJwks?: (url: string) => Promise<FireblocksWebhookJwks>;
};

export type FireblocksDepositWebhookResult = {
  verified: true;
  provider: "fireblocks";
  signatureKid: string;
  eventType: string | null;
  transactionId: string | null;
  payload: unknown;
};

export type FireblocksDepositWebhookIssue = {
  code:
    | "RAW_BODY_REQUIRED"
    | "SIGNATURE_REQUIRED"
    | "SIGNATURE_MALFORMED"
    | "SIGNATURE_ALG_UNSUPPORTED"
    | "SIGNATURE_KID_REQUIRED"
    | "JWKS_REQUIRED"
    | "JWKS_KEY_NOT_FOUND"
    | "JWKS_KEY_UNSUPPORTED"
    | "SIGNATURE_INVALID"
    | "PAYLOAD_JSON_INVALID";
  message: string;
};

const fireblocksWebhookSignatureHeader = "fireblocks-webhook-signature";
const defaultFireblocksWebhookJwksUrl =
  "https://keys.fireblocks.io/.well-known/jwks.json";

export const fireblocksDepositWebhookAdapter = {
  kind: "signed_deposit_webhook",
  adapterId: "fireblocks-deposit-webhook-v2",
  provider: "fireblocks",
  verifiesWebhookSignatures: true,
  async verifyDepositWebhook(rawInput: unknown): Promise<FireblocksDepositWebhookResult> {
    const input = parseFireblocksDepositWebhookInput(rawInput);
    const rawBody = normalizeRawBody(input.rawBody);
    if (!rawBody) {
      throw new FireblocksDepositWebhookError("RAW_BODY_REQUIRED", "Raw webhook body is required.");
    }

    const signature = getHeader(input.headers, fireblocksWebhookSignatureHeader);
    if (!signature) {
      throw new FireblocksDepositWebhookError(
        "SIGNATURE_REQUIRED",
        "Fireblocks webhook signature header is required.",
      );
    }

    const parsedSignature = parseDetachedJws(signature);
    if (!parsedSignature.header.kid) {
      throw new FireblocksDepositWebhookError(
        "SIGNATURE_KID_REQUIRED",
        "Fireblocks webhook signature kid is required.",
      );
    }
    if (parsedSignature.header.alg !== "RS512") {
      throw new FireblocksDepositWebhookError(
        "SIGNATURE_ALG_UNSUPPORTED",
        "Only Fireblocks RS512 webhook signatures are supported.",
      );
    }

    const jwks = await loadFireblocksWebhookJwks(input);
    const jwk = jwks.keys.find((key) => key.kid === parsedSignature.header.kid);
    if (!jwk) {
      throw new FireblocksDepositWebhookError(
        "JWKS_KEY_NOT_FOUND",
        "Fireblocks webhook signing key was not found in JWKS.",
      );
    }
    if (
      jwk.kty !== "RSA" ||
      (jwk.use !== undefined && jwk.use !== "sig") ||
      (jwk.alg !== undefined && jwk.alg !== "RS512")
    ) {
      throw new FireblocksDepositWebhookError(
        "JWKS_KEY_UNSUPPORTED",
        "Fireblocks webhook signing key must be an RSA RS512 signature key.",
      );
    }

    const signingInput = `${parsedSignature.encodedHeader}.${base64Url(rawBody)}`;
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    const valid = verify(
      "RSA-SHA512",
      Buffer.from(signingInput),
      publicKey,
      parsedSignature.signature,
    );
    if (!valid) {
      throw new FireblocksDepositWebhookError(
        "SIGNATURE_INVALID",
        "Fireblocks webhook signature is invalid.",
      );
    }

    const payload = parseWebhookPayload(rawBody);
    const payloadData = getRecordField(payload, "data");
    const isV2Notification = getStringField(payload, "eventType") !== null;

    return {
      verified: true,
      provider: "fireblocks",
      signatureKid: parsedSignature.header.kid,
      eventType: getStringField(payload, "eventType") ?? getStringField(payload, "type"),
      transactionId:
        getStringField(payload, "resourceId") ??
        getStringField(payloadData, "id") ??
        getStringField(payload, "transactionId") ??
        (isV2Notification ? null : getStringField(payload, "id")),
      payload,
    };
  },
} satisfies VerifiedRealMoneyProviderAdapterRuntimeExport;

async function loadFireblocksWebhookJwks(input: FireblocksDepositWebhookInput) {
  if (input.config?.jwks) {
    if (!input.config.jwks.keys.length) {
      throw new FireblocksDepositWebhookError(
        "JWKS_REQUIRED",
        "Fireblocks webhook JWKS has no keys.",
      );
    }
    return input.config.jwks;
  }

  const jwksUrl =
    input.config?.jwksUrl ??
    process.env.FIREBLOCKS_WEBHOOK_JWKS_URL ??
    defaultFireblocksWebhookJwksUrl;
  if (!jwksUrl.trim()) {
    throw new FireblocksDepositWebhookError("JWKS_REQUIRED", "Fireblocks webhook JWKS is required.");
  }

  const fetchJwks = input.fetchJwks ?? fetchFireblocksWebhookJwks;
  const jwks = await fetchJwks(jwksUrl);
  if (!jwks.keys.length) {
    throw new FireblocksDepositWebhookError("JWKS_REQUIRED", "Fireblocks webhook JWKS has no keys.");
  }

  return jwks;
}

async function fetchFireblocksWebhookJwks(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new FireblocksDepositWebhookError(
      "JWKS_REQUIRED",
      `Fireblocks webhook JWKS request failed with HTTP ${response.status}.`,
    );
  }

  return parseJwks(await response.json());
}

function parseFireblocksDepositWebhookInput(rawInput: unknown): FireblocksDepositWebhookInput {
  const input = isRecord(rawInput) ? rawInput : {};
  const config = isRecord(input.config) ? input.config : {};

  return {
    rawBody: isRawBody(input.rawBody) ? input.rawBody : "",
    headers: isHeaders(input.headers) ? input.headers : {},
    config: {
      jwks: isRecord(config.jwks) ? parseJwks(config.jwks) : undefined,
      jwksUrl: optionalString(config.jwksUrl),
    },
    fetchJwks: isFetchJwks(input.fetchJwks) ? input.fetchJwks : undefined,
  };
}

function parseDetachedJws(value: string) {
  const parts = value.trim().split(".");
  if (parts.length !== 3 || parts[1] !== "") {
    throw new FireblocksDepositWebhookError(
      "SIGNATURE_MALFORMED",
      "Fireblocks webhook signature must be a detached JWS.",
    );
  }

  try {
    return {
      encodedHeader: parts[0],
      header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
        alg?: string;
        kid?: string;
      },
      signature: Buffer.from(parts[2], "base64url"),
    };
  } catch {
    throw new FireblocksDepositWebhookError(
      "SIGNATURE_MALFORMED",
      "Fireblocks webhook signature could not be decoded.",
    );
  }
}

function parseWebhookPayload(rawBody: Buffer) {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new FireblocksDepositWebhookError(
      "PAYLOAD_JSON_INVALID",
      "Fireblocks webhook payload must be valid JSON.",
    );
  }
}

function parseJwks(value: unknown): FireblocksWebhookJwks {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    return { keys: [] };
  }

  return {
    keys: value.keys.filter(isRecord).map((key) => ({
      kty: stringOrEmpty(key.kty),
      kid: optionalString(key.kid),
      use: optionalString(key.use),
      alg: optionalString(key.alg),
      n: optionalString(key.n),
      e: optionalString(key.e),
      crv: optionalString(key.crv),
      x: optionalString(key.x),
      y: optionalString(key.y),
    })),
  };
}

function normalizeRawBody(rawBody: string | Buffer | Uint8Array) {
  if (typeof rawBody === "string") {
    return rawBody ? Buffer.from(rawBody, "utf8") : null;
  }
  if (Buffer.isBuffer(rawBody)) {
    return rawBody.length > 0 ? rawBody : null;
  }
  if (rawBody instanceof Uint8Array) {
    return rawBody.byteLength > 0 ? Buffer.from(rawBody) : null;
  }
  return null;
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string) {
  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === name);
  const value = matchingKey ? headers[matchingKey] : undefined;
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function base64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getRecordField(value: unknown, field: string) {
  return isRecord(value) ? value[field] : null;
}

function getStringField(value: unknown, field: string) {
  if (!isRecord(value)) {
    return null;
  }
  const fieldValue = value[field];
  return typeof fieldValue === "string" && fieldValue.trim() ? fieldValue.trim() : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isHeaders(value: unknown): value is Record<string, string | string[] | undefined> {
  return isRecord(value);
}

function isRawBody(value: unknown): value is string | Buffer | Uint8Array {
  return typeof value === "string" || Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function isFetchJwks(value: unknown): value is (url: string) => Promise<FireblocksWebhookJwks> {
  return typeof value === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class FireblocksDepositWebhookError extends Error {
  constructor(
    public readonly code: FireblocksDepositWebhookIssue["code"],
    message: string,
  ) {
    super(message);
    this.name = "FireblocksDepositWebhookError";
  }
}
