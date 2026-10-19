import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findUserByKey } from "../src/api-keys.js";
import { call, login, makeUser, startServer, type TestServer } from "./api-helpers.js";
import { createTestDb, resetData } from "./helpers.js";

describe("/api keys and audit", () => {
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

  async function newKey(cookie: string, name = "laptop") {
    const res = await call(base, "/keys", { body: { name }, cookie });
    expect(res.status).toBe(201);
    return res.body as { id: number; key: string };
  }

  describe("keys", () => {
    it("needs a session", async () => {
      expect((await call(base, "/keys")).status).toBe(401);
      expect((await call(base, "/keys", { body: { name: "x" } })).status).toBe(401);
      expect((await call(base, "/keys/1", { method: "DELETE" })).status).toBe(401);
    });

    it("shows the key once on create and only the prefix in the list", async () => {
      const created = await newKey(member);
      expect(created.key).toMatch(/^umk_/);
      const list = await call(base, "/keys", { cookie: member });
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].prefix).toBe(created.key.slice(0, 8));
      expect(JSON.stringify(list.body)).not.toContain(created.key);
      expect(list.body[0].hash).toBeUndefined();
      expect(await findUserByKey(pool, created.key)).toMatchObject({ email: "bob@x.io" });
    });

    it("rejects a missing or empty name", async () => {
      expect((await call(base, "/keys", { body: {}, cookie: member })).status).toBe(400);
      expect((await call(base, "/keys", { body: { name: "" }, cookie: member })).status).toBe(400);
    });

    it("lists only your own keys", async () => {
      await newKey(admin, "admin-key");
      await newKey(member, "member-key");
      const list = await call(base, "/keys", { cookie: member });
      expect(list.body.map((k: { name: string }) => k.name)).toEqual(["member-key"]);
    });

    it("revokes your own key and the key stops working", async () => {
      const k = await newKey(member);
      const res = await call(base, `/keys/${k.id}`, { method: "DELETE", cookie: member });
      expect(res.status).toBe(204);
      expect(await findUserByKey(pool, k.key)).toBeNull();
      const list = await call(base, "/keys", { cookie: member });
      expect(list.body[0].revokedAt).not.toBeNull();
    });

    it("gives a member 404 when revoking someone else's key", async () => {
      const k = await newKey(admin);
      const res = await call(base, `/keys/${k.id}`, { method: "DELETE", cookie: member });
      expect(res.status).toBe(404);
      expect(await findUserByKey(pool, k.key)).toMatchObject({ email: "alice@x.io" });
    });

    it("gives 404 for a key id that does not exist", async () => {
      expect((await call(base, "/keys/99999", { method: "DELETE", cookie: member })).status).toBe(404);
    });

    it("gives a member 403 on ?all=true and lets an admin see every key with its owner", async () => {
      await newKey(admin, "admin-key");
      await newKey(member, "member-key");
      expect((await call(base, "/keys?all=true", { cookie: member })).status).toBe(403);
      const all = await call(base, "/keys?all=true", { cookie: admin });
      expect(all.status).toBe(200);
      expect(all.body.map((k: { owner: string }) => k.owner).sort()).toEqual(["alice@x.io", "bob@x.io"]);
    });

    it("lets an admin revoke any key", async () => {
      const k = await newKey(member);
      expect((await call(base, `/keys/${k.id}`, { method: "DELETE", cookie: admin })).status).toBe(204);
      expect(await findUserByKey(pool, k.key)).toBeNull();
    });
  });

  describe("audit", () => {
    async function addRow(userId: number, slug: string, outcome: "ok" | "error", tool = "list_products") {
      await pool.query(
        `INSERT INTO audit_log (user_id, server_slug, tool, started_at, duration_ms, outcome, error, source)
         VALUES ($1, $2, $3, now(), 5, $4, $5, 'mcp')`,
        [userId, slug, tool, outcome, outcome === "error" ? "boom" : null],
      );
    }

    beforeEach(async () => {
      await addRow(adminId, "woo", "ok");
      await addRow(memberId, "woo", "ok");
      await addRow(memberId, "fx", "error", "convert");
      await addRow(adminId, "fx", "ok", "convert");
    });

    it("needs a session", async () => {
      expect((await call(base, "/audit")).status).toBe(401);
    });

    it("shows a member only their own rows, even when asking for another user", async () => {
      const own = await call(base, "/audit", { cookie: member });
      expect(own.body).toHaveLength(2);
      expect(own.body.every((r: { user: string }) => r.user === "bob@x.io")).toBe(true);
      const other = await call(base, `/audit?user=${adminId}`, { cookie: member });
      expect(other.body.every((r: { user: string }) => r.user === "bob@x.io")).toBe(true);
    });

    it("shows an admin everything, newest first", async () => {
      const res = await call(base, "/audit", { cookie: admin });
      expect(res.body).toHaveLength(4);
      const ids = res.body.map((r: { id: number }) => Number(r.id));
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
    });

    it("filters by user, server and outcome", async () => {
      expect((await call(base, `/audit?user=${memberId}`, { cookie: admin })).body).toHaveLength(2);
      expect((await call(base, "/audit?server=fx", { cookie: admin })).body).toHaveLength(2);
      const errors = await call(base, "/audit?outcome=error", { cookie: admin });
      expect(errors.body).toHaveLength(1);
      expect(errors.body[0]).toMatchObject({ server: "fx", tool: "convert", outcome: "error", error: "boom", source: "mcp" });
      expect((await call(base, "/audit?outcome=nope", { cookie: admin })).status).toBe(400);
    });

    it("filters by source and refuses anything but mcp or chat", async () => {
      await pool.query(
        `INSERT INTO audit_log (user_id, server_slug, tool, started_at, duration_ms, outcome, source)
         VALUES ($1, 'woo', 'list_orders', now(), 7, 'ok', 'chat')`,
        [memberId],
      );
      const chat = await call(base, "/audit?source=chat", { cookie: admin });
      expect(chat.body).toHaveLength(1);
      expect(chat.body[0]).toMatchObject({ tool: "list_orders", source: "chat" });
      expect((await call(base, "/audit?source=mcp", { cookie: admin })).body).toHaveLength(4);
      expect((await call(base, "/audit?source=x", { cookie: admin })).status).toBe(400);
      // A member's source filter still only sees their own rows.
      expect((await call(base, "/audit?source=chat", { cookie: member })).body).toHaveLength(1);
    });

    it("returns args (null for old rows) and accepts the declined outcome filter", async () => {
      await pool.query(
        `INSERT INTO audit_log (user_id, server_slug, tool, started_at, duration_ms, outcome, source, args)
         VALUES ($1, 'woo', 'create_product', now(), 0, 'declined', 'chat', $2)`,
        [memberId, JSON.stringify({ name: "W", token: "[redacted]" })],
      );
      const declined = await call(base, "/audit?outcome=declined", { cookie: admin });
      expect(declined.body).toHaveLength(1);
      expect(declined.body[0]).toMatchObject({ outcome: "declined", source: "chat", args: { name: "W", token: "[redacted]" } });
      // A member sees the args of their own declined row, but not other users' rows.
      expect((await call(base, "/audit?outcome=declined", { cookie: member })).body[0].args).toEqual({ name: "W", token: "[redacted]" });
      const old = await call(base, "/audit?server=fx&outcome=ok", { cookie: admin });
      expect(old.body[0].args).toBeNull();
    });

    it("pages with limit and before", async () => {
      const first = await call(base, "/audit?limit=3", { cookie: admin });
      expect(first.body).toHaveLength(3);
      const last = first.body[2].id;
      const second = await call(base, `/audit?limit=3&before=${last}`, { cookie: admin });
      expect(second.body).toHaveLength(1);
      expect(Number(second.body[0].id)).toBeLessThan(Number(last));
    });

    it("refuses a limit above 200", async () => {
      expect((await call(base, "/audit?limit=201", { cookie: admin })).status).toBe(400);
      expect((await call(base, "/audit?limit=200", { cookie: admin })).status).toBe(200);
    });
  });
});
