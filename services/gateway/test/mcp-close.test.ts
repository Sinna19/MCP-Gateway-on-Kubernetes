import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createKey } from "../src/api-keys.js";
import { call, login, makeUser, startServer, type TestServer } from "./api-helpers.js";
import { createTestDb, resetData } from "./helpers.js";

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Revoking a key, disabling a user or changing a role must end the open MCP sessions and their SSE streams at once.
describe("closing /mcp sessions from the dashboard API", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: TestServer;
  let adminCookie: string;
  let alice: { id: number; keys: { id: number; key: string }[] };
  let bob: { id: number; keys: { id: number; key: string }[] };

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    await makeUser(pool, "admin@x.io", "admin");
    const makeMember = async (email: string, keyCount: number) => {
      const id = await makeUser(pool, email);
      const keys = [];
      for (let i = 0; i < keyCount; i++) keys.push(await createKey(pool, id, `k${i}`));
      return { id, keys };
    };
    alice = await makeMember("alice@x.io", 2);
    bob = await makeMember("bob@x.io", 1);
    server = await startServer(pool);
    adminCookie = await login(server.base, "admin@x.io");
  });
  afterEach(async () => {
    await server.stop();
  });

  // An initialized session plus an open GET stream. `ended()` says whether the stream was cut within 1.5s.
  async function openSession(key: string) {
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${key}` };
    const init = await fetch(`${server.base}/mcp`, { method: "POST", headers, body: JSON.stringify(INITIALIZE) });
    await init.text();
    const sessionId = init.headers.get("mcp-session-id") ?? "";
    expect(sessionId).not.toBe("");
    const stream = await fetch(`${server.base}/mcp`, { method: "GET", headers: { Accept: "text/event-stream", Authorization: `Bearer ${key}`, "mcp-session-id": sessionId } });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const drained = (async () => {
      try {
        for (;;) if ((await reader.read()).done) return true;
      } catch {
        return true; // a reset connection is also "closed"
      }
    })();
    return { sessionId, ended: async () => Promise.race([drained, sleep(1500).then(() => false)]) };
  }
  const stillOpen = async (s: { ended: () => Promise<boolean> }) => !(await s.ended());

  it("revoking a key closes that key's session and stream, and no other", async () => {
    const [k1, k2] = alice.keys;
    const a1 = await openSession(k1!.key);
    const a2 = await openSession(k2!.key);
    const b = await openSession(bob.keys[0]!.key);
    expect(server.app.sessionCount()).toBe(3);
    const aliceCookie = await login(server.base, "alice@x.io");
    expect((await call(server.base, `/keys/${k1!.id}`, { method: "DELETE", cookie: aliceCookie })).status).toBe(204);
    expect(await a1.ended()).toBe(true);
    expect(server.app.sessionCount()).toBe(2);
    expect(await stillOpen(a2)).toBe(true);
    expect(await stillOpen(b)).toBe(true);
  });

  it("an admin revoking someone's key closes it too", async () => {
    const s = await openSession(bob.keys[0]!.key);
    expect((await call(server.base, `/keys/${bob.keys[0]!.id}`, { method: "DELETE", cookie: adminCookie })).status).toBe(204);
    expect(await s.ended()).toBe(true);
    expect(server.app.sessionCount()).toBe(0);
  });

  it("a refused revoke (someone else's key id) closes nothing", async () => {
    const s = await openSession(bob.keys[0]!.key);
    const aliceCookie = await login(server.base, "alice@x.io");
    expect((await call(server.base, `/keys/${bob.keys[0]!.id}`, { method: "DELETE", cookie: aliceCookie })).status).toBe(404);
    expect(await stillOpen(s)).toBe(true);
  });

  it("disabling a user closes every session of all their keys", async () => {
    const a1 = await openSession(alice.keys[0]!.key);
    const a2 = await openSession(alice.keys[1]!.key);
    const b = await openSession(bob.keys[0]!.key);
    expect((await call(server.base, `/members/${alice.id}`, { method: "PATCH", body: { disabled: true }, cookie: adminCookie })).status).toBe(200);
    expect(await a1.ended()).toBe(true);
    expect(await a2.ended()).toBe(true);
    expect(server.app.sessionCount()).toBe(1);
    expect(await stillOpen(b)).toBe(true);
  });

  it("changing a role closes the user's sessions (the tool list will depend on the role)", async () => {
    const a = await openSession(alice.keys[0]!.key);
    const b = await openSession(bob.keys[0]!.key);
    expect((await call(server.base, `/members/${alice.id}`, { method: "PATCH", body: { role: "admin" }, cookie: adminCookie })).status).toBe(200);
    expect(await a.ended()).toBe(true);
    expect(await stillOpen(b)).toBe(true);
  });

  it("setting the role a user already has closes nothing", async () => {
    const a = await openSession(alice.keys[0]!.key);
    expect((await call(server.base, `/members/${alice.id}`, { method: "PATCH", body: { role: "member" }, cookie: adminCookie })).status).toBe(200);
    expect(await stillOpen(a)).toBe(true);
  });

  it("re-enabling a user closes nothing", async () => {
    await call(server.base, `/members/${bob.id}`, { method: "PATCH", body: { disabled: true }, cookie: adminCookie });
    const a = await openSession(alice.keys[0]!.key);
    expect((await call(server.base, `/members/${bob.id}`, { method: "PATCH", body: { disabled: false }, cookie: adminCookie })).status).toBe(200);
    expect(await stillOpen(a)).toBe(true);
  });
});
