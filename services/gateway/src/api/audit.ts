import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { currentUser, requireUser } from "./middleware.js";

const query = z.object({
  user: z.coerce.number().int().positive().optional(),
  server: z.string().max(20).optional(),
  outcome: z.enum(["ok", "error"]).optional(),
  source: z.enum(["mcp", "chat"]).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function auditRoutes(pool: pg.Pool): Router {
  const router = Router();

  // Newest first. `before` is the id of the last row of the previous page.
  router.get("/audit", requireUser, async (req, res) => {
    const me = currentUser(res);
    const q = query.parse(req.query);
    // A member always sees only their own rows, whatever ?user= says.
    const userId = me.role === "admin" ? (q.user ?? null) : me.id;
    const { rows } = await pool.query(
      `SELECT a.id, u.email AS "user", a.server_slug, a.tool, a.started_at, a.duration_ms, a.outcome, a.error, a.source
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE ($1::bigint IS NULL OR a.user_id = $1)
          AND ($2::text IS NULL OR a.server_slug = $2)
          AND ($3::text IS NULL OR a.outcome = $3)
          AND ($4::text IS NULL OR a.source = $4)
          AND ($5::bigint IS NULL OR a.id < $5)
        ORDER BY a.id DESC LIMIT $6`,
      [userId, q.server ?? null, q.outcome ?? null, q.source ?? null, q.before ?? null, q.limit],
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        user: r.user,
        server: r.server_slug,
        tool: r.tool,
        startedAt: r.started_at,
        durationMs: r.duration_ms,
        outcome: r.outcome,
        error: r.error,
        source: r.source,
      })),
    );
  });

  return router;
}
