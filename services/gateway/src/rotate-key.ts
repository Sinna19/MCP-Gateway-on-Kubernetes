import type pg from "pg";
import { decrypt, encrypt } from "./crypto.js";

// Moves every stored upstream credential from oldKey to newKey in ONE transaction.
// Any failure (a row that does not decrypt, a verify mismatch) rolls back, so the table is never half rotated.
// Errors name the slug only, never a key or a plaintext.
export async function reencryptCredentials(pool: pg.Pool, oldKey: Buffer, newKey: Buffer): Promise<number> {
  if (oldKey.length !== 32 || newKey.length !== 32) throw new Error("both keys must be 32 bytes");
  if (oldKey.equals(newKey)) throw new Error("the new key must be different from the old key");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // FOR UPDATE: nobody can edit a credential while we rotate.
    const { rows } = await client.query<{ id: string; slug: string; credential_enc: string }>(
      "SELECT id, slug, credential_enc FROM upstream_servers WHERE credential_enc IS NOT NULL ORDER BY id FOR UPDATE",
    );
    const plaintexts = new Map<string, string>();
    for (const row of rows) {
      let plain: string;
      try {
        plain = decrypt(oldKey, row.credential_enc, row.slug);
      } catch {
        throw new Error(`credential of '${row.slug}' does not decrypt with the old key`);
      }
      plaintexts.set(row.slug, plain);
      await client.query("UPDATE upstream_servers SET credential_enc = $1 WHERE id = $2", [encrypt(newKey, plain, row.slug), row.id]);
    }

    // Verify from what the database now holds, not from what we meant to write.
    const check = await client.query<{ slug: string; credential_enc: string }>(
      "SELECT slug, credential_enc FROM upstream_servers WHERE credential_enc IS NOT NULL",
    );
    if (check.rows.length !== rows.length) throw new Error("row count changed during rotation");
    for (const row of check.rows) {
      let plain: string;
      try {
        plain = decrypt(newKey, row.credential_enc, row.slug);
      } catch {
        throw new Error(`verify failed: '${row.slug}' does not decrypt with the new key`);
      }
      if (plain !== plaintexts.get(row.slug)) throw new Error(`verify failed: '${row.slug}' changed value`);
    }

    await client.query("COMMIT");
    return rows.length;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// A new pod's first connections can be refused until the NetworkPolicy has synced for its IP. SELECT 1 changes nothing,
// so retrying it is safe; the rotation itself is never retried.
export async function waitForDb(pool: pg.Pool, tries = 15, delayMs = 2000): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (attempt >= tries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
