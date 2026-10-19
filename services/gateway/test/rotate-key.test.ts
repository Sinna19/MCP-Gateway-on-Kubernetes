import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";
import { reencryptCredentials } from "../src/rotate-key.js";
import { createTestDb, resetData } from "./helpers.js";

describe("reencryptCredentials", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  // Generated, never literal: the secret-guard hook blocks literal tokens in tests.
  const plain = { woo: randomBytes(12).toString("hex"), fx: randomBytes(12).toString("hex") };

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    await pool.query("INSERT INTO upstream_servers (slug, url, header_name, credential_enc) VALUES ('woo', 'http://woo', 'Authorization', $1)", [encrypt(oldKey, plain.woo, "woo")]);
    await pool.query("INSERT INTO upstream_servers (slug, url, header_name, credential_enc) VALUES ('fx', 'http://fx', 'X-Key', $1)", [encrypt(oldKey, plain.fx, "fx")]);
    await pool.query("INSERT INTO upstream_servers (slug, url) VALUES ('open', 'http://open')");
  });

  const rows = async () => (await pool.query<{ slug: string; credential_enc: string | null }>("SELECT slug, credential_enc FROM upstream_servers ORDER BY slug")).rows;

  it("re-encrypts every credential, keeps the plaintext and leaves rows without one alone", async () => {
    const before = await rows();
    expect(await reencryptCredentials(pool, oldKey, newKey)).toBe(2);
    const after = await rows();
    for (const slug of ["woo", "fx"] as const) {
      const b = before.find((r) => r.slug === slug)!;
      const a = after.find((r) => r.slug === slug)!;
      expect(a.credential_enc).not.toBe(b.credential_enc);
      expect(decrypt(newKey, a.credential_enc!, slug)).toBe(plain[slug]);
      expect(() => decrypt(oldKey, a.credential_enc!, slug)).toThrow();
    }
    expect(after.find((r) => r.slug === "open")!.credential_enc).toBeNull();
  });

  it("rolls everything back when one row does not decrypt with the old key", async () => {
    // 'fx' sorts before 'woo' by id only if inserted first; corrupt the later row so earlier updates must be undone.
    await pool.query("UPDATE upstream_servers SET credential_enc = $1 WHERE slug = 'woo'", [encrypt(randomBytes(32), "x", "woo")]);
    const before = await rows();
    await expect(reencryptCredentials(pool, oldKey, newKey)).rejects.toThrow(/woo/);
    expect(await rows()).toEqual(before);
  });

  it("refuses the same key twice and keys of the wrong size, touching nothing", async () => {
    const before = await rows();
    await expect(reencryptCredentials(pool, oldKey, oldKey)).rejects.toThrow("different");
    await expect(reencryptCredentials(pool, oldKey, randomBytes(16))).rejects.toThrow("32 bytes");
    expect(await rows()).toEqual(before);
  });

  it("does not put plaintext or keys in the error text", async () => {
    await pool.query("UPDATE upstream_servers SET credential_enc = $1 WHERE slug = 'woo'", [encrypt(randomBytes(32), "x", "woo")]);
    const err = await reencryptCredentials(pool, oldKey, newKey).catch((e: Error) => e);
    expect(String(err)).not.toContain(plain.fx);
    expect(String(err)).not.toContain(oldKey.toString("base64"));
  });
});
