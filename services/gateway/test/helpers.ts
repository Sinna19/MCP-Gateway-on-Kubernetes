import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { migrate } from "../src/db.js";

// Each test file gets its own empty, migrated database on the shared test Postgres.
export async function createTestDb(): Promise<{ pool: pg.Pool; drop: () => Promise<void> }> {
  const admin = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
  const name = `t_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(inject("databaseUrl"));
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  await migrate(pool);
  return {
    pool,
    drop: async () => {
      await pool.end();
      // pool.end() can resolve before Postgres has noticed the sockets closing. FORCE would kill those
      // backends and the client emits an unhandled 57P01, so wait for them to leave and use FORCE last.
      for (let i = 0; i < 20; i++) {
        try {
          await admin.query(`DROP DATABASE ${name}`);
          return await admin.end();
        } catch (err) {
          if ((err as { code?: string }).code !== "55006") throw err;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export async function resetData(pool: pg.Pool): Promise<void> {
  await pool.query("TRUNCATE audit_log, api_keys, sessions, invites, upstream_servers, users RESTART IDENTITY CASCADE");
}
