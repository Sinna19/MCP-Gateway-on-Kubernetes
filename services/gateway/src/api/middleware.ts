import type { NextFunction, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthUser } from "../api-keys.js";
import { findSessionUser, readCookie, SESSION_COOKIE } from "../sessions.js";

// Cross-site forms can only send form content types, so refusing anything but JSON (plus the
// SameSite=Strict cookie) is our CSRF defence. We send no CORS headers.
export function requireJsonBody(req: Request, res: Response, next: NextFunction): void {
  if (["POST", "PATCH", "PUT"].includes(req.method) && !req.is("application/json")) {
    res.status(415).json({ error: "content type must be application/json" });
    return;
  }
  next();
}

// Looks up the session cookie. Sets res.locals.user when it is valid; does not reject by itself.
export function loadUser(pool: pg.Pool): RequestHandler {
  return async (req, res, next) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) res.locals.user = (await findSessionUser(pool, token)) ?? undefined;
    next();
  };
}

export const requireUser: RequestHandler = (_req, res, next) => {
  if (!res.locals.user) {
    res.status(401).json({ error: "not logged in" });
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  requireUser(req, res, () => {
    if (currentUser(res).role !== "admin") {
      res.status(403).json({ error: "admin only" });
      return;
    }
    next();
  });
};

export function currentUser(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

export function idParam(value: unknown): number {
  return z.coerce.number().int().positive().parse(value);
}
