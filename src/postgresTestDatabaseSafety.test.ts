import assert from "node:assert/strict";
import test from "node:test";
import { auditPostgresTestDatabaseSafety } from "./postgresTestDatabaseSafety.js";

test("Postgres test database safety requires TEST_DATABASE_URL", () => {
  const report = auditPostgresTestDatabaseSafety({});

  assert.equal(report.ok, false);
  assert.deepEqual(report.issues.map((issue) => issue.code), ["TEST_DATABASE_URL_MISSING"]);
});

test("Postgres test database safety rejects production deployment context", () => {
  const report = auditPostgresTestDatabaseSafety({
    NODE_ENV: "production",
    TEST_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/market_pulse_test",
  });

  assert.equal(report.ok, false);
  assert.ok(
    report.issues.some((issue) => issue.code === "POSTGRES_TESTS_IN_PRODUCTION_CONTEXT"),
  );
});

test("Postgres test database safety rejects invalid and non-Postgres URLs", () => {
  assert.deepEqual(
    auditPostgresTestDatabaseSafety({ TEST_DATABASE_URL: "not-a-url" }).issues.map(
      (issue) => issue.code,
    ),
    ["TEST_DATABASE_URL_INVALID"],
  );
  assert.deepEqual(
    auditPostgresTestDatabaseSafety({ TEST_DATABASE_URL: "https://example.test/db" }).issues.map(
      (issue) => issue.code,
    ),
    ["TEST_DATABASE_URL_INVALID"],
  );
});

test("Postgres test database safety rejects the runtime database URL", () => {
  const databaseUrl = "postgres://market:secret@db.example.com:5432/market_pulse";
  const report = auditPostgresTestDatabaseSafety({
    DATABASE_URL: `${databaseUrl}?sslmode=require`,
    TEST_DATABASE_URL: databaseUrl,
  });

  assert.equal(report.ok, false);
  assert.ok(
    report.issues.some((issue) => issue.code === "TEST_DATABASE_URL_MATCHES_DATABASE_URL"),
  );
  assert.ok(
    report.issues.some((issue) => issue.code === "TEST_DATABASE_URL_NOT_TEST_SCOPED"),
  );
  assert.doesNotMatch(JSON.stringify(report), /secret@db\.example/);
});

test("Postgres test database safety rejects the runtime database even with different credentials", () => {
  const remoteReport = auditPostgresTestDatabaseSafety({
    DATABASE_URL: "postgres://prod:secret@db.example.com:5432/market_pulse?sslmode=require",
    TEST_DATABASE_URL: "postgres://test:other@db.example.com/market_pulse",
    TEST_DATABASE_ALLOW_NONLOCAL: "true",
  });
  const localAliasReport = auditPostgresTestDatabaseSafety({
    DATABASE_URL: "postgres://prod:secret@localhost:5432/market_pulse_test",
    TEST_DATABASE_URL: "postgres://test:other@127.0.0.1:5432/market_pulse_test",
  });
  const ipv6LocalAliasReport = auditPostgresTestDatabaseSafety({
    DATABASE_URL: "postgres://prod:secret@localhost:5432/market_pulse_test",
    TEST_DATABASE_URL: "postgres://test:other@[::1]:5432/market_pulse_test",
  });
  const protocolAliasReport = auditPostgresTestDatabaseSafety({
    DATABASE_URL: "postgres://prod:secret@db.example.com:5432/market_pulse_test",
    TEST_DATABASE_URL: "postgresql://test:other@db.example.com:5432/market_pulse_test",
  });

  assert.equal(remoteReport.ok, false);
  assert.ok(
    remoteReport.issues.some(
      (issue) => issue.code === "TEST_DATABASE_URL_MATCHES_DATABASE_URL",
    ),
  );
  assert.doesNotMatch(JSON.stringify(remoteReport), /secret@db\.example/);
  assert.equal(localAliasReport.ok, false);
  assert.ok(
    localAliasReport.issues.some(
      (issue) => issue.code === "TEST_DATABASE_URL_MATCHES_DATABASE_URL",
    ),
  );
  assert.equal(ipv6LocalAliasReport.ok, false);
  assert.ok(
    ipv6LocalAliasReport.issues.some(
      (issue) => issue.code === "TEST_DATABASE_URL_MATCHES_DATABASE_URL",
    ),
  );
  assert.equal(protocolAliasReport.ok, false);
  assert.ok(
    protocolAliasReport.issues.some(
      (issue) => issue.code === "TEST_DATABASE_URL_MATCHES_DATABASE_URL",
    ),
  );
});

test("Postgres test database safety rejects local non-test-scoped databases", () => {
  const report = auditPostgresTestDatabaseSafety({
    TEST_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/market_pulse",
  });
  const ipv6Report = auditPostgresTestDatabaseSafety({
    TEST_DATABASE_URL: "postgres://postgres:postgres@[::1]:5432/market_pulse",
    TEST_DATABASE_ALLOW_NONLOCAL: "true",
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.issues.map((issue) => issue.code), [
    "TEST_DATABASE_URL_NOT_TEST_SCOPED",
  ]);
  assert.equal(ipv6Report.ok, false);
  assert.deepEqual(ipv6Report.issues.map((issue) => issue.code), [
    "TEST_DATABASE_URL_NOT_TEST_SCOPED",
  ]);
});

test("Postgres test database safety requires an explicit database name", () => {
  const report = auditPostgresTestDatabaseSafety({
    TEST_DATABASE_URL: "postgres://postgres:postgres@db.example.com",
    TEST_DATABASE_ALLOW_NONLOCAL: "true",
  });

  assert.equal(report.ok, false);
  assert.ok(
    report.issues.some((issue) => issue.code === "TEST_DATABASE_URL_DATABASE_MISSING"),
  );
  assert.ok(
    report.issues.some((issue) => issue.code === "TEST_DATABASE_URL_NOT_TEST_SCOPED"),
  );
});

test("Postgres test database safety rejects maintenance databases even with nonlocal override", () => {
  for (const databaseName of ["postgres", "template0", "template1"]) {
    const report = auditPostgresTestDatabaseSafety({
      TEST_DATABASE_URL: `postgres://postgres:postgres@db.example.com:5432/${databaseName}`,
      TEST_DATABASE_ALLOW_NONLOCAL: "true",
    });

    assert.equal(report.ok, false);
    assert.ok(
      report.issues.some((issue) => issue.code === "TEST_DATABASE_URL_DATABASE_UNSAFE"),
      databaseName,
    );
    assert.ok(
      report.issues.some((issue) => issue.code === "TEST_DATABASE_URL_NOT_TEST_SCOPED"),
      databaseName,
    );
  }
});

test("Postgres test database safety allows local and explicitly dedicated test databases", () => {
  assert.equal(
    auditPostgresTestDatabaseSafety({
      TEST_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/market_pulse_test",
    }).ok,
    true,
  );
  assert.equal(
    auditPostgresTestDatabaseSafety({
      TEST_DATABASE_URL: "postgres://postgres:postgres@db.example.com:5432/market_pulse_test",
    }).ok,
    true,
  );
  assert.equal(
    auditPostgresTestDatabaseSafety({
      TEST_DATABASE_URL: "postgres://postgres:postgres@db.example.com:5432/market_pulse_ci",
      TEST_DATABASE_ALLOW_NONLOCAL: "true",
    }).ok,
    true,
  );
});
