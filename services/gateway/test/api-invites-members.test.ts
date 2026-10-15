import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createKey, findUserByKey } from "../src/api-keys.js";
import { call, login, makeUser, NEW_PASSWORD, PASSWORD, startServer, tokenOf, type TestServer } from "./api-helpers.js";
import { createTestDb, resetData } from "./helpers.js";

describe("/api invites and members", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: TestServer;
  let base: string;
  let adminId: number;
  let memberId: number;
  let admin: string; // session tokens
  let member: string;

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    adminId = await makeUser(pool, "alice@x.io", "admin");
    memberId = await makeUser(pool, "bob@x.io", "member");
    server = await startServer(pool);
    base = server.base;
    admin = await login(base, "alice@x.io");
    member = await login(base, "bob@x.io");
  });
  afterEach(async () => {
    await server.stop();
  });

  async function invite(email: string, role = "member"): Promise<string> {
    const res = await call(base, "/invites", { body: { email, role }, cookie: admin });
    expect(res.status).toBe(201);
    return res.body.path.replace("/invite/", "");
  }

  describe("roles", () => {
    it("gives a member 403 on every admin route and 401 without a session", async () => {
      const routes: Array<[string, string]> = [
        ["GET", "/members"],
        ["PATCH", `/members/${adminId}`],
        ["GET", "/invites"],
        ["POST", "/invites"],
        ["DELETE", "/invites/1"],
      ];
      for (const [method, path] of routes) {
        const body = method === "GET" || method === "DELETE" ? undefined : {};
        expect((await call(base, path, { method, body, cookie: member })).status, `${method} ${path}`).toBe(403);
        expect((await call(base, path, { method, body })).status, `${method} ${path} anonymous`).toBe(401);
      }
    });
  });

  describe("invites", () => {
    it("invite, open the link, set a password, and log in", async () => {
      const token = await invite("Carol@X.io");
      const peek = await call(base, `/invites/${token}`);
      expect(peek.body).toEqual({ email: "carol@x.io", role: "member" });

      const accept = await call(base, `/invites/${token}/accept`, { body: { password: NEW_PASSWORD } });
      expect(accept.status).toBe(201);
      expect(accept.body).toMatchObject({ email: "carol@x.io", role: "member" });
      expect((await call(base, "/me", { cookie: tokenOf(accept.setCookie) })).status).toBe(200);
      expect((await call(base, "/auth/login", { body: { email: "carol@x.io", password: NEW_PASSWORD } })).status).toBe(200);
    });

    it("stores only a hash of the invite token", async () => {
      const token = await invite("carol@x.io");
      const { rows } = await pool.query("SELECT token_hash FROM invites");
      expect(rows[0].token_hash).not.toBe(token);
    });

    it("lets an invite be used once", async () => {
      const token = await invite("carol@x.io");
      expect((await call(base, `/invites/${token}/accept`, { body: { password: NEW_PASSWORD } })).status).toBe(201);
      expect((await call(base, `/invites/${token}/accept`, { body: { password: NEW_PASSWORD } })).status).toBe(404);
      expect((await call(base, `/invites/${token}`)).status).toBe(404);
    });

    it("rejects an expired, unknown or revoked invite with 404", async () => {
      const expired = await invite("carol@x.io");
      await pool.query("UPDATE invites SET expires_at = now() - interval '1 second'");
      expect((await call(base, `/invites/${expired}`)).status).toBe(404);
      expect((await call(base, `/invites/${expired}/accept`, { body: { password: NEW_PASSWORD } })).status).toBe(404);
      expect((await call(base, "/invites/unknown-token")).status).toBe(404);

      const revoked = await invite("dave@x.io");
      const { rows } = await pool.query("SELECT id FROM invites WHERE email = 'dave@x.io'");
      expect((await call(base, `/invites/${rows[0].id}`, { method: "DELETE", cookie: admin })).status).toBe(204);
      expect((await call(base, `/invites/${revoked}`)).status).toBe(404);
    });

    it("rejects a short password with 400", async () => {
      const token = await invite("carol@x.io");
      const res = await call(base, `/invites/${token}/accept`, { body: { password: "short" } });
      expect(res.status).toBe(400);
      expect(res.body.issues).toBeDefined();
    });

    it("answers 409 when inviting an email that already has an account", async () => {
      const res = await call(base, "/invites", { body: { email: "BOB@x.io", role: "member" }, cookie: admin });
      expect(res.status).toBe(409);
    });

    it("answers 409 when the account was created after the invite", async () => {
      const token = await invite("carol@x.io");
      await makeUser(pool, "carol@x.io");
      const res = await call(base, `/invites/${token}/accept`, { body: { password: NEW_PASSWORD } });
      expect(res.status).toBe(409);
    });

    it("replaces the pending invite when the same email is invited again", async () => {
      const first = await invite("carol@x.io");
      const second = await invite("carol@x.io", "admin");
      expect((await call(base, `/invites/${first}`)).status).toBe(404);
      expect((await call(base, `/invites/${second}`)).body.role).toBe("admin");
    });

    it("lists invites without their tokens", async () => {
      await invite("carol@x.io");
      const res = await call(base, "/invites", { cookie: admin });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    });
  });

  describe("members", () => {
    it("lists members without password hashes", async () => {
      const res = await call(base, "/members", { cookie: admin });
      expect(res.status).toBe(200);
      expect(res.body.map((m: { email: string }) => m.email).sort()).toEqual(["alice@x.io", "bob@x.io"]);
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it("changes a role", async () => {
      const res = await call(base, `/members/${memberId}`, { method: "PATCH", body: { role: "admin" }, cookie: admin });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("admin");
      expect((await call(base, "/members", { cookie: member })).status).toBe(200); // the session now sees the new role
    });

    it("disabling kills sessions at once and rejects the API keys, re-enabling restores the keys", async () => {
      const { key } = await createKey(pool, memberId, "laptop");
      expect(await findUserByKey(pool, key)).not.toBeNull();

      const off = await call(base, `/members/${memberId}`, { method: "PATCH", body: { disabled: true }, cookie: admin });
      expect(off.status).toBe(200);
      expect(off.body.disabled).toBe(true);
      expect((await pool.query("SELECT 1 FROM sessions WHERE user_id = $1", [memberId])).rowCount).toBe(0);
      expect((await call(base, "/me", { cookie: member })).status).toBe(401);
      expect(await findUserByKey(pool, key)).toBeNull();
      expect((await call(base, "/auth/login", { body: { email: "bob@x.io", password: PASSWORD } })).status).toBe(401);

      const on = await call(base, `/members/${memberId}`, { method: "PATCH", body: { disabled: false }, cookie: admin });
      expect(on.body.disabled).toBe(false);
      expect(await findUserByKey(pool, key)).not.toBeNull();
      expect((await call(base, "/auth/login", { body: { email: "bob@x.io", password: PASSWORD } })).status).toBe(200);
    });

    it("stops an admin from disabling or demoting themselves", async () => {
      expect((await call(base, `/members/${adminId}`, { method: "PATCH", body: { disabled: true }, cookie: admin })).status).toBe(400);
      expect((await call(base, `/members/${adminId}`, { method: "PATCH", body: { role: "member" }, cookie: admin })).status).toBe(400);
      expect((await call(base, "/me", { cookie: admin })).body.role).toBe("admin");
    });

    it("answers 404 for an unknown member and 400 for an empty or bad patch", async () => {
      expect((await call(base, "/members/9999", { method: "PATCH", body: { disabled: true }, cookie: admin })).status).toBe(404);
      expect((await call(base, `/members/${memberId}`, { method: "PATCH", body: {}, cookie: admin })).status).toBe(400);
      expect((await call(base, `/members/${memberId}`, { method: "PATCH", body: { role: "owner" }, cookie: admin })).status).toBe(400);
      expect((await call(base, "/members/abc", { method: "PATCH", body: { disabled: true }, cookie: admin })).status).toBe(400);
    });
  });
});
