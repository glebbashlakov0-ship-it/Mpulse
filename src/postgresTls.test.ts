import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  buildVerifiedPostgresTlsConfig,
  normalizePostgresCaPem,
} from "./postgresTls.js";

test("PostgreSQL TLS config removes URL overrides and pins CA verification", () => {
  const ca = [
    "-----BEGIN CERTIFICATE-----",
    "test-certificate",
    "-----END CERTIFICATE-----",
  ].join("\n");
  const config = buildVerifiedPostgresTlsConfig(
    "postgresql://principal:secret@db.example.com/prod" +
      "?ssl=true&sslmode=no-verify&uselibpqcompat=true&sslrootcert=unsafe&application_name=mpulse",
    ca,
  );
  const verified = new URL(config.connectionString);
  assert.equal(verified.searchParams.has("ssl"), false);
  assert.equal(verified.searchParams.has("sslmode"), false);
  assert.equal(verified.searchParams.has("uselibpqcompat"), false);
  assert.equal(verified.searchParams.has("sslrootcert"), false);
  assert.equal(verified.searchParams.get("application_name"), "mpulse");
  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    ca,
  });
  const effectiveSsl = (
    new pg.Client(config) as unknown as {
      connectionParameters: { ssl: unknown };
    }
  ).connectionParameters.ssl;
  assert.deepEqual(effectiveSsl, {
    rejectUnauthorized: true,
    ca,
  });
});

test("PostgreSQL CA accepts escaped newlines and rejects malformed values", () => {
  assert.equal(
    normalizePostgresCaPem(
      "-----BEGIN CERTIFICATE-----\\ntest\\n-----END CERTIFICATE-----",
    ),
    [
      "-----BEGIN CERTIFICATE-----",
      "test",
      "-----END CERTIFICATE-----",
    ].join("\n"),
  );
  assert.throws(
    () => normalizePostgresCaPem("not-a-certificate"),
    /PEM-encoded CA certificate/,
  );
});
