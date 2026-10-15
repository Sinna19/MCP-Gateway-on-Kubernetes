import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type pg from "pg";
import { findUserByKey, hashKey, type AuthUser } from "./api-keys.js";
import type { Gateway } from "./gateway.js";

interface Session {
  server: Server;
  transport: StreamableHTTPServerTransport;
  keyHash: string;
  lastActive: number;
}

export interface McpEndpointOptions {
  pool: pg.Pool;
  gateway: Gateway;
  idleMs: number;
  now: () => number;
}

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

// The aggregated MCP endpoint. Stateful: one MCP Server per session so we can push tools/list_changed.
// This keeps sessions in memory, so the gateway runs as a single replica (ADR 006).
export function createMcpEndpoint(options: McpEndpointOptions) {
  const { pool, gateway, idleMs, now } = options;
  const sessions = new Map<string, Session>();

  function closeSession(id: string): void {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id); // first, so the close callbacks below find nothing left to do
    void session.server.close().catch(() => undefined);
  }

  function newSession(user: AuthUser, keyHash: string): StreamableHTTPServerTransport {
    const server = new Server({ name: "urumi-gateway", version: "0.1.0" }, { capabilities: { tools: { listChanged: true } } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: gateway.listTools() }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => gateway.callTool(user, request.params.name, request.params.arguments, "mcp"));
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id: string) => {
        sessions.set(id, { server, transport, keyHash, lastActive: now() });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) closeSession(transport.sessionId);
    };
    void server.connect(transport);
    return transport;
  }

  // Runs on every request, so a revoked key stops working at once, even inside an open session.
  const authenticate: RequestHandler = async (req, res, next) => {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    const user = match?.[1] ? await findUserByKey(pool, match[1]) : null;
    if (!match?.[1] || !user) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "invalid or missing API key" });
      return;
    }
    res.locals.user = user;
    res.locals.keyHash = hashKey(match[1]);
    next();
  };

  async function handle(req: Request, res: Response): Promise<void> {
    const user = res.locals.user as AuthUser;
    const keyHash = res.locals.keyHash as string;
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId === "string") {
      const session = sessions.get(sessionId);
      // A session of someone else's key looks the same as one that does not exist.
      if (!session || session.keyHash !== keyHash) return rpcError(res, 404, -32001, "Session not found");
      session.lastActive = now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }
    if (req.method === "POST" && isInitializeRequest(req.body)) {
      await newSession(user, keyHash).handleRequest(req, res, req.body);
      return;
    }
    rpcError(res, 400, -32000, "Bad Request: no valid session id");
  }

  const guarded: RequestHandler = (req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error("mcp request failed:", err instanceof Error ? err.message : err);
      if (!res.headersSent) rpcError(res, 500, -32603, "Internal server error");
    });
  };

  const router = Router();
  router.post("/", authenticate, guarded);
  router.get("/", authenticate, guarded);
  router.delete("/", authenticate, guarded);

  return {
    router,
    sessionCount: () => sessions.size,
    // Tell every open client the tool list changed (it should call tools/list again).
    notifyToolsChanged: () => {
      for (const { server } of sessions.values()) void server.sendToolListChanged().catch(() => undefined);
    },
    sweep: () => {
      for (const [id, session] of sessions) if (now() - session.lastActive > idleMs) closeSession(id);
    },
    closeAll: () => {
      for (const id of [...sessions.keys()]) closeSession(id);
    },
  };
}
