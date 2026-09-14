import { Pool, type PoolClient } from "pg";
import { applicationPoolConfig } from "@/persistence/postgres-options";

declare global {
  var nutritionCoachPool: Pool | undefined;
}

export function hasPostgresConfiguration() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!globalThis.nutritionCoachPool) {
    globalThis.nutritionCoachPool = new Pool(applicationPoolConfig());
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
