import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../src/api-keys.js";
import { Gateway, type ToolBackend } from "../src/gateway.js";
import { UpstreamError } from "../src/upstreams.js";
import { createTestDb, resetData } from "./helpers.js";

describe("Gateway.callTool", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let user: AuthUser;
  let backend: ToolBackend;
  let gateway: Gateway;

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    const { rows } = await pool.query("INSERT INTO users (email, role, password_hash) VALUES ('a@x.io', 'member', 'x') RETURNING id");
    user = { id: rows[0].id, email: "a@x.io", role: "member" };
    backend = {
      tools: () => [],
      callTool: async () => ({ content: [{ type: "text", text: "fine" }] }),
    };
    gateway = new Gateway(pool, backend);
  });

  const audit = async () => (await pool.query("SELECT * FROM audit_log ORDER BY id")).rows;

  it("routes by slug and records user, server, tool, outcome and source", async () => {
    let seen: unknown[] = [];
    backend.callTool = async (...args) => {
      seen = args;
      return { content: [{ type: "text", text: "fine" }] };
    };
    const result = await gateway.callTool(user, "woo__list_orders", { secret: "arg" }, "chat");
    expect(result.isError).toBeFalsy();
    expect(seen).toEqual(["woo", "list_orders", { secret: "arg" }]);
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: user.id, server_slug: "woo", tool: "list_orders", outcome: "ok", error: null, source: "chat" });
    expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(rows)).not.toContain("arg");
  });

  it("an unknown tool name is an error result and is audited", async () => {
    const result = await gateway.callTool(user, "nodoubleunderscore", {}, "mcp");
    expect(result.isError).toBe(true);
    const rows = await audit();
    expect(rows[0]).toMatchObject({ server_slug: null, tool: "nodoubleunderscore", outcome: "error", source: "mcp" });
  });

  it("a very long tool name is cut to 100 characters in the audit row and in the error text", async () => {
    for (const name of ["x".repeat(300), `woo__${"y".repeat(300)}`]) {
      const result = await gateway.callTool(user, name, {}, "mcp");
      expect(JSON.stringify(result.content).length).toBeLessThan(200);
    }
    const rows = await audit();
    expect(rows.map((r) => r.tool.length)).toEqual([100, 100]);
  });

  it("an upstream error becomes an error result naming the server, truncated in the audit row", async () => {
    backend.callTool = async () => {
      throw new UpstreamError(`server 'woo' failed: ${"x".repeat(2000)}`);
    };
    const result = await gateway.callTool(user, "woo__t", {}, "mcp");
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result.content)).toContain("server 'woo' failed");
    const rows = await audit();
    expect(rows[0].outcome).toBe("error");
    expect(rows[0].error.length).toBe(500);
  });

  it("a tool-level error from the upstream is audited as an error without storing its text", async () => {
    backend.callTool = async () => ({ isError: true, content: [{ type: "text", text: "customer jane@example.com not found" }] });
    const result = await gateway.callTool(user, "woo__t", {}, "mcp");
    expect(result.isError).toBe(true);
    const rows = await audit();
    expect(rows[0].outcome).toBe("error");
    expect(JSON.stringify(rows)).not.toContain("jane@example.com");
  });

  it("an unexpected exception gives a generic message and is still audited", async () => {
    backend.callTool = async () => {
      throw new Error("db password is hunter2");
    };
    const result = await gateway.callTool(user, "woo__t", {}, "mcp");
    expect(JSON.stringify(result.content)).not.toContain("hunter2");
    expect((await audit())[0].outcome).toBe("error");
  });
});
