import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "member";
}

const KEY_PREFIX = "umk_";
const SHOWN_PREFIX_LENGTH = 8;

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateKey(): { key: string; prefix: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, SHOWN_PREFIX_LENGTH), hash: hashKey(key) };
}

// The plaintext key is returned once, here. Only its hash is stored.
export async function createKey(pool: pg.Pool, userId: number, name: string): Promise<{ id: number; key: string }> {
  const { key, prefix, hash } = generateKey();
  const { rows } = await pool.query("INSERT INTO api_keys (user_id, name, prefix, hash) VALUES ($1, $2, $3, $4) RETURNING id", [userId, name, prefix, hash]);
  return { id: rows[0].id, key };
}

export async function revokeKey(pool: pg.Pool, keyId: number): Promise<void> {
  await pool.query("UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [keyId]);
}

// Called on every request, so a revoked key or disabled user stops working immediately.
export async function findUserByKey(pool: pg.Pool, key: string): Promise<AuthUser | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const { rows } = await pool.query(
    `UPDATE api_keys k SET last_used_at = now()
       FROM users u
      WHERE k.user_id = u.id AND k.hash = $1 AND k.revoked_at IS NULL AND u.disabled_at IS NULL
      RETURNING u.id, u.email, u.role`,
    [hashKey(key)],
  );
  return rows[0] ?? null;
}
