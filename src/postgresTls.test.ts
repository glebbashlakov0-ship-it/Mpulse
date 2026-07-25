import assert from "node:assert/strict";
import test from "node:test";
import { enforceVerifiedPostgresTls } from "./postgresTls.js";

test("PostgreSQL TLS URLs force certificate and hostname verification", () => {
  const verified = new URL(
    enforceVerifiedPostgresTls(
      "postgresql://principal:secret@db.example.com/prod" +
        "?sslmode=no-verify&uselibpqcompat=true&application_name=mpulse",
    ),
  );
  assert.equal(verified.searchParams.get("sslmode"), "verify-full");
  assert.equal(verified.searchParams.has("uselibpqcompat"), false);
  assert.equal(verified.searchParams.get("application_name"), "mpulse");
});
