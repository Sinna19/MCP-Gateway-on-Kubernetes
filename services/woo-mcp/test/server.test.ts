import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../src/server.js";
import type { WooClient } from "../src/woo-client.js";

let server: Server | undefined;
const token = randomBytes(32).toString("hex");

async function start(request: ReturnType<typeof vi.fn>, list = vi.fn()): Promise<string> {
  server = createHttpServer({ woo: { request, list } as unknown as WooClient, token });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop() {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
}

afterEach(stop);

async function connect(base: string) {
  const client = new Client({ name: "t", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe("bearer token", () => {
  const post = (base: string, headers: Record<string, string>) =>
    fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });

  it("401 without a token, logging one line that does not contain a token", async () => {
    const base = await start(vi.fn());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post(base, {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    warn.mockRestore();
  });

  it("401 with a wrong token, and the wrong token is not logged", async () => {
    const base = await start(vi.fn());
    const wrong = randomBytes(32).toString("hex");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(base, { Authorization: `Bearer ${wrong}` })).status).toBe(401);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(wrong);
    warn.mockRestore();
  });

  it("probes need no token", async () => {
    const base = await start(vi.fn().mockResolvedValue([]));
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });
});

describe("http server", () => {
  it("serves the five tools over streamable http at /mcp", async () => {
    const client = await connect(await start(vi.fn()));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    await client.close();
  });

  it("answers a tool call end to end", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0, total_pages: 0 });
    const client = await connect(await start(vi.fn(), list));
    const res = await client.callTool({ name: "list_products", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(list).toHaveBeenCalledOnce();
    await client.close();
  });

  it("/healthz is 200 even when woo is down", async () => {
    const base = await start(vi.fn().mockRejectedValue(new Error("down")));
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it("/readyz is 200 when woo answers", async () => {
    const base = await start(vi.fn().mockResolvedValue([]));
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });

  it("/readyz is 503 when woo does not answer", async () => {
    const base = await start(vi.fn().mockRejectedValue(new Error("down")));
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
  });

  it("rejects an oversized body with 413", async () => {
    const base = await start(vi.fn());
    const big = JSON.stringify({ pad: "x".repeat(1_100_000) });
    const res = await fetch(`${base}/mcp`, { method: "POST", body: big, headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(413);
  });

  it("sets request and header timeouts", async () => {
    await start(vi.fn());
    expect(server!.requestTimeout).toBe(15_000);
    expect(server!.headersTimeout).toBe(10_000);
  });

  it("returns 404 for unknown paths and 405 for GET /mcp", async () => {
    const base = await start(vi.fn());
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(405);
  });
});
