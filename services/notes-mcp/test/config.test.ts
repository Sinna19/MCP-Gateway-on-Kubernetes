import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const key = "k".repeat(32);

describe("loadConfig", () => {
  it("reads the key and defaults the port to 3000", () => {
    expect(loadConfig({ NOTES_KEY: key })).toEqual({ key, port: 3000 });
  });
  it("throws when NOTES_KEY is missing or empty", () => {
    expect(() => loadConfig({})).toThrow(/NOTES_KEY/);
    expect(() => loadConfig({ NOTES_KEY: "" })).toThrow(/NOTES_KEY/);
  });
  it("throws when NOTES_KEY is shorter than 32 characters", () => {
    expect(() => loadConfig({ NOTES_KEY: "k".repeat(31) })).toThrow(/32/);
  });
  it("accepts a valid PORT", () => {
    expect(loadConfig({ NOTES_KEY: key, PORT: "8080" }).port).toBe(8080);
  });
  it.each(["0", "65536", "abc", "30.5", "-1", " 80"])("rejects PORT=%s", (port) => {
    expect(() => loadConfig({ NOTES_KEY: key, PORT: port })).toThrow(/PORT/);
  });
});
