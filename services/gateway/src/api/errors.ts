import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

// The one place /api errors become responses. Expected failures get a clear status;
// anything else is logged here and the client only sees "internal error" (no stack, no SQL).
// Express treats a handler as an error handler only if it declares four arguments.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const apiErrors: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid request", issues: err.issues });
    return;
  }
  const { code, type, status } = err as { code?: string; type?: string; status?: number };
  if (type === "entity.too.large") {
    res.status(413).json({ error: "body too large" });
    return;
  }
  if (type === "entity.parse.failed" || (status && status >= 400 && status < 500)) {
    res.status(400).json({ error: "bad request" });
    return;
  }
  if (code === "23505") {
    res.status(409).json({ error: "already exists" });
    return;
  }
  console.error(`${req.method} ${req.originalUrl} failed:`, err instanceof Error ? (err.stack ?? err.message) : err);
  res.status(500).json({ error: "internal error" });
};
