import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createKey, findUserByKey, generateKey, hashKey, revokeKey } from "../src/api-keys.js";
import { createTestDb, resetData } from "./helpers.js";

describe("generateKey", () => {
  it("has the umk_ prefix and at least 32 random bytes", () => {
    const { key } = generateKey();
    expect(key.startsWith("umk_")).toBe(true);
    expect(Buffer.from(key.slice(4), "base64url").length).toBeGreaterThanOrEqual(32);
    expect(generateKey().key).not.toBe(key);
  });
  it("hashKey is a stable SHA-256 hex string", () => {
    expect(hashKey("umk_abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey("umk_abc")).toBe(hashKey("umk_abc"));
  });
});

describe("keys in the database", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let userId: number;
  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    const { rows } = await pool.query("INSERT INTO users (email, role, password_hash) VALUES ('a@x.io', 'member', 'x') RETURNING id");
    userId = rows[0].id;
  });

  it("stores the hash, never the key", async () => {
    const { key } = await createKey(pool, userId, "laptop");
    const { rows } = await pool.query("SELECT hash, prefix FROM api_keys");
    expect(rows[0].hash).toBe(hashKey(key));
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(key.startsWith(rows[0].prefix)).toBe(true);
  });

  it("finds the user for a valid key", async () => {
    const { key } = await createKey(pool, userId, "laptop");
    expect(await findUserByKey(pool, key)).toMatchObject({ id: userId, email: "a@x.io", role: "member" });
  });

  it("rejects unknown and malformed keys", async () => {
    expect(await findUserByKey(pool, "umk_nope")).toBeNull();
    expect(await findUserByKey(pool, "")).toBeNull();
  });

  it("rejects a revoked key", async () => {
    const { key, id } = await createKey(pool, userId, "laptop");
    await revokeKey(pool, id);
    expect(await findUserByKey(pool, key)).toBeNull();
  });

  it("rejects the key of a disabled user", async () => {
    const { key } = await createKey(pool, userId, "laptop");
    await pool.query("UPDATE users SET disabled_at = now() WHERE id = $1", [userId]);
    expect(await findUserByKey(pool, key)).toBeNull();
  });
});
