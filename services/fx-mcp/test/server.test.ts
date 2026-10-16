import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../src/server.js";

const token = randomBytes(24).toString("hex");
let server: Server | undefined;

async function start(): Promise<string> {
  server = createHttpServer({ token });
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
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

function textOf(res: unknown): string {
  return ((res as { content: { text: string }[] }).content)[0]!.text;
}

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
});
const mcpHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

describe("auth", () => {
  it("401 with WWW-Authenticate when no token", async () => {
    const res = await fetch(`${await start()}/mcp`, { method: "POST", headers: mcpHeaders, body: initialize });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("401 with a wrong token", async () => {
    const headers = { ...mcpHeaders, Authorization: `Bearer ${randomBytes(24).toString("hex")}` };
    const res = await fetch(`${await start()}/mcp`, { method: "POST", headers, body: initialize });
    expect(res.status).toBe(401);
  });

  it("probes need no token", async () => {
    const base = await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });
});

describe("tools", () => {
  it("lists the two tools", async () => {
    const client = await connect(await start());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["convert_currency", "list_rates"]);
    await client.close();
  });

  it("convert_currency end to end, lowercase codes accepted", async () => {
    const client = await connect(await start());
    const res = await client.callTool({ name: "convert_currency", arguments: { amount: 100, from: "usd", to: "eur" } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(textOf(res))).toMatchObject({ from: "USD", to: "EUR", rate: 0.92, result: 92 });
    await client.close();
  });

  it("unknown currency is a tool error, not a crash", async () => {
    const client = await connect(await start());
    const res = await client.callTool({ name: "convert_currency", arguments: { amount: 1, from: "USD", to: "XXX" } });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("amount above 1e12 is rejected", async () => {
    const client = await connect(await start());
    const res = await client.callTool({ name: "convert_currency", arguments: { amount: 2e12, from: "USD", to: "EUR" } });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("list_rates defaults the base to USD and validates it", async () => {
    const client = await connect(await start());
    const ok = await client.callTool({ name: "list_rates", arguments: {} });
    expect(JSON.parse(textOf(ok))).toMatchObject({ base: "USD" });
    const bad = await client.callTool({ name: "list_rates", arguments: { base: "EURO" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});

describe("http hygiene", () => {
  it("413 for an oversized body", async () => {
    const res = await fetch(`${await start()}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pad: "x".repeat(1_100_000) }),
    });
    expect(res.status).toBe(413);
  });

  it("404 unknown path, 405 GET /mcp, timeouts set", async () => {
    const base = await start();
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    const get = await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${token}` } });
    expect(get.status).toBe(405);
    expect(server!.requestTimeout).toBe(15_000);
    expect(server!.headersTimeout).toBe(10_000);
  });
});
