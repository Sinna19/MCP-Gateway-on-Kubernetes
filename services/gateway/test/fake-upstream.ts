import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import net from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export type ToolHandler = (text: string | undefined) => Promise<string> | string;

// A small stateful MCP server for tests. It records what it receives so tests can assert on it.
export class FakeUpstream {
  url = "";
  headers: IncomingMessage["headers"][] = [];
  methods: string[] = [];
  requests: string[] = []; // HTTP verb of each request, same order as headers
  private http?: Server;
  private port = 0;
  private sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

  constructor(private tools: Record<string, ToolHandler>) {}

  count(method: string): number {
    return this.methods.filter((m) => m === method).length;
  }

  async start(): Promise<string> {
    this.http = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.http!.listen(this.port, "127.0.0.1", resolve));
    this.port = (this.http.address() as net.AddressInfo).port;
    this.url = `http://127.0.0.1:${this.port}/mcp`;
    return this.url;
  }

  async stop(): Promise<void> {
    this.sessions.clear();
    this.http?.closeAllConnections();
    await new Promise<void>((resolve) => this.http?.close(() => resolve()) ?? resolve());
  }

  // Registering a tool on a live session makes the SDK send notifications/tools/list_changed.
  addTool(name: string, handler: ToolHandler): void {
    this.tools[name] = handler;
    for (const { server } of this.sessions.values()) this.register(server, name, handler);
  }

  private register(server: McpServer, name: string, handler: ToolHandler): void {
    server.registerTool(name, { description: `fake ${name}`, inputSchema: { text: z.string().optional() } }, async ({ text }) => ({
      content: [{ type: "text" as const, text: await handler(text) }],
    }));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.headers.push(req.headers);
    this.requests.push(req.method ?? "");
    let body: unknown;
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const method = (body as { method?: string }).method;
      if (method) this.methods.push(method);
    }
    const sessionId = req.headers["mcp-session-id"];
    const known = typeof sessionId === "string" ? this.sessions.get(sessionId) : undefined;
    if (known) return known.transport.handleRequest(req, res, body);
    if (req.method === "POST" && isInitializeRequest(body)) {
      const server = new McpServer({ name: "fake", version: "1.0.0" });
      for (const [name, handler] of Object.entries(this.tools)) this.register(server, name, handler);
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id: string) => {
          this.sessions.set(id, { transport, server });
        },
      });
      await server.connect(transport);
      return transport.handleRequest(req, res, body);
    }
    res.writeHead(404).end();
  }
}

// Accepts TCP connections and never answers: a hung upstream.
export async function startHungServer(): Promise<{ url: string; stop: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    stop: async () => {
      sockets.forEach((s) => s.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}
