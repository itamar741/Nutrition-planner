import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(
  path.join(currentDirectory, "../db/migrations/001_initial.sql"),
  "utf8",
);
const pool = new pg.Pool({
  connectionString,
  max: 1,
  ssl:
    process.env.DATABASE_SSL === "require"
      ? { rejectUnauthorized: false }
      : undefined,
});
try {
  await pool.query(sql);
  console.log("Database migration completed.");
} finally {
  await pool.end();
}
