import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "./server.js";
import { buildDatabase, type Database } from "./db.js";
import { testConfig } from "./testUtils.js";

const postgresTestUrl = process.env.TEST_DATABASE_URL;
const postgresTestSsl = ["1", "true", "yes", "on"].includes(
  (process.env.TEST_DATABASE_SSL ?? "").toLowerCase(),
);

function getCookieHeader(response: {
  headers: Record<string, string | number | string[] | undefined>;
}) {
  const header = response.headers["set-cookie"];
  const cookie = Array.isArray(header) ? header[0] : String(header ?? "");
  assert.ok(cookie.length > 0);
  return cookie.split(";")[0];
}

test(
  "postgres auth can revoke the current session without breaking audit foreign keys",
  { skip: postgresTestUrl ? false : "Set TEST_DATABASE_URL to run Postgres auth tests." },
  async () => {
    const email = `postgres-current-session-${randomUUID()}@example.com`;
    const db = buildPostgresTestDatabase();

    await cleanupTestUserByEmail(db, email);
    await db.close();

    const app = buildApp(
      testConfig({
        databaseUrl: postgresTestUrl,
        databaseSsl: postgresTestSsl,
      }),
    );

    try {
      const register = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email,
          password: "password12345",
          displayName: "Postgres Session",
        },
      });
      assert.equal(register.statusCode, 200);
      const cookie = getCookieHeader(register);

      const sessions = await app.inject({
        method: "GET",
        url: "/api/auth/sessions",
        headers: { cookie },
      });
      const sessionsBody = JSON.parse(sessions.body) as {
        data: { sessions: Array<{ id: string; current: boolean }> };
      };
      const currentSession = sessionsBody.data.sessions.find((session) => session.current);
      assert.ok(currentSession);

      const revoke = await app.inject({
        method: "DELETE",
        url: `/api/auth/sessions/${currentSession.id}`,
        headers: { cookie },
      });
      assert.equal(revoke.statusCode, 200);
      assert.match(String(revoke.headers["set-cookie"] ?? ""), /Max-Age=0/);

      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      assert.equal(me.statusCode, 401);
    } finally {
      await app.close();
      const cleanupDb = buildPostgresTestDatabase();
      await cleanupTestUserByEmail(cleanupDb, email);
      await cleanupDb.close();
    }
  },
);

function buildPostgresTestDatabase() {
  assert.ok(postgresTestUrl);
  return buildDatabase(
    testConfig({
      databaseUrl: postgresTestUrl,
      databaseSsl: postgresTestSsl,
    }),
  );
}

async function cleanupTestUserByEmail(db: Database, email: string) {
  await db.query("delete from users where email = $1", [email]);
}
