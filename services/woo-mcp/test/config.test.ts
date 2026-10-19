import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const token = randomBytes(32).toString("hex");
const base = { WOO_URL: "http://store-wordpress", WOO_USER: "woo-mcp", WOO_APP_PASSWORD_FILE: "/x/password", WOO_MCP_TOKEN: token };

describe("loadConfig", () => {
  it("reads the password file path and the token", () => {
    const c = loadConfig(base);
    expect(c.wooPasswordFile).toBe("/x/password");
    expect(c.token).toBe(token);
  });

  it("requires the password file path", () => {
    expect(() => loadConfig({ ...base, WOO_APP_PASSWORD_FILE: "" })).toThrow("WOO_APP_PASSWORD_FILE");
  });

  it("requires a token of at least 32 characters", () => {
    expect(() => loadConfig({ ...base, WOO_MCP_TOKEN: "" })).toThrow("WOO_MCP_TOKEN");
    expect(() => loadConfig({ ...base, WOO_MCP_TOKEN: "short" })).toThrow("at least 32");
  });
});
