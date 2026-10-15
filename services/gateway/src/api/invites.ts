import { randomBytes } from "node:crypto";
import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { hashKey } from "../api-keys.js";
import { hashPassword } from "../passwords.js";
import { emailSchema, startSession } from "./auth.js";
import { currentUser, idParam, requireAdmin } from "./middleware.js";

const INVITE_DAYS = 7;

const createBody = z.object({ email: emailSchema, role: z.enum(["admin", "member"]).default("member") });
const acceptBody = z.object({ password: z.string().min(10).max(200) });

export function inviteRoutes(pool: pg.Pool, secure: boolean): Router {
  const router = Router();

  // Admin: the link token is returned once and only its hash is stored.
  router.post("/invites", requireAdmin, async (req, res) => {
    const { email, role } = createBody.parse(req.body);
    if ((await pool.query("SELECT 1 FROM users WHERE lower(email) = $1", [email])).rowCount) {
      res.status(409).json({ error: "this email already has an account" });
      return;
    }
    const token = randomBytes(32).toString("base64url");
    await pool.query("DELETE FROM invites WHERE email = $1 AND accepted_at IS NULL", [email]);
    const { rows } = await pool.query(
      `INSERT INTO invites (email, role, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, now() + make_interval(days => $4), $5) RETURNING id, expires_at`,
      [email, role, hashKey(token), INVITE_DAYS, currentUser(res).id],
    );
    res.status(201).json({ id: rows[0].id, email, role, expiresAt: rows[0].expires_at, path: `/invite/${token}` });
  });

  router.get("/invites", requireAdmin, async (_req, res) => {
    const { rows } = await pool.query("SELECT id, email, role, expires_at, created_at FROM invites WHERE accepted_at IS NULL AND expires_at > now() ORDER BY id DESC");
    res.json(rows.map((r) => ({ id: r.id, email: r.email, role: r.role, expiresAt: r.expires_at, createdAt: r.created_at })));
  });

  router.delete("/invites/:id", requireAdmin, async (req, res) => {
    const result = await pool.query("DELETE FROM invites WHERE id = $1 AND accepted_at IS NULL", [idParam(req.params.id)]);
    res.status(result.rowCount ? 204 : 404).end();
  });

  // Public: whoever holds the link token can see which email and role it is for, and set a password.
  router.get("/invites/:token", async (req, res) => {
    const { rows } = await pool.query("SELECT email, role FROM invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()", [hashKey(String(req.params.token))]);
    if (!rows[0]) {
      res.status(404).json({ error: "invite not found or expired" });
      return;
    }
    res.json({ email: rows[0].email, role: rows[0].role });
  });

  router.post("/invites/:token/accept", async (req, res) => {
    const { password } = acceptBody.parse(req.body);
    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    let userId: number;
    try {
      await client.query("BEGIN");
      const invite = await client.query(
        "SELECT id, email, role FROM invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now() FOR UPDATE",
        [hashKey(String(req.params.token))],
      );
      if (!invite.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "invite not found or expired" });
        return;
      }
      const { id, email, role } = invite.rows[0];
      if ((await client.query("SELECT 1 FROM users WHERE lower(email) = $1", [email])).rowCount) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "this email already has an account" });
        return;
      }
      const created = await client.query("INSERT INTO users (email, role, password_hash) VALUES ($1, $2, $3) RETURNING id", [email, role, passwordHash]);
      userId = created.rows[0].id;
      await client.query("UPDATE invites SET accepted_at = now() WHERE id = $1", [id]);
      await client.query("COMMIT");
      await startSession(pool, res, userId, secure);
      res.status(201).json({ id: userId, email, role });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  return router;
}
