import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UpstreamManager } from "../src/upstreams.js";
import { call, CREDENTIALS_KEY, login, makeUser, startServer, type TestServer } from "./api-helpers.js";
import { FakeUpstream } from "./fake-upstream.js";
import { createTestDb, resetData } from "./helpers.js";

describe("/api servers", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: TestServer;
  let manager: UpstreamManager;
  let fake: FakeUpstream;
  let base: string;
  let admin: string;
  let member: string;
  const secret = randomBytes(12).toString("hex");

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    await makeUser(pool, "alice@x.io", "admin");
    await makeUser(pool, "bob@x.io", "member");
    fake = new FakeUpstream({ ping: () => "pong" });
    await fake.start();
    manager = new UpstreamManager({ pool, credentialsKey: CREDENTIALS_KEY, callTimeoutMs: 500, connectTimeoutMs: 500, pingTimeoutMs: 300, allowLoopback: true });
    server = await startServer(pool, manager, { allowLoopback: true });
    base = server.base;
    admin = await login(base, "alice@x.io");
    member = await login(base, "bob@x.io");
  });
  afterEach(async () => {
    await server.stop();
    await manager.stop();
    await fake.stop();
  });

  const create = (body: Record<string, unknown>, cookie = admin) => call(base, "/servers", { body: { slug: "fake", url: fake.url, ...body }, cookie });

  describe("create", () => {
    it("with a bearer token: the upstream receives it and its tools appear", async () => {
      const res = await create({ auth: { type: "bearer", token: secret } });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ slug: "fake", status: "connected", hasCredential: true, headerName: "Authorization" });
      expect(res.body.tools.map((t: { name: string }) => t.name)).toEqual(["fake__ping"]);
      expect(manager.tools().map((t) => t.name)).toEqual(["fake__ping"]);
      expect(fake.headers.some((h) => h.authorization === `Bearer ${secret}`)).toBe(true);
    });

    it("with a custom header", async () => {
      const res = await create({ auth: { type: "header", name: "X-Api-Key", value: secret } });
      expect(res.status).toBe(201);
      expect(res.body.headerName).toBe("X-Api-Key");
      expect(fake.headers.some((h) => h["x-api-key"] === secret)).toBe(true);
    });

    it("stores the credential encrypted, never in plaintext", async () => {
      await create({ auth: { type: "bearer", token: secret } });
      const { rows } = await pool.query("SELECT credential_enc FROM upstream_servers WHERE slug = 'fake'");
      expect(rows[0].credential_enc).toBeTruthy();
      expect(rows[0].credential_enc).not.toContain(secret);
    });

    it("without auth works and has no credential", async () => {
      const res = await create({});
      expect(res.status).toBe(201);
      expect(res.body.hasCredential).toBe(false);
    });

    it("rejects a duplicate slug with 409", async () => {
      await create({});
      expect((await create({})).status).toBe(409);
    });

    it.each(["Bad_Slug", "has__double", "-lead", "trail-", "a".repeat(21), ""])("rejects slug %j with 400", async (slug) => {
      expect((await create({ slug })).status).toBe(400);
    });

    it.each(["ftp://host/mcp", "file:///etc/passwd", "not a url", "javascript:alert(1)", "http://user:pw@host/mcp"])("rejects url %j with 400", async (url) => {
      expect((await create({ url })).status).toBe(400);
    });

    it.each([
      "Host", "cookie", "Authorization", "Content-Length", "bad name", "x:y", "",
      "Content-Type", "Accept", "Mcp-Session-Id", "MCP-Protocol-Version", "Proxy-Authorization", "Upgrade", "TE",
    ])("rejects header name %j with 400", async (name) => {
      expect((await create({ auth: { type: "header", name, value: "v" } })).status).toBe(400);
    });

    it("rejects a header value with a line break", async () => {
      expect((await create({ auth: { type: "header", name: "X-Api-Key", value: "a\r\nX-Evil: 1" } })).status).toBe(400);
    });

    it("is admin only", async () => {
      expect((await create({}, member)).status).toBe(403);
      expect((await call(base, "/servers", { body: { slug: "fake", url: fake.url } })).status).toBe(401);
    });
  });

  // The production setting: loopback, link-local and unspecified hosts are refused (SSRF), private ranges are fine.
  describe("host guard (allowLoopback off)", () => {
    let strict: TestServer;
    beforeEach(async () => {
      strict = await startServer(pool, manager);
    });
    afterEach(async () => {
      await strict.stop();
    });

    it.each(["http://127.0.0.1/mcp", "http://[::1]/mcp", "http://localhost:3000/mcp", "http://169.254.169.254/latest", "http://[fe80::1]/mcp", "http://0.0.0.0/mcp", "http://foo.localhost/mcp"])(
      "create and PATCH reject %s with 400",
      async (url) => {
        expect((await call(strict.base, "/servers", { body: { slug: "bad", url }, cookie: admin })).status).toBe(400);
        await pool.query("INSERT INTO upstream_servers (slug, url, enabled) VALUES ('ok', 'http://10.0.0.9/mcp', false)");
        expect((await call(strict.base, "/servers/ok", { method: "PATCH", body: { url }, cookie: admin })).status).toBe(400);
        await pool.query("DELETE FROM upstream_servers WHERE slug = 'ok'");
      },
    );

    it("accepts a private-range and a cluster-DNS url", async () => {
      for (const [slug, url] of [["priv", "http://10.43.0.7:3000/mcp"], ["dns", "http://woo-mcp.urumi.svc.cluster.local:3000/mcp"]]) {
        expect((await call(strict.base, "/servers", { body: { slug, url, enabled: false }, cookie: admin })).status).toBe(201);
      }
    });
  });

  describe("update and delete", () => {
    it("PATCH enabled:false makes it disabled and removes its tools", async () => {
      await create({});
      const res = await call(base, "/servers/fake", { method: "PATCH", body: { enabled: false }, cookie: admin });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "disabled", enabled: false, tools: [] });
      expect(manager.tools()).toEqual([]);
    });

    it("PATCH auth: absent keeps, object replaces, null clears", async () => {
      await create({ auth: { type: "bearer", token: secret } });
      const patch = (body: unknown) => call(base, "/servers/fake", { method: "PATCH", body, cookie: admin });
      const stored = async () => (await pool.query("SELECT header_name, credential_enc FROM upstream_servers WHERE slug = 'fake'")).rows[0];

      const before = await stored();
      expect((await patch({ enabled: true })).body).toMatchObject({ hasCredential: true, headerName: "Authorization" });
      expect(await stored()).toEqual(before);

      expect((await patch({ auth: { type: "header", name: "X-Api-Key", value: secret } })).body).toMatchObject({ hasCredential: true, headerName: "X-Api-Key" });
      expect((await stored()).credential_enc).not.toBe(before.credential_enc);

      expect((await patch({ auth: null })).body).toMatchObject({ hasCredential: false, headerName: null });
      expect(await stored()).toEqual({ header_name: null, credential_enc: null });
    });

    it("PATCH validates like create, cannot change the slug, and needs a field", async () => {
      await create({});
      const patch = (body: unknown) => call(base, "/servers/fake", { method: "PATCH", body, cookie: admin });
      expect((await patch({ url: "ftp://x" })).status).toBe(400);
      expect((await patch({ auth: { type: "header", name: "Host", value: "v" } })).status).toBe(400);
      expect((await patch({ slug: "other" })).status).toBe(400);
      expect((await patch({})).status).toBe(400);
    });

    // A url change without a new credential would send the stored one to the new host.
    it("PATCH url needs the credential again", async () => {
      await create({ auth: { type: "bearer", token: secret } });
      const patch = (body: unknown) => call(base, "/servers/fake", { method: "PATCH", body, cookie: admin });
      const stored = async () => (await pool.query("SELECT url, credential_enc FROM upstream_servers WHERE slug = 'fake'")).rows[0];
      const before = await stored();

      const urlOnly = await patch({ url: `${fake.url}?moved` });
      expect(urlOnly.status).toBe(400);
      expect(JSON.stringify(urlOnly.body)).toContain("re-entering the credential");
      expect(await stored()).toEqual(before);

      expect((await patch({ url: `${fake.url}?moved`, auth: { type: "bearer", token: secret } })).status).toBe(200);
      expect((await patch({ auth: { type: "bearer", token: secret } })).status).toBe(200);
    });

    it("PATCH and DELETE on an unknown slug give 404", async () => {
      expect((await call(base, "/servers/nope", { method: "PATCH", body: { enabled: false }, cookie: admin })).status).toBe(404);
      expect((await call(base, "/servers/nope", { method: "DELETE", cookie: admin })).status).toBe(404);
    });

    it("DELETE removes the row and the tools", async () => {
      await create({});
      const res = await call(base, "/servers/fake", { method: "DELETE", cookie: admin });
      expect(res.status).toBe(204);
      expect((await pool.query("SELECT 1 FROM upstream_servers")).rowCount).toBe(0);
      expect(manager.tools()).toEqual([]);
    });

    it("PATCH and DELETE are admin only", async () => {
      await create({});
      expect((await call(base, "/servers/fake", { method: "PATCH", body: { enabled: false }, cookie: member })).status).toBe(403);
      expect((await call(base, "/servers/fake", { method: "DELETE", cookie: member })).status).toBe(403);
    });
  });

  describe("list and secrecy", () => {
    it("members see enabled servers with slug, status and tools only", async () => {
      await create({ auth: { type: "bearer", token: secret } });
      await call(base, "/servers", { body: { slug: "off", url: fake.url, enabled: false }, cookie: admin });
      const res = await call(base, "/servers", { cookie: member });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(Object.keys(res.body[0]).sort()).toEqual(["enabled", "slug", "status", "tools"]);
    });

    it("admins see all servers including disabled ones", async () => {
      await create({});
      await call(base, "/servers", { body: { slug: "off", url: fake.url, enabled: false }, cookie: admin });
      const res = await call(base, "/servers", { cookie: admin });
      expect(res.body.map((s: { slug: string }) => s.slug).sort()).toEqual(["fake", "off"]);
    });

    it("needs a session", async () => {
      expect((await call(base, "/servers")).status).toBe(401);
    });

    it("no servers route returns the plaintext secret or the ciphertext, for admin or member", async () => {
      const created = await create({ auth: { type: "bearer", token: secret } });
      const { rows } = await pool.query("SELECT credential_enc FROM upstream_servers");
      const cipher: string = rows[0].credential_enc;
      const patched = await call(base, "/servers/fake", { method: "PATCH", body: { enabled: true, auth: { type: "bearer", token: secret } }, cookie: admin });
      const responses = [created, patched, await call(base, "/servers", { cookie: admin }), await call(base, "/servers", { cookie: member })];
      for (const res of responses) {
        const text = JSON.stringify(res.body);
        expect(text).not.toContain(secret);
        expect(text).not.toContain(cipher);
        expect(text).not.toContain("credential_enc");
      }
    });
  });

  describe("tool rules", () => {
    const setRule = (tool: string, body: unknown, cookie = admin, slug = "fake") => call(base, `/servers/${slug}/tools/${tool}`, { method: "PATCH", body, cookie });

    beforeEach(async () => {
      await create({});
    });

    it("an admin marks a listed tool admin-only: stored, reported as listed, shown to admins and hidden from members", async () => {
      const res = await setRule("ping", { adminOnly: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tool: "ping", adminOnly: true, listed: true });
      const asAdmin = (await call(base, "/servers", { cookie: admin })).body[0];
      expect(asAdmin.tools).toEqual([{ name: "fake__ping", description: expect.any(String), adminOnly: true }]);
      expect(asAdmin.toolRules).toEqual([{ tool: "ping", adminOnly: true }]);
      const asMember = (await call(base, "/servers", { cookie: member })).body[0];
      expect(asMember.tools).toEqual([]);
      expect(JSON.stringify(asMember)).not.toMatch(/adminOnly|toolRules/);
    });

    it("can pre-mark a tool the server does not list; the answer says it is not listed", async () => {
      const res = await setRule("not_there_yet", { adminOnly: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tool: "not_there_yet", adminOnly: true, listed: false });
      expect((await call(base, "/servers", { cookie: admin })).body[0].toolRules).toEqual([{ tool: "not_there_yet", adminOnly: true }]);
    });

    it("false is stored as a rule too (so register-upstreams.sh knows an admin chose it) and hides nothing", async () => {
      await setRule("ping", { adminOnly: true });
      await setRule("ping", { adminOnly: false });
      expect((await call(base, "/servers", { cookie: admin })).body[0].toolRules).toEqual([{ tool: "ping", adminOnly: false }]);
      expect((await call(base, "/servers", { cookie: member })).body[0].tools).toHaveLength(1);
    });

    it("a member gets 403, nothing is stored", async () => {
      expect((await setRule("ping", { adminOnly: true }, member)).status).toBe(403);
      expect((await pool.query("SELECT 1 FROM tool_rules")).rowCount).toBe(0);
    });

    it("unknown server 404, bad body 400, bad tool name 400", async () => {
      expect((await setRule("ping", { adminOnly: true }, admin, "nope")).status).toBe(404);
      expect((await setRule("ping", { adminOnly: "yes" })).status).toBe(400);
      expect((await setRule("ping", { adminOnly: true, extra: 1 })).status).toBe(400);
      expect((await setRule("a".repeat(65), { adminOnly: true })).status).toBe(400);
      expect((await setRule("bad.name", { adminOnly: true })).status).toBe(400);
    });

    it("deleting the server deletes its rules", async () => {
      await setRule("ping", { adminOnly: true });
      await call(base, "/servers/fake", { method: "DELETE", cookie: admin });
      expect((await pool.query("SELECT 1 FROM tool_rules")).rowCount).toBe(0);
    });
  });
});
