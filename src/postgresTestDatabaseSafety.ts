export type PostgresTestDatabaseSafetyIssueCode =
  | "POSTGRES_TESTS_IN_PRODUCTION_CONTEXT"
  | "TEST_DATABASE_URL_DATABASE_MISSING"
  | "TEST_DATABASE_URL_DATABASE_UNSAFE"
  | "TEST_DATABASE_URL_MATCHES_DATABASE_URL"
  | "TEST_DATABASE_URL_MISSING"
  | "TEST_DATABASE_URL_NOT_TEST_SCOPED"
  | "TEST_DATABASE_URL_INVALID";

export type PostgresTestDatabaseSafetyIssue = {
  code: PostgresTestDatabaseSafetyIssueCode;
  message: string;
};

export type PostgresTestDatabaseSafetyReport = {
  ok: boolean;
  issues: PostgresTestDatabaseSafetyIssue[];
};

export function auditPostgresTestDatabaseSafety(
  env: NodeJS.ProcessEnv = process.env,
): PostgresTestDatabaseSafetyReport {
  const issues: PostgresTestDatabaseSafetyIssue[] = [];
  const testDatabaseUrl = env.TEST_DATABASE_URL?.trim() ?? "";
  const runtimeDatabaseUrl = env.DATABASE_URL?.trim() ?? "";

  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    issues.push({
      code: "POSTGRES_TESTS_IN_PRODUCTION_CONTEXT",
      message: "Postgres integration tests must not run in a production deployment context.",
    });
  }

  if (!testDatabaseUrl) {
    issues.push({
      code: "TEST_DATABASE_URL_MISSING",
      message: "TEST_DATABASE_URL is required for Postgres integration tests.",
    });
    return { ok: false, issues };
  }

  const parsedTestUrl = safeParseUrl(testDatabaseUrl);
  if (!parsedTestUrl) {
    issues.push({
      code: "TEST_DATABASE_URL_INVALID",
      message: "TEST_DATABASE_URL must be a valid Postgres connection URL.",
    });
    return { ok: false, issues };
  }
  if (!getDatabaseName(parsedTestUrl)) {
    issues.push({
      code: "TEST_DATABASE_URL_DATABASE_MISSING",
      message: "TEST_DATABASE_URL must include an explicit database name.",
    });
  } else if (isUnsafeMaintenanceDatabaseName(getDatabaseName(parsedTestUrl))) {
    issues.push({
      code: "TEST_DATABASE_URL_DATABASE_UNSAFE",
      message:
        "TEST_DATABASE_URL must not point at Postgres maintenance or template databases.",
    });
  }

  const parsedRuntimeUrl = runtimeDatabaseUrl ? safeParseUrl(runtimeDatabaseUrl) : null;
  if (
    parsedRuntimeUrl &&
    normalizeDatabaseUrl(parsedTestUrl) === normalizeDatabaseUrl(parsedRuntimeUrl)
  ) {
    issues.push({
      code: "TEST_DATABASE_URL_MATCHES_DATABASE_URL",
      message:
        "TEST_DATABASE_URL must not point at the same database as DATABASE_URL.",
    });
  }

  if (!isClearlyTestScopedDatabase(parsedTestUrl, env)) {
    issues.push({
      code: "TEST_DATABASE_URL_NOT_TEST_SCOPED",
      message:
        "TEST_DATABASE_URL database name must be test-scoped, or set TEST_DATABASE_ALLOW_NONLOCAL=true for a dedicated remote test database.",
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function safeParseUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgres:" || parsed.protocol === "postgresql:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function normalizeDatabaseUrl(url: URL) {
  const protocol = "postgresql:";
  const hostname = normalizeDatabaseHost(url.hostname);
  const port = url.port || "5432";
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

  return `${protocol}//${hostname}:${port}/${databaseName}`;
}

function isClearlyTestScopedDatabase(url: URL, env: NodeJS.ProcessEnv) {
  const databaseName = getDatabaseName(url);
  if (!databaseName) {
    return false;
  }

  if (isUnsafeMaintenanceDatabaseName(databaseName)) {
    return false;
  }

  if (/\btest\b|_test$|-test$/i.test(databaseName)) {
    return true;
  }

  if (
    !isLocalDatabaseHost(url.hostname) &&
    env.TEST_DATABASE_ALLOW_NONLOCAL?.trim().toLowerCase() === "true"
  ) {
    return true;
  }

  return false;
}

function isLocalDatabaseHost(hostname: string) {
  return normalizeDatabaseHost(hostname) === "localhost";
}

function normalizeDatabaseHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return ["localhost", "127.0.0.1", "::1"].includes(normalized)
    ? "localhost"
    : normalized;
}

function getDatabaseName(url: URL) {
  return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
}

function isUnsafeMaintenanceDatabaseName(databaseName: string) {
  return ["postgres", "template0", "template1"].includes(databaseName.toLowerCase());
}
