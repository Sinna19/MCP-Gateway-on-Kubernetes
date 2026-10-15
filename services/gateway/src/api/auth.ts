import { randomBytes } from "node:crypto";
import { Router, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../passwords.js";
import { createSession, deleteSession, readCookie, SESSION_COOKIE, SESSION_SECONDS } from "../sessions.js";
import { currentUser, requireUser } from "./middleware.js";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

const loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

// Checked when the email is unknown, so a miss takes as long as a wrong password (no user enumeration by timing).
const DUMMY_HASH = hashPassword(randomBytes(8).toString("hex"));

export async function startSession(pool: pg.Pool, res: Response, userId: number, secure: boolean): Promise<void> {
  const token = await createSession(pool, userId);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: SESSION_SECONDS * 1000 });
}

export function authRoutes(pool: pg.Pool, secure: boolean): Router {
  const router = Router();

  router.post("/auth/login", async (req, res) => {
    const { email, password } = loginBody.parse(req.body);
    const { rows } = await pool.query("SELECT id, email, role, password_hash, disabled_at FROM users WHERE lower(email) = $1", [email]);
    const user = rows[0];
    const ok = await verifyPassword(password, user ? user.password_hash : await DUMMY_HASH);
    if (!user || !ok || user.disabled_at) {
      res.status(401).json({ error: "invalid email or password" });
      return;
    }
    await startSession(pool, res, user.id, secure);
    res.json({ id: user.id, email: user.email, role: user.role });
  });

  router.post("/auth/logout", async (req, res) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) await deleteSession(pool, token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  router.get("/me", requireUser, (_req, res) => {
    const user = currentUser(res);
    res.json({ id: user.id, email: user.email, role: user.role });
  });

  return router;
}
