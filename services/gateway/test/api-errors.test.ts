import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, login, makeUser, startServer, type TestServer } from "./api-helpers.js";
import { createTestDb, resetData } from "./helpers.js";

describe("/api error handler", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: TestServer;

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
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await server.stop();
  });

  it("turns a zod failure into 400 with the issues", async () => {
    const res = await call(server.base, "/auth/login", { body: { email: "not-an-email" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid request");
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it("turns an unexpected database error into a generic 500 and logs it server side", async () => {
    const secret = "relation \"users\" does not exist: SELECT password_hash FROM users WHERE email = $1";
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(pool, "query").mockRejectedValue(Object.assign(new Error(secret), { code: "42P01" }));

    const res = await call(server.base, "/invites/some-token");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal error" });
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|users|stack/i);
    expect(logged).toHaveBeenCalled();
  });

  it("keeps working after an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spy = vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("boom"));
    expect((await call(server.base, "/invites/some-token")).status).toBe(500);
    spy.mockRestore();
    expect((await login(server.base, "alice@x.io")).length).toBeGreaterThan(10);
  });
});
