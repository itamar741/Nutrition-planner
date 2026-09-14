import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { migrationPoolConfig } from "../src/persistence/postgres-options.ts";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(currentDirectory, "../db/migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();
const pool = new pg.Pool(migrationPoolConfig());
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const filename of migrationFiles) {
    const applied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename],
    );
    if (applied.rowCount) continue;
    const sql = await readFile(
      path.join(migrationsDirectory, filename),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename],
      );
      await client.query("COMMIT");
      console.log(`Applied database migration ${filename}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log("Database migrations completed.");
} finally {
  await pool.end();
}
