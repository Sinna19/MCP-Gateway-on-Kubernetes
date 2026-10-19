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

describe("/api login rate limit", () => {
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
  });
  afterEach(async () => {
    await server.stop();
  });

  async function start(loginPerEmail: number, loginPerIp: number): Promise<void> {
    server = await startServer(pool, undefined, { limits: { loginPerEmail, loginPerIp, loginWindowMs: 900_000, mcpCallsPerMinute: 60, mcpSessionsPerKey: 10, chatDailyCap: 200 } });
    base = server.base;
  }
  const attempt = (email: string, password = WRONG_PASSWORD, headers?: Record<string, string>) => call(base, "/auth/login", { body: { email, password }, headers });

  it("answers 429 with Retry-After on the attempt after the per-email limit", async () => {
    await start(5, 100);
    for (let i = 0; i < 5; i++) expect((await attempt("alice@x.io")).status).toBe(401);
    const blocked = await attempt("alice@x.io");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(blocked.body).toEqual({ error: "too many login attempts, try again later" });
    // Locked out means locked out: even the right password is refused until the window ends.
    expect((await attempt("alice@x.io", PASSWORD)).status).toBe(429);
  });

  it("counts Admin@X and admin@x (and surrounding spaces) in one bucket", async () => {
    await start(3, 100);
    for (const email of ["alice@x.io", "ALICE@X.IO", " Alice@x.io "]) expect((await attempt(email)).status).toBe(401);
    expect((await attempt("alice@x.io")).status).toBe(429);
  });

  it("counts an unknown email too, so the limit does not reveal which emails exist", async () => {
    await start(2, 100);
    await attempt("nobody@x.io");
    await attempt("nobody@x.io");
    expect((await attempt("nobody@x.io")).status).toBe(429);
  });

  it("a successful login resets the email bucket", async () => {
    await start(5, 100);
    for (let i = 0; i < 4; i++) await attempt("alice@x.io");
    expect((await attempt("alice@x.io", PASSWORD)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await attempt("alice@x.io")).status).toBe(401);
    expect((await attempt("alice@x.io")).status).toBe(429);
  });

  it("answers 429 once one IP has used its limit across different emails", async () => {
    await start(100, 3);
    for (let i = 0; i < 3; i++) expect((await attempt(`user${i}@x.io`)).status).toBe(401);
    const blocked = await attempt("user9@x.io");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("successful logins give their IP token back, so many good logins never hit the IP limit", async () => {
    await start(100, 30);
    for (let i = 0; i < 40; i++) expect((await attempt("alice@x.io", PASSWORD)).status).toBe(200);
  }, 60_000);

  it("keys the IP bucket on X-Forwarded-For (trust proxy 1: the last hop is Traefik's)", async () => {
    await start(100, 2);
    for (let i = 0; i < 2; i++) await attempt("a@x.io", WRONG_PASSWORD, { "X-Forwarded-For": "10.1.1.1" });
    expect((await attempt("a@x.io", WRONG_PASSWORD, { "X-Forwarded-For": "10.1.1.1" })).status).toBe(429);
    expect((await attempt("a@x.io", WRONG_PASSWORD, { "X-Forwarded-For": "10.2.2.2" })).status).toBe(401);
  });
});
