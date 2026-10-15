import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap.js";
import { verifyPassword } from "../src/passwords.js";
import { createTestDb, resetData } from "./helpers.js";

const options = { adminEmail: "admin@x.io", adminPassword: "correct horse", wooUrl: "http://woo-mcp:3000/mcp" };

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const pool = (await createTestDb()).pool;
    await bootstrap(pool, options);
    const { rows } = await pool.query("SELECT password_hash FROM users");
    expect(rows[0].password_hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", rows[0].password_hash)).toBe(true);
    expect(await verifyPassword("wrong", rows[0].password_hash)).toBe(false);
    await pool.end();
  });
});

describe("bootstrap", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
  });

  it("creates the admin and the woo server", async () => {
    await bootstrap(pool, options);
    const users = await pool.query("SELECT email, role FROM users");
    expect(users.rows).toEqual([{ email: "admin@x.io", role: "admin" }]);
    const servers = await pool.query("SELECT slug, url, enabled, credential_enc FROM upstream_servers");
    expect(servers.rows).toEqual([{ slug: "woo", url: "http://woo-mcp:3000/mcp", enabled: true, credential_enc: null }]);
  });

  it("stores the admin email trimmed and lowercase, and the database refuses a case-variant duplicate", async () => {
    await bootstrap(pool, { ...options, adminEmail: " Admin@X.io " });
    expect((await pool.query("SELECT email FROM users")).rows).toEqual([{ email: "admin@x.io" }]);
    await expect(pool.query("INSERT INTO users (email, role, password_hash) VALUES ('ADMIN@x.io', 'member', 'x')")).rejects.toMatchObject({ code: "23505", constraint: "users_email_lower" });
  });

  it("running twice changes nothing", async () => {
    await bootstrap(pool, options);
    await bootstrap(pool, { ...options, adminPassword: "different" });
    expect((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM upstream_servers")).rows[0].n).toBe(1);
    const { rows } = await pool.query("SELECT password_hash FROM users");
    expect(await verifyPassword("correct horse", rows[0].password_hash)).toBe(true);
  });

  it("does not re-seed woo after an admin removed it", async () => {
    await bootstrap(pool, options);
    await pool.query("DELETE FROM upstream_servers WHERE slug = 'woo'");
    await bootstrap(pool, options);
    expect((await pool.query("SELECT count(*)::int AS n FROM upstream_servers")).rows[0].n).toBe(0);
  });
});
