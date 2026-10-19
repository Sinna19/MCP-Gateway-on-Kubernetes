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

// Remembers when last_used_at was last written for each key, so the column is written at most once a minute
// per key instead of on every /mcp request (ADR 020). In memory and per app: a restart only means one extra write.
export class KeyUsage {
  private readonly lastWrite = new Map<number, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly everyMs = 60_000,
  ) {}

  get size(): number {
    return this.lastWrite.size;
  }

  // True when this key is due a write; records the time so the next calls within a minute get false.
  shouldWrite(keyId: number): boolean {
    const last = this.lastWrite.get(keyId);
    if (last !== undefined && this.now() - last < this.everyMs) return false;
    this.lastWrite.set(keyId, this.now());
    return true;
  }

  forget(keyId: number): void {
    this.lastWrite.delete(keyId);
  }

  sweep(): void {
    for (const [id, last] of this.lastWrite) if (this.now() - last >= this.everyMs) this.lastWrite.delete(id);
  }
}

// Called on every request, so a revoked key or disabled user stops working immediately. The check is a SELECT
// on every request; last_used_at is written only when `usage` says the key is due (no `usage` = every time).
export async function findUserByKey(pool: pg.Pool, key: string, usage?: KeyUsage): Promise<AuthUser | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const { rows } = await pool.query(
    `SELECT k.id AS key_id, u.id, u.email, u.role
       FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.hash = $1 AND k.revoked_at IS NULL AND u.disabled_at IS NULL`,
    [hashKey(key)],
  );
  const row = rows[0];
  if (!row) return null;
  const keyId = Number(row.key_id);
  if (!usage || usage.shouldWrite(keyId)) await pool.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [keyId]);
  return { id: row.id, email: row.email, role: row.role };
}
