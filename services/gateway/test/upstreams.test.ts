import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "../src/crypto.js";
import { UpstreamManager } from "../src/upstreams.js";
import { FakeUpstream, startHungServer, waitFor } from "./fake-upstream.js";
import { createTestDb, resetData } from "./helpers.js";

const key = randomBytes(32);

describe("UpstreamManager", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let manager: UpstreamManager;
  const cleanups: Array<() => Promise<void>> = [];
  let changes = 0;

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    changes = 0;
    manager = new UpstreamManager({ pool, credentialsKey: key, callTimeoutMs: 300, connectTimeoutMs: 400, pingTimeoutMs: 300 });
    manager.on("toolsChanged", () => changes++);
  });
  afterEach(async () => {
    await manager.stop();
    for (const c of cleanups.splice(0)) await c();
  });

  async function fake(slug: string, tools: Record<string, () => string | Promise<string>>, row: { header?: string; credential?: string } = {}): Promise<FakeUpstream> {
    const up = new FakeUpstream(tools);
    await up.start();
    cleanups.push(() => up.stop());
    const credential = row.credential ? encrypt(key, row.credential, slug) : null;
    await pool.query("INSERT INTO upstream_servers (slug, url, header_name, credential_enc) VALUES ($1, $2, $3, $4)", [slug, up.url, row.header ?? null, credential]);
    return up;
  }

  const names = () => manager.tools().map((t) => t.name).sort();
  const status = (slug: string) => manager.statuses().find((s) => s.slug === slug)?.status;

  it("lists the tools of every connected upstream with a slug prefix", async () => {
    await fake("woo", { list_products: () => "p" });
    await fake("fx", { convert: () => "c", list_products: () => "same name as woo" });
    await manager.reload();
    expect(names()).toEqual(["fx__convert", "fx__list_products", "woo__list_products"]);
    expect(status("woo")).toBe("connected");
  });

  it("a hung upstream is Unreachable and does not block the others", async () => {
    await fake("woo", { list_products: () => "p" });
    const hung = await startHungServer();
    cleanups.push(hung.stop);
    await pool.query("INSERT INTO upstream_servers (slug, url) VALUES ('hung', $1)", [hung.url]);
    const started = Date.now();
    await manager.reload();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(status("hung")).toBe("unreachable");
    expect(names()).toEqual(["woo__list_products"]);
  });

  it("never contacts a disabled upstream", async () => {
    const up = await fake("off", { t: () => "x" });
    await pool.query("UPDATE upstream_servers SET enabled = false WHERE slug = 'off'");
    await manager.reload();
    expect(status("off")).toBe("disabled");
    expect(up.methods).toEqual([]);
    expect(names()).toEqual([]);
  });

  it("sends the decrypted credential header to the upstream only", async () => {
    const up = await fake("fx", { t: () => "x" }, { header: "Authorization", credential: "Bearer upstream-secret" });
    await manager.reload();
    expect(up.headers.every((h) => h.authorization === "Bearer upstream-secret")).toBe(true);
    expect(JSON.stringify(manager.statuses())).not.toContain("upstream-secret");
  });

  it("routes a call to the right upstream", async () => {
    await fake("woo", { echo: () => "from woo" });
    await manager.reload();
    const result = await manager.callTool("woo", "echo", {});
    expect(result.content).toEqual([{ type: "text", text: "from woo" }]);
  });

  it("call errors name the server", async () => {
    await fake("slow", { wait: () => new Promise((r) => setTimeout(() => r("late"), 1500)) });
    await manager.reload();
    await expect(manager.callTool("slow", "wait", {})).rejects.toThrow("server 'slow' timed out after 0.3s");
    await expect(manager.callTool("nope", "x", {})).rejects.toThrow("server 'nope' not found");
    await pool.query("UPDATE upstream_servers SET enabled = false WHERE slug = 'slow'");
    await manager.reload();
    await expect(manager.callTool("slow", "wait", {})).rejects.toThrow("server 'slow' is disabled");
  });

  it("marks a stopped upstream Unreachable, drops its tools, and recovers", async () => {
    const up = await fake("woo", { t: () => "x" });
    await fake("fx", { c: () => "x" });
    await manager.reload();
    changes = 0;
    await up.stop();
    await manager.tick();
    expect(status("woo")).toBe("unreachable");
    expect(names()).toEqual(["fx__c"]);
    expect(changes).toBe(1);
    await expect(manager.callTool("woo", "t", {})).rejects.toThrow("server 'woo' is unreachable");
    await up.start();
    await manager.tick();
    expect(status("woo")).toBe("connected");
    expect(names()).toEqual(["fx__c", "woo__t"]);
    expect(changes).toBe(2);
  });

  it("two ticks with no change emit nothing and do not re-list tools", async () => {
    const up = await fake("woo", { t: () => "x" });
    await manager.reload();
    const lists = up.count("tools/list");
    changes = 0;
    await manager.tick();
    await manager.tick();
    expect(changes).toBe(0);
    expect(up.count("tools/list")).toBe(lists);
    expect(up.count("initialize")).toBe(1);
    expect(up.count("ping")).toBe(2);
  });

  it("re-lists once when the upstream sends tools/list_changed", async () => {
    const up = await fake("woo", { t: () => "x" });
    await manager.reload();
    // The notification stream (GET) opens just after initialize; wait until the upstream has seen it.
    await waitFor(() => up.headers.some((_, i) => up.requests[i] === "GET"));
    changes = 0;
    up.addTool("fresh", () => "y");
    await waitFor(() => names().includes("woo__fresh"));
    expect(changes).toBe(1);
  });

  it("skips upstream tools whose prefixed name clients would reject", async () => {
    await fake("woo", { ok: () => "x", [`${"x".repeat(60)}`]: () => "too long" });
    await manager.reload();
    expect(names()).toEqual(["woo__ok"]);
  });

  it("reload() after disabling a row drops its tools and emits once", async () => {
    await fake("woo", { t: () => "x" });
    await fake("fx", { c: () => "x" });
    await manager.reload();
    changes = 0;
    await pool.query("UPDATE upstream_servers SET enabled = false WHERE slug = 'fx'");
    await manager.reload();
    expect(names()).toEqual(["woo__t"]);
    expect(status("fx")).toBe("disabled");
    expect(changes).toBe(1);
    await manager.reload();
    expect(changes).toBe(1);
  });

  it("reload() after deleting a row forgets the server", async () => {
    await fake("woo", { t: () => "x" });
    await manager.reload();
    await pool.query("DELETE FROM upstream_servers WHERE slug = 'woo'");
    await manager.reload();
    expect(manager.statuses()).toEqual([]);
  });
});
