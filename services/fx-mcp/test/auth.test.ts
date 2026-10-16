import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkBearer } from "../src/auth.js";

const token = randomBytes(24).toString("hex");

describe("checkBearer", () => {
  it("accepts the right token", () => {
    expect(checkBearer(`Bearer ${token}`, token)).toBe(true);
  });
  it("treats the scheme case-insensitively (RFC 6750)", () => {
    expect(checkBearer(`bearer ${token}`, token)).toBe(true);
    expect(checkBearer(`BEARER ${token}`, token)).toBe(true);
  });
  it("rejects a missing header", () => {
    expect(checkBearer(undefined, token)).toBe(false);
  });
  it("rejects another scheme", () => {
    expect(checkBearer(`Basic ${token}`, token)).toBe(false);
  });
  it("rejects a wrong token and a different length", () => {
    expect(checkBearer(`Bearer ${randomBytes(24).toString("hex")}`, token)).toBe(false);
    expect(checkBearer("Bearer short", token)).toBe(false);
    expect(checkBearer("Bearer ", token)).toBe(false);
  });
});
