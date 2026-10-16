import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

// Hashing first gives both sides the same length, so timingSafeEqual never throws and
// the comparison time does not reveal how much of the key matched.
export function checkKey(header: string | undefined, key: string): boolean {
  if (!header) return false;
  return timingSafeEqual(sha256(header), sha256(key));
}
