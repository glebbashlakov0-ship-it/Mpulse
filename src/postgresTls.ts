/**
 * node-postgres lets SSL query parameters in a connection string override the
 * explicit `ssl` object. Pinning sslmode in the URL prevents `no-verify` or
 * libpq-compatible `require` from silently disabling certificate/hostname
 * verification.
 */
export function enforceVerifiedPostgresTls(databaseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("PostgreSQL TLS configuration requires a valid database URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(
      "PostgreSQL TLS configuration requires a postgres or postgresql URL.",
    );
  }
  parsed.searchParams.set("sslmode", "verify-full");
  parsed.searchParams.delete("uselibpqcompat");
  return parsed.toString();
}
