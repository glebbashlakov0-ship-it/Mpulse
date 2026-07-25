export function buildVerifiedPostgresTlsConfig(
  databaseUrl: string,
  caPem: string | null = null,
) {
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

  // node-postgres lets SSL query parameters replace the explicit `ssl`
  // object. Remove every supported override so rejectUnauthorized and the
  // configured CA remain authoritative.
  for (const parameter of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ]) {
    parsed.searchParams.delete(parameter);
  }

  const normalizedCa = normalizePostgresCaPem(caPem);
  return {
    connectionString: parsed.toString(),
    ssl: {
      rejectUnauthorized: true as const,
      ...(normalizedCa ? { ca: normalizedCa } : {}),
    },
  };
}

export function normalizePostgresCaPem(caPem: string | null) {
  if (caPem === null || !caPem.trim()) {
    return null;
  }
  const normalized = (
    caPem.includes("\n") ? caPem : caPem.replaceAll("\\n", "\n")
  )
    .replaceAll("\r\n", "\n")
    .trim();
  if (
    !normalized.startsWith("-----BEGIN CERTIFICATE-----\n") ||
    !normalized.endsWith("\n-----END CERTIFICATE-----")
  ) {
    throw new Error(
      "DATABASE_SSL_CA_PEM must contain a PEM-encoded CA certificate.",
    );
  }
  return normalized;
}
