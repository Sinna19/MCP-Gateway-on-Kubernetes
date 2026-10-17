import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlmError } from "../src/chat/errors.js";
import { createLlm } from "../src/chat/llm.js";

const API_KEY = randomBytes(16).toString("hex");
const user = [{ role: "user" as const, content: "hi" }];

describe("createLlm (against a local http server, no real provider)", () => {
  let http: Server;
  let base: string;
  let handler: (req: IncomingMessage, res: ServerResponse, body: string) => void;
  let seen: { url?: string; auth?: string; body?: Record<string, unknown> };

  beforeEach(async () => {
    seen = {};
    handler = (_req, res) => void res.end("{}");
    http = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) as Record<string, unknown> };
        handler(req, res, body);
      });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  const llm = (baseUrl = base) => createLlm({ baseUrl, model: "m1", apiKey: API_KEY });
  const reply = (res: ServerResponse, message: unknown) => void res.setHeader("content-type", "application/json").end(JSON.stringify({ choices: [{ message }] }));

  it("posts to <base>/chat/completions with the bearer key, model and tools", async () => {
    handler = (_req, res) => reply(res, { role: "assistant", content: "hello" });
    const tool = { type: "function" as const, function: { name: "a__b", description: "d", parameters: {} } };
    const out = await llm(`${base}/`)(user, [tool], AbortSignal.timeout(2000));
    expect(out).toEqual({ role: "assistant", content: "hello" });
    expect(seen.url).toBe("/chat/completions");
    expect(seen.auth).toBe(`Bearer ${API_KEY}`);
    expect(seen.body).toMatchObject({ model: "m1", parallel_tool_calls: false });
    expect(seen.body!.tools).toHaveLength(1);
  });

  it("parses tool_calls and drops malformed ones", async () => {
    handler = (_req, res) =>
      reply(res, {
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "woo__list_orders", arguments: '{"status":"processing"}' } },
          { id: "c2", function: { name: "woo__get_order", arguments: 42 } }, // arguments not a string: defaults to {}
          { function: { name: "no_id", arguments: "{}" } }, // no id
          { id: "c4", function: {} }, // no name
        ],
      });
    const out = await llm()(user, [], AbortSignal.timeout(2000));
    expect(out.content).toBeNull();
    expect(out.tool_calls).toEqual([
      { id: "c1", type: "function", function: { name: "woo__list_orders", arguments: '{"status":"processing"}' } },
      { id: "c2", type: "function", function: { name: "woo__get_order", arguments: "{}" } },
    ]);
    expect(seen.body).not.toHaveProperty("tools"); // no tools: no tools field and no parallel_tool_calls
  });

  it("keeps only content and tool_calls, so a reasoning field never goes back into history", async () => {
    handler = (_req, res) => reply(res, { role: "assistant", content: "ok", reasoning: "secret chain of thought" });
    const out = await llm()(user, [], AbortSignal.timeout(2000));
    expect(out).toEqual({ role: "assistant", content: "ok" });
  });

  it("rejects with the status only on a non-2xx, never the body or the key", async () => {
    handler = (_req, res) => void res.writeHead(500).end(`boom ${API_KEY} prompt text`);
    const err = await llm()(user, [], AbortSignal.timeout(2000)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).status).toBe(500);
    expect((err as Error).message).toBe("llm responded 500");
    expect((err as Error).message).not.toContain(API_KEY);
  });

  it("marks a provider 429 so the agent can say the model is rate limited", async () => {
    handler = (_req, res) => void res.writeHead(429).end("{}");
    const err = await llm()(user, [], AbortSignal.timeout(2000)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).status).toBe(429);
  });

  it("rejects when the provider never answers before the signal fires", async () => {
    handler = () => undefined; // never responds
    await expect(llm()(user, [], AbortSignal.timeout(150))).rejects.toThrow();
  });

  it("rejects a redirect instead of following it with the key", async () => {
    handler = (_req, res) => void res.writeHead(302, { location: "http://127.0.0.1:1/steal" }).end();
    await expect(llm()(user, [], AbortSignal.timeout(2000))).rejects.toThrow();
  });

  it("rejects a response with no message", async () => {
    handler = (_req, res) => void res.end(JSON.stringify({ choices: [] }));
    await expect(llm()(user, [], AbortSignal.timeout(2000))).rejects.toThrow("llm response had no message");
  });
});
