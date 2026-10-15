import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createPool, migrate } from "../src/db.js";
import { createTestDb } from "./helpers.js";

describe("migrate", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });

  it("creates the tables", async () => {
    const { rows } = await pool.query("SELECT to_regclass('audit_log') AS t");
    expect(rows[0].t).toBe("audit_log");
  });

  it("running it again is a no-op", async () => {
    const count = async () => (await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n;
    const before = await count();
    await migrate(pool);
    expect(await count()).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it("rejects a slug with a double underscore, uppercase, or more than 20 chars", async () => {
    for (const slug of ["a__b", "Woo", "a".repeat(21), "-a", "a-"]) {
      await expect(pool.query("INSERT INTO upstream_servers (slug, url) VALUES ($1, 'http://x')", [slug])).rejects.toThrow();
    }
    await pool.query("INSERT INTO upstream_servers (slug, url) VALUES ('fx-rates', 'http://x')");
  });
});

describe("createPool", () => {
  it("survives Postgres killing an idle connection", async () => {
    const pool = createPool(inject("databaseUrl"));
    const admin = new pg.Pool({ connectionString: inject("databaseUrl"), max: 1 });
    try {
      const { rows } = await pool.query("SELECT pg_backend_pid() AS pid");
      await admin.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
      await new Promise((resolve) => setTimeout(resolve, 300)); // let the idle-client error arrive
      expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      await pool.end();
      await admin.end();
    }
  });
});
