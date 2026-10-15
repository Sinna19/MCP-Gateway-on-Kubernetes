import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Stored as "<salt hex>:<hash hex>" using scrypt with Node's default cost.
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
