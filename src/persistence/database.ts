import { Pool, type PoolClient } from "pg";

declare global {
  var nutritionCoachPool: Pool | undefined;
}

export function hasPostgresConfiguration() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!globalThis.nutritionCoachPool) {
    globalThis.nutritionCoachPool = new Pool({
      connectionString,
      max: 5,
      ssl:
        process.env.DATABASE_SSL === "require"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return globalThis.nutritionCoachPool;
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
