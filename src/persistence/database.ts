import { Pool, type PoolClient } from "pg";
import { applicationPoolConfig } from "@/persistence/postgres-options";

declare global {
  var nutritionCoachPool: Pool | undefined;
}

export function hasPostgresConfiguration() {
  if (process.env.DATABASE_URL) return true;
  const explicitE2eMemoryAdapter =
    process.env.ALLOW_IN_MEMORY_PERSISTENCE_FOR_E2E === "true";
  if (process.env.NODE_ENV === "production" && !explicitE2eMemoryAdapter) {
    throw new Error("DATABASE_URL is required in production.");
  }
  return false;
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
