import { readFile } from "node:fs/promises";
import { createPool } from "./db.js";
import { reencryptCredentials, waitForDb } from "./rotate-key.js";

// Entrypoint of the rotate-key Job (scripts/rotate-credentials-key.sh). The keys come from two mounted
// Secret files, never from argv or env, so they cannot show up in `ps` or `kubectl describe`.
async function readKey(path: string): Promise<Buffer> {
  return Buffer.from((await readFile(path, "utf8")).trim(), "base64");
}

const pool = createPool(process.env.DATABASE_URL ?? "");
try {
  await waitForDb(pool);
  const count = await reencryptCredentials(pool, await readKey("/keys/old/credentials-key"), await readKey("/keys/new/credentials-key"));
  console.log(`re-encrypted ${count} credentials`);
} catch (err) {
  console.error("rotation failed, nothing changed:", err instanceof Error ? err.message : "unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
