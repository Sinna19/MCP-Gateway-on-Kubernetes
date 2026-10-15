import { randomBytes } from "node:crypto";
import type pg from "pg";
import { hashKey, type AuthUser } from "./api-keys.js";

export const SESSION_COOKIE = "urumi_session";
export const SESSION_SECONDS = 12 * 60 * 60;

// The token goes in the cookie; only its hash is stored, like API keys.
export async function createSession(pool: pg.Pool, userId: number): Promise<string> {
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))", [hashKey(token), userId, SESSION_SECONDS]);
  return token;
}

// Checked on every request, so logout, expiry and disabling a user take effect at once.
export async function findSessionUser(pool: pg.Pool, token: string): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`,
    [hashKey(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSession(pool: pg.Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashKey(token)]);
}

export async function deleteUserSessions(pool: pg.Pool, userId: number): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}
