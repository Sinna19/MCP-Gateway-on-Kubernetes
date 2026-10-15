import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.js";
import type { WooClient } from "./woo-client.js";

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
async function handleMcp(req: IncomingMessage, res: ServerResponse, woo: WooClient): Promise<void> {
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
  const server = new McpServer({ name: "woo-mcp", version: "0.1.0" });
  registerTools(server, woo);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export function createHttpServer(deps: { woo: WooClient }): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/healthz") return send(res, 200, "ok");
    if (path === "/readyz") {
      // Ready only if Woo answers with our credentials.
      deps.woo.request("GET", "/products", { query: { per_page: 1 } }).then(
        () => send(res, 200, "ready"),
        () => send(res, 503, "woocommerce unreachable"),
      );
      return;
    }
    if (path === "/mcp") {
      handleMcp(req, res, deps.woo).catch((err: unknown) => {
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
