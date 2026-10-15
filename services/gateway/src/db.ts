import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);
const LOCK_ID = 74_001; // arbitrary number; stops two replicas migrating at once

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // An idle client errors when Postgres restarts (57P01). With no listener Node treats that as fatal and the pod crashes.
  // Log only: pg drops the dead client and the next query opens a new connection.
  pool.on("error", (err) => console.error("postgres pool error (idle client dropped):", err.message));
  return pool;
}

// Runs each migrations/*.sql file once, in name order, and records it in schema_migrations.
export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (done.rowCount) continue;
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
