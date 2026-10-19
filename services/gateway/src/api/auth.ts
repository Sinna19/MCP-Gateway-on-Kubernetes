import { randomBytes } from "node:crypto";
import { Router, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../passwords.js";
import type { FixedWindowLimiter } from "../rate-limit.js";
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

export interface LoginLimiters {
  ip: FixedWindowLimiter;
  email: FixedWindowLimiter;
}

export function authRoutes(pool: pg.Pool, secure: boolean, limiters: LoginLimiters): Router {
  const router = Router();

  router.post("/auth/login", async (req, res) => {
    // `email` is already trimmed and lowercased, the same form the lookup below uses, so one person is one bucket.
    const { email, password } = loginBody.parse(req.body);
    const ip = req.ip ?? "unknown";
    // Every attempt is counted before the slow password check, wrong or right, known email or not.
    const tooMany = (retryAfterSeconds: number) => {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "too many login attempts, try again later" });
    };
    const byIp = limiters.ip.take(ip);
    if (!byIp.ok) return tooMany(byIp.retryAfterSeconds);
    const byEmail = limiters.email.take(email);
    if (!byEmail.ok) {
      // A locked-out email must not also eat the IP's budget: behind one k3d source IP that would lock everyone out.
      limiters.ip.refund(ip);
      return tooMany(byEmail.retryAfterSeconds);
    }
    const { rows } = await pool.query("SELECT id, email, role, password_hash, disabled_at FROM users WHERE lower(email) = $1", [email]);
    const user = rows[0];
    const ok = await verifyPassword(password, user ? user.password_hash : await DUMMY_HASH);
    if (!user || !ok || user.disabled_at) {
      res.status(401).json({ error: "invalid email or password" });
      return;
    }
    // A good login clears this email's failures and gives its IP token back. The IP bucket is not reset:
    // an attacker could otherwise reset it by logging in to their own account between guesses.
    limiters.email.reset(email);
    limiters.ip.refund(ip);
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
