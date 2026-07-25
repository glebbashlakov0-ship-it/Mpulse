import pg from "pg";
import type { AppConfig } from "./config.js";
import { enforceVerifiedPostgresTls } from "./postgresTls.js";

const { Pool } = pg;

export type Queryable = {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

export type Database = Queryable & {
  enabled: boolean;
  transaction<T>(callback: (client: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export function buildDatabase(config: AppConfig): Database {
  if (!config.databaseUrl) {
    return {
      enabled: false,
      async query() {
        throw new Error("Database is disabled. Set DATABASE_URL to enable Postgres.");
      },
      async transaction() {
        throw new Error("Database is disabled. Set DATABASE_URL to enable Postgres.");
      },
      async close() {
        // No-op.
      },
    };
  }

  const pool = new Pool({
    connectionString: config.databaseSsl
      ? enforceVerifiedPostgresTls(config.databaseUrl)
      : config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
  });

  return {
    enabled: true,
    async query<T>(text: string, values?: readonly unknown[]) {
      const result = await pool.query(text, values ? [...values] : undefined);
      return {
        rows: result.rows as T[],
      };
    },
    async transaction<T>(callback: (client: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await callback({
          async query<TClient>(text: string, values?: readonly unknown[]) {
            const queryResult = await client.query(text, values ? [...values] : undefined);
            return {
              rows: queryResult.rows as TClient[],
            };
          },
        });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
