import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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
  it("leaves llm unset unless base url, model and key are all non-empty", () => {
    const full = { LLM_BASE_URL: "https://llm/v1", LLM_MODEL: "m", LLM_API_KEY: "k" };
    expect(loadConfig(valid).llm).toBeUndefined();
    expect(loadConfig({ ...valid, ...full }).llm).toEqual({ baseUrl: "https://llm/v1", model: "m", apiKey: "k" });
    // the chart renders LLM_BASE_URL="" by default: empty means unset
    expect(loadConfig({ ...valid, ...full, LLM_BASE_URL: "" }).llm).toBeUndefined();
    expect(loadConfig({ ...valid, ...full, LLM_MODEL: "" }).llm).toBeUndefined();
    expect(loadConfig({ ...valid, ...full, LLM_API_KEY: "" }).llm).toBeUndefined();
  });
  it("leaves chat disabled (and logs an error, no throw) for an http or invalid LLM_BASE_URL", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rest = { LLM_MODEL: "m", LLM_API_KEY: "k" };
    expect(loadConfig({ ...valid, ...rest, LLM_BASE_URL: "http://llm/v1" }).llm).toBeUndefined();
    expect(loadConfig({ ...valid, ...rest, LLM_BASE_URL: "not a url" }).llm).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
  it("allows an http LLM_BASE_URL only with LLM_ALLOW_HTTP=true", () => {
    const env = { ...valid, LLM_BASE_URL: "http://llm/v1", LLM_MODEL: "m", LLM_API_KEY: "k" };
    expect(loadConfig({ ...env, LLM_ALLOW_HTTP: "true" }).llm?.baseUrl).toBe("http://llm/v1");
  });
  it("parses CHAT_READ_ONLY_TOOLS: trims entries and drops empty ones", () => {
    expect(loadConfig(valid).chatReadOnlyTools.size).toBe(0);
    expect(loadConfig({ ...valid, CHAT_READ_ONLY_TOOLS: "" }).chatReadOnlyTools.size).toBe(0);
    const tools = loadConfig({ ...valid, CHAT_READ_ONLY_TOOLS: " woo__list_orders , ,fx__list_rates,, " }).chatReadOnlyTools;
    expect([...tools]).toEqual(["woo__list_orders", "fx__list_rates"]);
  });
  it("rejects a credentials key that is not 32 bytes", () => {
    expect(() => loadConfig({ ...valid, CREDENTIALS_KEY: Buffer.from("short").toString("base64") })).toThrow("CREDENTIALS_KEY must be 32 bytes");
  });
});
