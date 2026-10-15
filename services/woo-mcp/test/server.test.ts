import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../src/server.js";
import type { WooClient } from "../src/woo-client.js";

let server: Server | undefined;

async function start(request: ReturnType<typeof vi.fn>): Promise<string> {
  server = createHttpServer({ woo: { request } as unknown as WooClient });
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
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

describe("http server", () => {
  it("serves the five tools over streamable http at /mcp", async () => {
    const client = await connect(await start(vi.fn()));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    await client.close();
  });

  it("answers a tool call end to end", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const client = await connect(await start(request));
    const res = await client.callTool({ name: "list_products", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(request).toHaveBeenCalledOnce();
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

  it("returns 404 for unknown paths and 405 for GET /mcp", async () => {
    const base = await start(vi.fn());
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });
});
