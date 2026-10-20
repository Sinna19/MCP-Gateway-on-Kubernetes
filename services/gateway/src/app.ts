import express, { type ErrorRequestHandler, type Express } from "express";
import type pg from "pg";
import { KeyUsage } from "./api-keys.js";
import { ChatAgent } from "./chat/agent.js";
import { purgeOldChatUsage, takeChatTurn } from "./chat/daily-cap.js";
import { ChatError } from "./chat/errors.js";
import { PendingStore } from "./chat/pending.js";
import type { LlmFn } from "./chat/types.js";
import { Gateway, type ToolBackend } from "./gateway.js";
import { createApiRouter } from "./api/router.js";
import { createMcpEndpoint } from "./mcp-endpoint.js";
import { DEFAULT_LIMITS, FixedWindowLimiter, type Limits } from "./rate-limit.js";
import { deleteExpiredSessions } from "./sessions.js";
import type { UpstreamControl } from "./upstreams.js";

const PURGE_EVERY_MS = 60 * 60_000;

export interface AppOptions {
  pool: pg.Pool;
  upstreams: ToolBackend & UpstreamControl & { on(event: "toolsChanged", listener: () => void): unknown };
  credentialsKey: Buffer;
  idleMs?: number;
  now?: () => number;
  cookieSecure?: boolean;
  allowLoopback?: boolean; // tests only: lets /api/servers accept 127.0.0.1 upstream URLs
  llm?: LlmFn; // unset = /api/chat answers 503
  chatReadOnlyTools?: Set<string>; // tools chat may run without a confirm; empty = confirm everything
  limits?: Limits; // rate limits; DEFAULT_LIMITS when unset
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
  const now = options.now ?? Date.now;
  const limits = options.limits ?? DEFAULT_LIMITS;
  // One agent for the whole app, so the in-flight set and the pending confirms are shared by all requests.
  // beforeTurn is the daily cap: it runs once per POST /api/chat, after the busy check and before any LLM call.
  const chat = options.llm
    ? new ChatAgent({
        gateway,
        llm: options.llm,
        readOnlyTools: options.chatReadOnlyTools ?? new Set(),
        pending: new PendingStore(),
        beforeTurn: async (user) => {
          const taken = await takeChatTurn(pool, user.id, limits.chatDailyCap, now);
          if (!taken.ok) throw new ChatError(429, `daily chat limit reached (${limits.chatDailyCap} messages), it resets at 00:00 UTC`, taken.retryAfterSeconds);
        },
      })
    : null;
  const keyUsage = new KeyUsage(now);
  const mcp = createMcpEndpoint({ pool, gateway, idleMs: options.idleMs ?? 30 * 60_000, now, callsPerMinute: limits.mcpCallsPerMinute, sessionsPerKey: limits.mcpSessionsPerKey, keyUsage });
  upstreams.on("toolsChanged", mcp.notifyToolsChanged);
  const login = { ip: new FixedWindowLimiter(limits.loginPerIp, limits.loginWindowMs, now), email: new FixedWindowLimiter(limits.loginPerEmail, limits.loginWindowMs, now) };

  const app = express();
  app.disable("x-powered-by");
  // One proxy (Traefik) sits in front: req.ip is the client address it appended to X-Forwarded-For. Traefik
  // overwrites a client-sent value and the NetworkPolicy lets only Traefik reach us (ADR 019, 020).
  app.set("trust proxy", 1);
  app.get("/healthz", (_req, res) => void res.send("ok"));
  app.get("/readyz", (_req, res) => {
    pool.query("SELECT 1").then(
      () => res.send("ready"),
      () => res.status(503).send("database unreachable"),
    );
  });
  app.use("/mcp", mcp.router);
  app.use("/api", createApiRouter({ pool, upstreams, credentialsKey: options.credentialsKey, cookieSecure: options.cookieSecure ?? false, allowLoopback: options.allowLoopback, chat, login, sessions: mcp, keyUsage }));
  app.use(jsonErrors);

  // Database cleanup is slow to matter, so it runs at most once an hour. The first sweep after start runs it.
  let lastPurge = Number.NEGATIVE_INFINITY;
  const purge = () => {
    Promise.all([deleteExpiredSessions(pool), purgeOldChatUsage(pool, now)]).then(
      ([sessions]) => console.log(`swept ${sessions} expired sessions`), // the count only
      (err: unknown) => console.error("purge failed:", err instanceof Error ? err.message : err),
    );
  };

  const sweep = () => {
    mcp.sweep();
    login.ip.sweep();
    login.email.sweep();
    keyUsage.sweep();
    if (now() - lastPurge >= PURGE_EVERY_MS) {
      lastPurge = now();
      purge();
    }
  };
  return { express: app, gateway, sessionCount: mcp.sessionCount, sweep, closeSessions: mcp.closeAll };
}
