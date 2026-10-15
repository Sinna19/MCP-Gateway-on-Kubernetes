import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Stored as base64(iv | auth tag | ciphertext).
// aad is the server slug: it is not secret, but decrypting with a different slug fails,
// so a ciphertext copied onto another row is useless.
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encrypt(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decrypt(key: Buffer, stored: string, aad: string): string {
  const raw = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}
