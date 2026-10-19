import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { checkKey } from "./auth.js";
import type { NoteStore } from "./notes.js";
import { registerTools } from "./tools.js";

const MAX_BODY_BYTES = 1_000_000;

class BodyTooLarge extends Error {}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Keep the socket open long enough to send the 413; the rest of the body is read and thrown away.
        reject(new BodyTooLarge());
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain" }).end(body);
}

// Stateless: every POST builds a fresh MCP server and transport, so there is no session to lose on restart.
async function handleMcp(req: IncomingMessage, res: ServerResponse, key: string, store: NoteStore): Promise<void> {
  if (!checkKey(req.headers["x-notes-key"] as string | undefined, key)) {
    // One line, no header value: same shape as woo-mcp.
    console.warn(`rejected ${req.method} /mcp: missing or wrong x-notes-key header`);
    res.writeHead(401, { "Content-Type": "text/plain" }).end("unauthorized");
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" }).end();
    return;
  }
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (err) {
    if (err instanceof BodyTooLarge) send(res, 413, "body too large");
    else send(res, 400, "invalid JSON body");
    return;
  }
  const server = new McpServer({ name: "notes-mcp", version: "0.1.0" });
  registerTools(server, store);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export function createHttpServer(deps: { key: string; store: NoteStore }): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    // Probes carry no key. There is no backend to wait for, so ready equals alive.
    if (path === "/healthz") return send(res, 200, "ok");
    if (path === "/readyz") return send(res, 200, "ready");
    if (path === "/mcp") {
      handleMcp(req, res, deps.key, deps.store).catch((err: unknown) => {
        console.error("mcp request failed:", err instanceof Error ? err.message : err);
        if (!res.headersSent) send(res, 500, "internal error");
      });
      return;
    }
    send(res, 404, "not found");
  });
  // Node's defaults allow a client to hold a socket open for 5 minutes (slowloris).
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
