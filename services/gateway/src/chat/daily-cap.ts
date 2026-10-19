import type pg from "pg";
import type { Take } from "../rate-limit.js";

const DAY_MS = 86_400_000;
const KEEP_DAYS = 7;

// The UTC day comes from the injected clock, not from SQL now(), so the day bucket and Retry-After agree.
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// One atomic statement: first turn of the day inserts count 1; later turns add 1 only while count < cap.
// When the WHERE fails no row comes back, so two parallel requests can never both take the last turn.
export async function takeChatTurn(pool: pg.Pool, userId: number, cap: number, now: () => number): Promise<Take> {
  const ms = now();
  const { rowCount } = await pool.query(
    `INSERT INTO chat_usage (user_id, day, count) VALUES ($1, $2::date, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET count = chat_usage.count + 1
     WHERE chat_usage.count < $3
     RETURNING count`,
    [userId, dayOf(ms), cap],
  );
  if (rowCount && rowCount > 0) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.ceil((Math.floor(ms / DAY_MS) * DAY_MS + DAY_MS - ms) / 1000) };
}

// Old days are never read again. Returns how many rows went.
export async function purgeOldChatUsage(pool: pg.Pool, now: () => number): Promise<number> {
  const { rowCount } = await pool.query("DELETE FROM chat_usage WHERE day < $1::date", [dayOf(now() - KEEP_DAYS * DAY_MS)]);
  return rowCount ?? 0;
}
