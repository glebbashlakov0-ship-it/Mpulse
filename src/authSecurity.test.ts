import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { buildApp } from "./server.js";
import { testConfig } from "./testUtils.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function getCookieHeader(response: {
  headers: Record<string, string | number | string[] | undefined>;
}) {
  const header = response.headers["set-cookie"];
  const cookie = Array.isArray(header) ? header[0] : String(header ?? "");
  assert.ok(cookie.length > 0);
  return cookie.split(";")[0];
}

test("2FA setup, backup-code regeneration, disable, and audit events work", async () => {
  const app = buildApp(testConfig({ adminEmails: ["security-admin@example.com"] }));

  try {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "security-admin@example.com",
        password: "password12345",
        displayName: "Security Admin",
      },
    });
    const cookie = getCookieHeader(register);

    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/2fa/setup",
      headers: { cookie },
    });
    const setupBody = JSON.parse(setup.body) as {
      data: { secret: string; backupCodes: string[]; otpauthUrl: string; qrCodeDataUrl: string };
    };
    assert.equal(setup.statusCode, 200);
    assert.equal(setupBody.data.backupCodes.length, 8);
    assert.match(setupBody.data.otpauthUrl, /^otpauth:\/\/totp\//);
    assert.match(setupBody.data.qrCodeDataUrl, /^data:image\/png;base64,/);

    const confirm = await app.inject({
      method: "POST",
      url: "/api/auth/2fa/confirm",
      headers: { cookie },
      payload: { code: generateTotp(setupBody.data.secret) },
    });
    assert.equal(confirm.statusCode, 200);

    const regenerate = await app.inject({
      method: "POST",
      url: "/api/auth/2fa/backup-codes/regenerate",
      headers: { cookie },
      payload: { code: generateTotp(setupBody.data.secret) },
    });
    const regenerateBody = JSON.parse(regenerate.body) as {
      data: { backupCodes: string[]; status: { enabled: boolean } };
    };
    assert.equal(regenerate.statusCode, 200);
    assert.equal(regenerateBody.data.backupCodes.length, 8);
    assert.equal(regenerateBody.data.status.enabled, true);
    assert.notDeepEqual(regenerateBody.data.backupCodes, setupBody.data.backupCodes);

    const disable = await app.inject({
      method: "POST",
      url: "/api/auth/2fa/disable",
      headers: { cookie },
      payload: { code: generateTotp(setupBody.data.secret) },
    });
    const disableBody = JSON.parse(disable.body) as { data: { enabled: boolean } };
    assert.equal(disable.statusCode, 200);
    assert.equal(disableBody.data.enabled, false);

    const audit = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs",
      headers: { cookie },
    });
    const auditBody = JSON.parse(audit.body) as {
      data: { auditLogs: Array<{ eventType: string }> };
    };
    const eventTypes = auditBody.data.auditLogs.map((event) => event.eventType);

    assert.equal(audit.statusCode, 200);
    assert.equal(eventTypes.includes("auth.two_factor_setup_started"), true);
    assert.equal(eventTypes.includes("auth.two_factor_enabled"), true);
    assert.equal(eventTypes.includes("auth.two_factor_backup_codes_regenerated"), true);
    assert.equal(eventTypes.includes("auth.two_factor_disabled"), true);
  } finally {
    await app.close();
  }
});

test("session/device management lists, revokes, logs out all devices, and audits actions", async () => {
  const app = buildApp(testConfig({ adminEmails: ["session-audit-admin@example.com"] }));

  try {
    const adminCookie = await register(app, "session-audit-admin@example.com");
    const firstCookie = await register(app, "session-user@example.com");
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "session-user@example.com",
        password: "password12345",
      },
    });
    assert.equal(secondLogin.statusCode, 200);
    const secondCookie = getCookieHeader(secondLogin);

    const sessions = await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { cookie: firstCookie },
    });
    const sessionsBody = JSON.parse(sessions.body) as {
      data: { sessions: Array<{ id: string; current: boolean }> };
    };
    assert.equal(sessions.statusCode, 200);
    assert.equal(sessionsBody.data.sessions.length, 2);
    const currentSession = sessionsBody.data.sessions.find((session) => session.current);
    const otherSession = sessionsBody.data.sessions.find((session) => !session.current);
    assert.ok(currentSession);
    assert.ok(otherSession);

    const revokeOther = await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/${otherSession.id}`,
      headers: { cookie: firstCookie },
    });
    assert.equal(revokeOther.statusCode, 200);

    const secondMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: secondCookie },
    });
    assert.equal(secondMe.statusCode, 401);

    const thirdLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "session-user@example.com",
        password: "password12345",
      },
    });
    assert.equal(thirdLogin.statusCode, 200);
    const thirdCookie = getCookieHeader(thirdLogin);

    const revokeAll = await app.inject({
      method: "POST",
      url: "/api/auth/sessions/revoke-all",
      headers: { cookie: firstCookie },
    });
    assert.equal(revokeAll.statusCode, 200);
    assert.match(String(revokeAll.headers["set-cookie"] ?? ""), /Max-Age=0/);

    for (const cookie of [firstCookie, thirdCookie]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      assert.equal(response.statusCode, 401);
    }

    const audit = await app.inject({
      method: "GET",
      url: "/api/admin/audit-logs",
      headers: { cookie: adminCookie },
    });
    const auditBody = JSON.parse(audit.body) as {
      data: { auditLogs: Array<{ eventType: string }> };
    };
    const eventTypes = auditBody.data.auditLogs.map((event) => event.eventType);
    assert.equal(audit.statusCode, 200);
    assert.equal(eventTypes.includes("auth.session_revoked"), true);
    assert.equal(eventTypes.includes("auth.sessions_revoked_all"), true);
  } finally {
    await app.close();
  }
});

function generateTotp(secret: string, counter = Math.floor(Date.now() / 1000 / 30)) {
  const key = decodeBase32(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** 6).padStart(6, "0");
}

async function register(app: ReturnType<typeof buildApp>, email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "password12345",
      displayName: "Session Tester",
    },
  });
  assert.equal(response.statusCode, 200);
  return getCookieHeader(response);
}

function decodeBase32(value: string) {
  const clean = value.replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index >= 0) {
      bits += index.toString(2).padStart(5, "0");
    }
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}
