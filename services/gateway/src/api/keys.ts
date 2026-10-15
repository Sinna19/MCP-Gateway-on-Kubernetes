import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { createKey, revokeKey } from "../api-keys.js";
import { currentUser, idParam, requireUser } from "./middleware.js";

const createBody = z.strictObject({ name: z.string().trim().min(1).max(100) });
const listQuery = z.object({ all: z.enum(["true", "false"]).optional() });

export function keyRoutes(pool: pg.Pool): Router {
  const router = Router();

  // Lists the prefix only; the hash and the full key are never selected.
  router.get("/keys", requireUser, async (req, res) => {
    const user = currentUser(res);
    const all = listQuery.parse(req.query).all === "true";
    if (all && user.role !== "admin") {
      res.status(403).json({ error: "admin only" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.revoked_at, u.email AS owner
         FROM api_keys k JOIN users u ON u.id = k.user_id
        WHERE ($1::boolean OR k.user_id = $2) ORDER BY k.id`,
      [all, user.id],
    );
    res.json(
      rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, owner: r.owner, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at })),
    );
  });

  // The only response that ever contains the plaintext key.
  router.post("/keys", requireUser, async (req, res) => {
    const { name } = createBody.parse(req.body);
    const created = await createKey(pool, currentUser(res).id, name);
    res.status(201).json({ id: created.id, name, key: created.key });
  });

  // Someone else's key id gives 404, same as a missing one, so ids can't be probed.
  router.delete("/keys/:id", requireUser, async (req, res) => {
    const id = idParam(req.params.id);
    const user = currentUser(res);
    const { rowCount } = await pool.query("SELECT 1 FROM api_keys WHERE id = $1 AND ($2::boolean OR user_id = $3)", [id, user.role === "admin", user.id]);
    if (!rowCount) {
      res.status(404).json({ error: "key not found" });
      return;
    }
    await revokeKey(pool, id);
    res.status(204).end();
  });

  return router;
}
