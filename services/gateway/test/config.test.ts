import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = {
  DATABASE_URL: "postgres://x",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  ADMIN_EMAIL: "admin@x.io",
  ADMIN_PASSWORD: "pw",
  SEED_WOO_URL: "http://woo-mcp:3000/mcp",
};

describe("loadConfig", () => {
  it("reads the required values and applies defaults", () => {
    const config = loadConfig(valid);
    expect(config.credentialsKey).toHaveLength(32);
    expect(config.port).toBe(8080);
    expect(config.callTimeoutMs).toBe(15_000);
    expect(config.healthIntervalMs).toBe(5_000);
  });
  it("names every missing variable, never their values", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://secret" })).toThrow(/CREDENTIALS_KEY.*ADMIN_EMAIL/);
    expect(() => loadConfig({ DATABASE_URL: "postgres://secret" })).not.toThrow(/secret/);
  });
  it("rejects a credentials key that is not 32 bytes", () => {
    expect(() => loadConfig({ ...valid, CREDENTIALS_KEY: Buffer.from("short").toString("base64") })).toThrow("CREDENTIALS_KEY must be 32 bytes");
  });
});
