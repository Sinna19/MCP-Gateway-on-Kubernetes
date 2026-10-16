import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("refuses to start without FX_TOKEN", () => {
    expect(() => loadConfig({})).toThrow(/FX_TOKEN/);
    expect(() => loadConfig({ FX_TOKEN: "" })).toThrow(/FX_TOKEN/);
  });
  it("refuses a token shorter than 32 characters", () => {
    expect(() => loadConfig({ FX_TOKEN: "x".repeat(31) })).toThrow(/32/);
  });
  it("accepts a 32 character token and defaults the port", () => {
    const token = randomBytes(16).toString("hex");
    expect(loadConfig({ FX_TOKEN: token })).toEqual({ token, port: 3000 });
  });
});
