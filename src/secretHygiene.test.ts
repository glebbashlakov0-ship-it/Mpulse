import assert from "node:assert/strict";
import test from "node:test";
import { auditSecretContent } from "./secretHygiene.js";

test("secret hygiene accepts empty and documented placeholder values", () => {
  const issues = auditSecretContent(
    ".env.example",
    [
      "FIREBLOCKS_API_KEY=",
      "SESSION_SECRET=change-this-long-random-session-secret",
      "DATABASE_URL=postgres://user:password@localhost:5432/example_test",
    ].join("\n"),
  );
  assert.deepEqual(issues, []);
});

test("secret hygiene rejects private keys, live tokens, and literal credentials", () => {
  const issues = auditSecretContent(
    "unsafe.txt",
    [
      ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
      "API_KEY=actual-provider-key-value",
      `TOKEN=${["sk", "live", "1234567890abcdefgh"].join("_")}`,
    ].join("\n"),
  );
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ["PRIVATE_KEY_MATERIAL", "SENSITIVE_ENV_VALUE", "LIVE_TOKEN_LITERAL"],
  );
});
