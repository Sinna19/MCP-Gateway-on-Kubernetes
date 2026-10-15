import { describe, expect, it } from "vitest";
import { serverView } from "../src/api/servers.js";

const row = { slug: "woo", url: "http://woo-mcp:8080/mcp", enabled: true, header_name: "X-Api-Key", credential_enc: "CIPHERTEXT-BASE64" };
const live = { status: "connected" as const, tools: [{ name: "woo__list_products", description: "List products" }] };

describe("serverView", () => {
  it("gives members only slug, enabled, status and tools", () => {
    expect(serverView(row, live, false)).toEqual({ slug: "woo", enabled: true, status: "connected", tools: live.tools });
  });

  it("gives admins also url, header name and whether a credential is set", () => {
    expect(serverView(row, live, true)).toEqual({
      slug: "woo",
      enabled: true,
      status: "connected",
      tools: live.tools,
      url: "http://woo-mcp:8080/mcp",
      headerName: "X-Api-Key",
      hasCredential: true,
    });
  });

  it("never carries the ciphertext, whatever the role", () => {
    for (const isAdmin of [true, false]) {
      expect(JSON.stringify(serverView(row, live, isAdmin))).not.toContain("CIPHERTEXT");
    }
  });

  it("copies nothing it does not list, even if the row gains a column", () => {
    const view = serverView({ ...row, future_secret: "oops" } as typeof row, live, true);
    expect(JSON.stringify(view)).not.toContain("oops");
  });

  it("reports hasCredential false when none is stored", () => {
    const view = serverView({ ...row, header_name: null, credential_enc: null }, live, true);
    expect(view).toMatchObject({ headerName: null, hasCredential: false });
  });

  it("falls back to disabled / unreachable with no tools when the manager has no entry yet", () => {
    expect(serverView({ ...row, enabled: false }, undefined, false)).toMatchObject({ status: "disabled", tools: [] });
    expect(serverView(row, undefined, false)).toMatchObject({ status: "unreachable", tools: [] });
  });
});
