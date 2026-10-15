import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db.js";
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
