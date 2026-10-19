import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createKey, revokeKey } from "../src/api-keys.js";
import { createApp, type App } from "../src/app.js";
import { UpstreamManager } from "../src/upstreams.js";
import { FakeUpstream, waitFor } from "./fake-upstream.js";
import { createTestDb, resetData } from "./helpers.js";

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
};
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

describe("/mcp endpoint", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let manager: UpstreamManager;
  let app: App;
  let http: Server;
  let base: string;
  let clock = 0;
  let woo: FakeUpstream;
  let fx: FakeUpstream;
  let alice: { id: number; key: string; keyId: number };
  let bob: { id: number; key: string; keyId: number };
  const clients: Client[] = [];

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    clock = 1_000_000;
    woo = new FakeUpstream({ list_orders: (text) => `orders ${text ?? ""}` });
    fx = new FakeUpstream({ convert: () => "eur" });
    await woo.start();
    await fx.start();
    await pool.query("INSERT INTO upstream_servers (slug, url) VALUES ('woo', $1), ('fx', $2)", [woo.url, fx.url]);
    const makeUser = async (email: string) => {
      const { rows } = await pool.query("INSERT INTO users (email, role, password_hash) VALUES ($1, 'member', 'x') RETURNING id", [email]);
      const { id: keyId, key } = await createKey(pool, rows[0].id, "k");
      return { id: rows[0].id as number, key, keyId };
    };
    alice = await makeUser("alice@x.io");
    bob = await makeUser("bob@x.io");
    const credentialsKey = randomBytes(32);
    manager = new UpstreamManager({ pool, credentialsKey, callTimeoutMs: 500, connectTimeoutMs: 500, pingTimeoutMs: 300, allowLoopback: true });
    await manager.reload();
    app = createApp({ pool, upstreams: manager, credentialsKey, now: () => clock, idleMs: 30 * 60_000, limits: { loginPerEmail: 5, loginPerIp: 30, loginWindowMs: 900_000, mcpCallsPerMinute: 3, mcpSessionsPerKey: 2, chatDailyCap: 200 } });
    http = await new Promise<Server>((resolve) => {
      const s = app.express.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close().catch(() => undefined);
    app.closeSessions();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await manager.stop();
    await woo.stop();
    await fx.stop();
  });

  async function connect(key: string, onGet?: () => void): Promise<Client> {
    const client = new Client({ name: "test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
      fetch: (input, init) => {
        if (init?.method === "GET") onGet?.();
        return fetch(input, init);
      },
    });
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  async function rawInitialize(key: string): Promise<string> {
    const res = await fetch(base, { method: "POST", headers: { ...JSON_HEADERS, Authorization: `Bearer ${key}` }, body: JSON.stringify(INITIALIZE) });
    await res.text();
    return res.headers.get("mcp-session-id") ?? "";
  }

  const listRequest = (key: string, sessionId: string) =>
    fetch(base, {
      method: "POST",
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${key}`, "mcp-session-id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });

  it("rejects a missing, malformed or unknown key with 401", async () => {
    const attempts: Record<string, string>[] = [{}, { Authorization: "Bearer umk_nope" }, { Authorization: "Basic abc" }];
    for (const headers of attempts) {
      const res = await fetch(base, { method: "POST", headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(INITIALIZE) });
      expect(res.status).toBe(401);
    }
  });

  it("lists the tools of all enabled upstreams with slug prefixes", async () => {
    const client = await connect(alice.key);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["fx__convert", "woo__list_orders"]);
  });

  it("routes a call and audits it under the key's user, with its args and secret-looking fields redacted", async () => {
    const client = await connect(alice.key);
    const result = await client.callTool({ name: "woo__list_orders", arguments: { text: "visible-arg", token: "hidden-arg" } });
    expect(JSON.stringify(result.content)).toContain("orders visible-arg");
    const { rows } = await pool.query("SELECT * FROM audit_log");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: alice.id, server_slug: "woo", tool: "list_orders", outcome: "ok", source: "mcp", args: { text: "visible-arg", token: "[redacted]" } });
    expect(JSON.stringify(rows)).not.toContain("hidden-arg");
  });

  it("returns an error result for an unknown tool", async () => {
    const client = await connect(alice.key);
    const result = await client.callTool({ name: "ghost__nothing", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("returns an error result naming a slow upstream", async () => {
    woo.addTool("slow", () => new Promise((r) => setTimeout(() => r("late"), 1500)));
    await waitFor(() => manager.tools().some((t) => t.name === "woo__slow"));
    const client = await connect(alice.key);
    const result = await client.callTool({ name: "woo__slow", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("server 'woo' timed out after 0.5s");
  });

  it("never forwards the client's key to an upstream", async () => {
    const client = await connect(alice.key);
    await client.callTool({ name: "woo__list_orders", arguments: {} });
    const seen = [...woo.headers, ...fx.headers].map((h) => JSON.stringify(h));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join()).not.toContain(alice.key);
    expect(seen.join()).not.toContain("umk_");
  });

  it("stops accepting a key as soon as it is revoked, even inside an open session", async () => {
    const client = await connect(bob.key);
    await client.listTools();
    await revokeKey(pool, bob.keyId);
    await expect(client.listTools()).rejects.toThrow();
    const res = await fetch(base, { method: "POST", headers: { ...JSON_HEADERS, Authorization: `Bearer ${bob.key}` }, body: JSON.stringify(INITIALIZE) });
    expect(res.status).toBe(401);
  });

  it("tells open clients the list changed when an upstream is disabled", async () => {
    let gets = 0;
    let notified = 0;
    const client = new Client({ name: "test", version: "1" });
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      notified++;
    });
    const transport = new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${alice.key}` } },
      fetch: (input, init) => {
        if (init?.method === "GET") gets++;
        return fetch(input, init);
      },
    });
    await client.connect(transport);
    clients.push(client);
    await waitFor(() => gets > 0);
    await new Promise((r) => setTimeout(r, 100)); // the server registers the stream just after the GET arrives
    await pool.query("UPDATE upstream_servers SET enabled = false WHERE slug = 'fx'");
    await manager.reload();
    await waitFor(() => notified > 0);
    expect(notified).toBe(1);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["woo__list_orders"]);
  });

  it("DELETE ends the session; the id then returns 404", async () => {
    const sessionId = await rawInitialize(alice.key);
    expect(sessionId).not.toBe("");
    expect((await listRequest(alice.key, sessionId)).status).toBe(200);
    const del = await fetch(base, { method: "DELETE", headers: { Authorization: `Bearer ${alice.key}`, "mcp-session-id": sessionId } });
    expect(del.status).toBeLessThan(300);
    expect((await listRequest(alice.key, sessionId)).status).toBe(404);
    expect(app.sessionCount()).toBe(0);
  });

  // The second half of the handshake. A client that never sends it is dropped by the sweep after 60s.
  const sendInitialized = (key: string, sessionId: string) =>
    fetch(base, {
      method: "POST",
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${key}`, "mcp-session-id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }).then(async (res) => {
      await res.text();
      return res;
    });

  it("closes sessions idle for more than 30 minutes", async () => {
    const sessionId = await rawInitialize(alice.key);
    await sendInitialized(alice.key, sessionId);
    expect(app.sessionCount()).toBe(1);
    clock += 29 * 60_000;
    app.sweep();
    expect(app.sessionCount()).toBe(1);
    clock += 2 * 60_000;
    app.sweep();
    expect(app.sessionCount()).toBe(0);
    expect((await listRequest(alice.key, sessionId)).status).toBe(404);
  });

  const initializeRaw = (key: string) => fetch(base, { method: "POST", headers: { ...JSON_HEADERS, Authorization: `Bearer ${key}` }, body: JSON.stringify(INITIALIZE) });

  it("caps open sessions per key (2 in this suite): the next initialize gets 429 + a JSON-RPC error, nobody is evicted", async () => {
    const a = await rawInitialize(alice.key);
    const b = await rawInitialize(alice.key);
    const res = await initializeRaw(alice.key);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000, message: expect.stringContaining("too many open sessions") } });
    expect(app.sessionCount()).toBe(2);
    expect((await listRequest(alice.key, a)).status).toBe(200); // both earlier sessions still work
    expect((await listRequest(alice.key, b)).status).toBe(200);
  });

  it("counts sessions per key: another key can still open one, and closing one frees a slot", async () => {
    const a = await rawInitialize(alice.key);
    await rawInitialize(alice.key);
    expect((await initializeRaw(bob.key)).status).toBe(200);
    expect((await initializeRaw(alice.key)).status).toBe(429);
    await fetch(base, { method: "DELETE", headers: { Authorization: `Bearer ${alice.key}`, "mcp-session-id": a } });
    expect((await initializeRaw(alice.key)).status).toBe(200);
  });

  it("drops a session whose initialize never completed after 60s, but keeps a completed one", async () => {
    const half = await rawInitialize(alice.key); // never sends notifications/initialized
    const full = await rawInitialize(bob.key);
    expect((await sendInitialized(bob.key, full)).status).toBeLessThan(300);
    clock += 50_000;
    app.sweep();
    expect(app.sessionCount()).toBe(2); // still within the 60s grace
    clock += 11_000;
    app.sweep();
    expect(app.sessionCount()).toBe(1);
    expect((await listRequest(alice.key, half)).status).toBe(404);
    expect((await listRequest(bob.key, full)).status).toBe(200);
  });

  it("frees the cap once a failed initialize is swept", async () => {
    await rawInitialize(alice.key);
    await rawInitialize(alice.key);
    expect((await initializeRaw(alice.key)).status).toBe(429);
    clock += 61_000;
    app.sweep();
    expect((await initializeRaw(alice.key)).status).toBe(200);
  });

  const callRequest = (key: string, sessionId: string, name = "fx__does_not_exist") =>
    fetch(base, {
      method: "POST",
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${key}`, "mcp-session-id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: {} } }),
    }).then(async (res) => {
      await res.text();
      return res;
    });

  it("limits tools/call per key (3 per minute in this suite): 429 with Retry-After and a JSON-RPC error", async () => {
    const sessionId = await rawInitialize(alice.key);
    // An unknown tool still counts: the limit runs before any tool lookup.
    for (let i = 0; i < 3; i++) expect((await callRequest(alice.key, sessionId)).status).toBe(200);
    const res = await fetch(base, {
      method: "POST",
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${alice.key}`, "mcp-session-id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "fx__does_not_exist", arguments: {} } }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", id: 4, error: { code: -32000, message: expect.stringContaining("rate limit") } });
  });

  it("does not count tools/list, and one key's limit does not touch another key", async () => {
    const a = await rawInitialize(alice.key);
    const b = await rawInitialize(bob.key);
    for (let i = 0; i < 6; i++) expect((await listRequest(alice.key, a)).status).toBe(200);
    for (let i = 0; i < 3; i++) await callRequest(alice.key, a);
    expect((await callRequest(alice.key, a)).status).toBe(429);
    expect((await callRequest(bob.key, b)).status).toBe(200);
  });

  it("allows calls again when the minute is over", async () => {
    const sessionId = await rawInitialize(alice.key);
    for (let i = 0; i < 3; i++) await callRequest(alice.key, sessionId);
    expect((await callRequest(alice.key, sessionId)).status).toBe(429);
    clock += 60_000;
    expect((await callRequest(alice.key, sessionId)).status).toBe(200);
  });

  it("a session can only be used with the key that opened it", async () => {
    const sessionId = await rawInitialize(alice.key);
    expect((await listRequest(bob.key, sessionId)).status).toBe(404);
    expect((await listRequest(alice.key, sessionId)).status).toBe(200);
  });

  it("unknown session id gets 404 and a non-initialize request without a session gets 400", async () => {
    expect((await listRequest(alice.key, "does-not-exist")).status).toBe(404);
    const res = await fetch(base, { method: "POST", headers: { ...JSON_HEADERS, Authorization: `Bearer ${alice.key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    expect(res.status).toBe(400);
  });

  it("/healthz and /readyz answer without a key", async () => {
    const root = base.replace("/mcp", "");
    expect((await fetch(`${root}/healthz`)).status).toBe(200);
    expect((await fetch(`${root}/readyz`)).status).toBe(200);
  });
});
