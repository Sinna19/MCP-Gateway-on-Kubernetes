import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

// Hashing first gives both sides the same length, so timingSafeEqual never throws and
// the comparison time does not reveal how much of the token matched.
export function checkBearer(header: string | undefined, token: string): boolean {
  const match = /^bearer\s+(.+)$/i.exec(header ?? "");
  if (!match) return false;
  return timingSafeEqual(sha256(match[1]!), sha256(token));
}
