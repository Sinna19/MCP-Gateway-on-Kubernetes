import { describe, expect, it } from "vitest";
import { checkKey } from "../src/auth.js";

const key = "k".repeat(40);

describe("checkKey", () => {
  it("accepts the exact key", () => {
    expect(checkKey(key, key)).toBe(true);
  });
  it("rejects a missing header", () => {
    expect(checkKey(undefined, key)).toBe(false);
  });
  it("rejects a wrong key of the same length", () => {
    expect(checkKey("x".repeat(40), key)).toBe(false);
  });
  it("rejects a key of a different length without throwing", () => {
    expect(checkKey("short", key)).toBe(false);
    expect(checkKey(key + "x", key)).toBe(false);
  });
  it("rejects an empty header", () => {
    expect(checkKey("", key)).toBe(false);
  });
});
