import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { NoteStore } from "../src/notes.js";
import { createHttpServer } from "../src/server.js";

const key = randomBytes(24).toString("hex");
let server: Server | undefined;

async function start(store = new NoteStore()): Promise<string> {
  server = createHttpServer({ key, store });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
});

async function connect(base: string) {
  const client = new Client({ name: "t", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { "X-Notes-Key": key } } }),
  );
  return client;
}

function textOf(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
});
const mcpHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

describe("auth", () => {
  it("401 when the key header is missing", async () => {
    const res = await fetch(`${await start()}/mcp`, { method: "POST", headers: mcpHeaders, body: initialize });
    expect(res.status).toBe(401);
  });

  it("401 with a wrong key", async () => {
    const headers = { ...mcpHeaders, "X-Notes-Key": randomBytes(24).toString("hex") };
    const res = await fetch(`${await start()}/mcp`, { method: "POST", headers, body: initialize });
    expect(res.status).toBe(401);
  });

  it("a bearer token is not accepted in place of the header", async () => {
    const headers = { ...mcpHeaders, Authorization: `Bearer ${key}` };
    const res = await fetch(`${await start()}/mcp`, { method: "POST", headers, body: initialize });
    expect(res.status).toBe(401);
  });

  it("logs one line per 401 and never the sent key", async () => {
    const base = await start();
    const wrong = randomBytes(24).toString("hex");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fetch(`${base}/mcp`, { method: "POST", headers: { ...mcpHeaders, "X-Notes-Key": wrong }, body: initialize });
    await fetch(`${base}/mcp`, { method: "POST", headers: { ...mcpHeaders, Authorization: `Bearer ${key}` }, body: initialize });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toBe("rejected POST /mcp: missing or wrong x-notes-key header");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(wrong);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(key);
    warn.mockRestore();
  });

  it("probes need no key", async () => {
    const base = await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });

  it("405 on GET /mcp with the key, 404 elsewhere", async () => {
    const base = await start();
    expect((await fetch(`${base}/mcp`, { headers: { "X-Notes-Key": key } })).status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("413 on a body over 1 MB", async () => {
    const res = await fetch(`${await start()}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders, "X-Notes-Key": key },
      body: "x".repeat(1_000_001),
    });
    expect(res.status).toBe(413);
  });
});

describe("tools", () => {
  it("lists exactly add_note, list_notes and list_products", async () => {
    const client = await connect(await start());
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["add_note", "list_notes", "list_products"]);
    await client.close();
  });

  it("notes added in one request show up in the next (shared store)", async () => {
    const base = await start();
    const first = await connect(base);
    await first.callTool({ name: "add_note", arguments: { text: "restock mugs", product: "Mug" } });
    await first.close();
    const second = await connect(base);
    const listed = JSON.parse(textOf(await second.callTool({ name: "list_notes", arguments: {} })));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ text: "restock mugs", product: "Mug" });
    await second.close();
  });

  it("list_products counts products named in notes, ignoring case", async () => {
    const client = await connect(await start());
    await client.callTool({ name: "add_note", arguments: { text: "a", product: "Mug" } });
    await client.callTool({ name: "add_note", arguments: { text: "b", product: "mug" } });
    const res = JSON.parse(textOf(await client.callTool({ name: "list_products", arguments: {} })));
    expect(res).toEqual([{ product: "Mug", notes: 2 }]);
    await client.close();
  });

  it("list_notes rejects a limit over 50", async () => {
    const client = await connect(await start());
    const res = await client.callTool({ name: "list_notes", arguments: { limit: 51 } });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("a full store returns an isError tool result, not an HTTP 500", async () => {
    const store = new NoteStore();
    for (let i = 0; i < 500; i++) store.add("n");
    const client = await connect(await start(store));
    const res = await client.callTool({ name: "add_note", arguments: { text: "one too many" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/500/);
    await client.close();
  });

  it("an over-long product tag is a tool error", async () => {
    const client = await connect(await start());
    const res = await client.callTool({ name: "add_note", arguments: { text: "a", product: "x".repeat(101) } });
    expect(res.isError).toBe(true);
    await client.close();
  });
});
