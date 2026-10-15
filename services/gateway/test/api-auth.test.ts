import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, login, makeUser, PASSWORD, startServer, tokenOf, WRONG_PASSWORD, type TestServer } from "./api-helpers.js";
import { createTestDb, resetData } from "./helpers.js";

describe("/api auth", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: TestServer;
  let base: string;

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    await makeUser(pool, "alice@x.io", "admin");
    server = await startServer(pool);
    base = server.base;
  });
  afterEach(async () => {
    await server.stop();
  });

  it("logs in, sets an HttpOnly SameSite=Strict cookie, and /me returns the user", async () => {
    const res = await call(base, "/auth/login", { body: { email: "alice@x.io", password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: "alice@x.io", role: "admin" });
    expect(res.setCookie).toMatch(/HttpOnly/i);
    expect(res.setCookie).toMatch(/SameSite=Strict/i);
    expect(res.body.password_hash).toBeUndefined();
    const me = await call(base, "/me", { cookie: tokenOf(res.setCookie) });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("alice@x.io");
  });

  it("stores only a hash of the session token", async () => {
    const token = await login(base, "alice@x.io");
    const { rows } = await pool.query("SELECT token_hash FROM sessions");
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
  });

  it("matches the email case-insensitively", async () => {
    expect((await call(base, "/auth/login", { body: { email: "ALICE@x.io", password: PASSWORD } })).status).toBe(200);
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    const wrong = await call(base, "/auth/login", { body: { email: "alice@x.io", password: WRONG_PASSWORD } });
    const unknown = await call(base, "/auth/login", { body: { email: "nobody@x.io", password: PASSWORD } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.setCookie).toBeUndefined();
  });

  it("rejects a disabled user at login", async () => {
    await pool.query("UPDATE users SET disabled_at = now()");
    expect((await call(base, "/auth/login", { body: { email: "alice@x.io", password: PASSWORD } })).status).toBe(401);
  });

  it("returns 401 without a cookie or with a made-up one", async () => {
    expect((await call(base, "/me")).status).toBe(401);
    expect((await call(base, "/me", { cookie: "not-a-real-token" })).status).toBe(401);
  });

  it("logout deletes the session", async () => {
    const token = await login(base, "alice@x.io");
    expect((await call(base, "/auth/logout", { method: "POST", body: {}, cookie: token })).status).toBe(204);
    expect((await call(base, "/me", { cookie: token })).status).toBe(401);
    expect((await pool.query("SELECT 1 FROM sessions")).rowCount).toBe(0);
  });

  it("rejects an expired session", async () => {
    const token = await login(base, "alice@x.io");
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await call(base, "/me", { cookie: token })).status).toBe(401);
  });

  it("rejects a session of a user who was disabled", async () => {
    const token = await login(base, "alice@x.io");
    await pool.query("UPDATE users SET disabled_at = now()");
    expect((await call(base, "/me", { cookie: token })).status).toBe(401);
  });

  it("answers 415 to a POST that is not JSON", async () => {
    const form = await call(base, "/auth/login", { body: "email=alice%40x.io", contentType: "application/x-www-form-urlencoded" });
    expect(form.status).toBe(415);
    const none = await call(base, "/auth/logout", { method: "POST", contentType: null });
    expect(none.status).toBe(415);
  });

  it("answers 400 to a malformed JSON body", async () => {
    const res = await call(base, "/auth/login", { body: "{not json" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad request" });
  });
});
