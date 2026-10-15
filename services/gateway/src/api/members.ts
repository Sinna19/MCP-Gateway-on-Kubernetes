import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { deleteUserSessions } from "../sessions.js";
import { currentUser, idParam, requireAdmin } from "./middleware.js";

const patchBody = z
  .object({ role: z.enum(["admin", "member"]).optional(), disabled: z.boolean().optional() })
  .refine((b) => b.role !== undefined || b.disabled !== undefined, { message: "give role or disabled" });

// Never selects password_hash.
async function selectMembers(pool: pg.Pool, id?: number) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.disabled_at IS NOT NULL AS disabled, u.created_at,
            (SELECT count(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL)::int AS active_keys
       FROM users u WHERE ($1::bigint IS NULL OR u.id = $1) ORDER BY u.id`,
    [id ?? null],
  );
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, disabled: r.disabled, createdAt: r.created_at, activeKeys: r.active_keys }));
}

export function memberRoutes(pool: pg.Pool): Router {
  const router = Router();

  router.get("/members", requireAdmin, async (_req, res) => {
    res.json(await selectMembers(pool));
  });

  // Members are never deleted, so audit rows keep their user. Disabling ends their sessions now;
  // their API keys stay but are rejected while the user is disabled.
  router.patch("/members/:id", requireAdmin, async (req, res) => {
    const id = idParam(req.params.id);
    const { role, disabled } = patchBody.parse(req.body);
    // pg returns bigint columns as strings, so compare as numbers.
    if (id === Number(currentUser(res).id) &&(role === "member" || disabled === true)) {
      res.status(400).json({ error: "you cannot demote or disable yourself" });
      return;
    }
    const result = await pool.query(
      `UPDATE users SET role = COALESCE($2, role),
              disabled_at = CASE WHEN $3::boolean IS NULL THEN disabled_at WHEN $3 THEN COALESCE(disabled_at, now()) ELSE NULL END
        WHERE id = $1`,
      [id, role ?? null, disabled ?? null],
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "member not found" });
      return;
    }
    if (disabled === true) await deleteUserSessions(pool, id);
    res.json((await selectMembers(pool, id))[0]);
  });

  return router;
}
