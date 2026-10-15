import express, { Router } from "express";
import type pg from "pg";
import { authRoutes } from "./auth.js";
import { apiErrors } from "./errors.js";
import { inviteRoutes } from "./invites.js";
import { memberRoutes } from "./members.js";
import { loadUser, requireJsonBody } from "./middleware.js";
import { serverRoutes } from "./servers.js";
import type { UpstreamControl } from "../upstreams.js";

export interface ApiOptions {
  pool: pg.Pool;
  upstreams: UpstreamControl;
  credentialsKey: Buffer;
  cookieSecure: boolean;
}

// Everything under /api: JSON only, session cookie auth, one error handler at the end.
export function createApiRouter({ pool, upstreams, credentialsKey, cookieSecure }: ApiOptions): Router {
  const router = Router();
  router.use(requireJsonBody, express.json({ limit: "100kb" }), loadUser(pool));
  router.use(authRoutes(pool, cookieSecure));
  router.use(inviteRoutes(pool, cookieSecure));
  router.use(memberRoutes(pool));
  router.use(serverRoutes(pool, upstreams, credentialsKey));
  router.use((_req, res) => void res.status(404).json({ error: "not found" }));
  router.use(apiErrors);
  return router;
}
