import { Pool } from "pg";
import { buildVerifiedPostgresTlsConfig } from "./postgresTls.js";
import { runSchemaMigrations } from "./schemaMigrations.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const pool = new Pool(
  booleanFromEnv("DATABASE_SSL")
    ? buildVerifiedPostgresTlsConfig(
        databaseUrl,
        process.env.DATABASE_SSL_CA_PEM?.trim() || null,
      )
    : {
        connectionString: databaseUrl,
        ssl: false,
      },
);
const client = await pool.connect();

try {
  await runSchemaMigrations(client);
} finally {
  client.release();
  await pool.end();
}

function booleanFromEnv(name: string) {
  return ["1", "true", "yes", "on"].includes(
    (process.env[name] ?? "").trim().toLowerCase(),
  );
}
