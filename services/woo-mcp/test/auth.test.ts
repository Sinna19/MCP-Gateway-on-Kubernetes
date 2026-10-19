import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkBearer } from "../src/auth.js";

const token = randomBytes(32).toString("hex");

describe("checkBearer", () => {
  it("accepts the right token", () => {
    expect(checkBearer(`Bearer ${token}`, token)).toBe(true);
  });

  it("rejects a missing header, a wrong token, a different length and another scheme", () => {
    expect(checkBearer(undefined, token)).toBe(false);
    expect(checkBearer(`Bearer ${randomBytes(32).toString("hex")}`, token)).toBe(false);
    expect(checkBearer("Bearer short", token)).toBe(false);
    expect(checkBearer(`Basic ${token}`, token)).toBe(false);
  });
});
