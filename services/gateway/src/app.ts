import express, { type ErrorRequestHandler, type Express } from "express";
import type pg from "pg";
import { Gateway, type ToolBackend } from "./gateway.js";
import { createApiRouter } from "./api/router.js";
import { createMcpEndpoint } from "./mcp-endpoint.js";

export interface AppOptions {
  pool: pg.Pool;
  upstreams: ToolBackend & { on(event: "toolsChanged", listener: () => void): unknown };
  idleMs?: number;
  now?: () => number;
  cookieSecure?: boolean;
}

export interface App {
  express: Express;
  gateway: Gateway;
  sessionCount: () => number;
  sweep: () => void;
  closeSessions: () => void;
}

// Express treats a handler as an error handler only if it declares four arguments.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const jsonErrors: ErrorRequestHandler = (err: { status?: number; type?: string }, _req, res, _next) => {
  const status = err.type === "entity.too.large" ? 413 : err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 413 ? "body too large" : status < 500 ? "bad request" : "internal error" });
};

export function createApp(options: AppOptions): App {
  const { pool, upstreams } = options;
  const gateway = new Gateway(pool, upstreams);
  const mcp = createMcpEndpoint({ pool, gateway, idleMs: options.idleMs ?? 30 * 60_000, now: options.now ?? Date.now });
  upstreams.on("toolsChanged", mcp.notifyToolsChanged);

  const app = express();
  app.disable("x-powered-by");
  app.get("/healthz", (_req, res) => void res.send("ok"));
  app.get("/readyz", (_req, res) => {
    pool.query("SELECT 1").then(
      () => res.send("ready"),
      () => res.status(503).send("database unreachable"),
    );
  });
  app.use("/mcp", express.json({ limit: "1mb" }), mcp.router);
  app.use("/api", createApiRouter({ pool, cookieSecure: options.cookieSecure ?? false }));
  app.use(jsonErrors);

  return { express: app, gateway, sessionCount: mcp.sessionCount, sweep: mcp.sweep, closeSessions: mcp.closeAll };
}
