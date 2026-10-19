import express, { Router } from "express";
import type pg from "pg";
import { auditRoutes } from "./audit.js";
import { authRoutes, type LoginLimiters } from "./auth.js";
import { chatRoutes } from "./chat.js";
import { apiErrors } from "./errors.js";
import { inviteRoutes } from "./invites.js";
import { keyRoutes } from "./keys.js";
import { memberRoutes } from "./members.js";
import { loadUser, requireJsonBody } from "./middleware.js";
import { serverRoutes } from "./servers.js";
import type { ChatAgent } from "../chat/agent.js";
import type { UpstreamControl } from "../upstreams.js";

export interface ApiOptions {
  pool: pg.Pool;
  upstreams: UpstreamControl;
  credentialsKey: Buffer;
  cookieSecure: boolean;
  allowLoopback?: boolean; // tests only
  chat: ChatAgent | null;
  login: LoginLimiters;
  sessions: SessionControl; // ends open /mcp sessions when access changes
}

// Which /mcp sessions to end: the ones opened with one key, or all of one user's.
export interface SessionControl {
  closeKeySessions: (keyHash: string) => void;
  closeUserSessions: (userId: number) => void;
}

// Everything under /api: JSON only, session cookie auth, one error handler at the end.
export function createApiRouter({ pool, upstreams, credentialsKey, cookieSecure, allowLoopback, chat, login, sessions }: ApiOptions): Router {
  const router = Router();
  router.use(requireJsonBody);
  // Chat has its own, smaller cap. body-parser skips a body that is already parsed, so this must come first.
  router.use("/chat", express.json({ limit: "64kb" }));
  router.use(express.json({ limit: "100kb" }), loadUser(pool));
  router.use(authRoutes(pool, cookieSecure, login));
  router.use(inviteRoutes(pool, cookieSecure));
  router.use(memberRoutes(pool, sessions));
  router.use(keyRoutes(pool, sessions));
  router.use(auditRoutes(pool));
  router.use(serverRoutes(pool, upstreams, credentialsKey, allowLoopback));
  router.use(chatRoutes(chat));
  router.use((_req, res) => void res.status(404).json({ error: "not found" }));
  router.use(apiErrors);
  return router;
}
