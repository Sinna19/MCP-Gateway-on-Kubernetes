import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../src/tools.js";
import { WooError, type WooClient } from "../src/woo-client.js";

let request: ReturnType<typeof vi.fn>;
let list: ReturnType<typeof vi.fn>;
let client: Client;

beforeEach(async () => {
  request = vi.fn();
  list = vi.fn();
  const server = new McpServer({ name: "woo-mcp", version: "test" });
  registerTools(server, { request, list } as unknown as WooClient);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterEach(async () => {
  await client.close();
});

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0]!.text;
  return { isError: res.isError === true, text };
}

const order = { id: 14, status: "processing", total: "30.00", currency: "USD", date_created_gmt: "2026-10-15T08:00:00" };

describe("tool list", () => {
  it("exposes exactly the five tools, each with a description", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_product",
      "get_order",
      "list_orders",
      "list_products",
      "update_order_status",
    ]);
    for (const t of tools) expect(t.description?.length).toBeGreaterThan(20);
  });
});

describe("list_products", () => {
  it("calls GET /products and trims the payload", async () => {
    list.mockResolvedValue({
      items: [
        { id: 1, name: "Mug", sku: "MUG-001", price: "12.00", status: "publish", stock_status: "instock", images: [{}], description: "long" },
      ],
      total: 7,
      total_pages: 1,
    });
    const out = await call("list_products", { search: "mug" });
    expect(list).toHaveBeenCalledWith("/products", { search: "mug", per_page: 20, page: undefined });
    expect(JSON.parse(out.text)).toEqual({
      items: [{ id: 1, name: "Mug", sku: "MUG-001", price: "12.00", status: "publish", stock_status: "instock" }],
      total: 7,
      total_pages: 1,
    });
  });

  it("rejects per_page above 100", async () => {
    const out = await call("list_products", { per_page: 500 });
    expect(out.isError).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("create_product", () => {
  it("POSTs a published simple product by default", async () => {
    request.mockResolvedValue({ id: 20, name: "Cap", sku: "", price: "12", status: "publish", stock_status: "instock", permalink: "http://shop/cap/" });
    const out = await call("create_product", { name: "Cap", regular_price: "12" });
    expect(request).toHaveBeenCalledWith("POST", "/products", {
      body: { name: "Cap", type: "simple", regular_price: "12", status: "publish" },
    });
    expect(JSON.parse(out.text).id).toBe(20);
  });

  it("passes optional description and sku", async () => {
    request.mockResolvedValue({ id: 21 });
    await call("create_product", { name: "Cap", regular_price: "12.50", description: "Nice", sku: "CAP-1", status: "draft" });
    expect(request.mock.calls[0]![2].body).toEqual({
      name: "Cap",
      type: "simple",
      regular_price: "12.50",
      status: "draft",
      description: "Nice",
      sku: "CAP-1",
    });
  });

  it("rejects a price that is not a decimal string", async () => {
    const out = await call("create_product", { name: "Cap", regular_price: "twelve" });
    expect(out.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("list_orders", () => {
  it("always sends dates_are_gmt=true so after/before are read as UTC", async () => {
    list.mockResolvedValue({ items: [], total: 0, total_pages: 0 });
    await call("list_orders", { status: "processing", after: "2026-10-15T00:00:00Z", before: "2026-10-16T00:00:00Z" });
    expect(list).toHaveBeenCalledWith("/orders", {
      status: "processing",
      after: "2026-10-15T00:00:00Z",
      before: "2026-10-16T00:00:00Z",
      dates_are_gmt: true,
      per_page: 20,
      page: undefined,
    });
  });

  it("sends dates_are_gmt even with no filters, and trims orders", async () => {
    list.mockResolvedValue({
      items: [
        { ...order, billing: { first_name: "A", last_name: "B", email: "a@b.c" }, line_items: [{ name: "Mug", quantity: 2, extra: 1 }], payment_method: "cod" },
      ],
      total: 1,
      total_pages: 1,
    });
    const out = await call("list_orders", {});
    expect(list.mock.calls[0]![1].dates_are_gmt).toBe(true);
    expect(JSON.parse(out.text)).toEqual({
      items: [{ ...order, customer: "A B", items: [{ name: "Mug", quantity: 2 }] }],
      total: 1,
      total_pages: 1,
    });
  });

  it("rejects an unknown status and a non-date after", async () => {
    expect((await call("list_orders", { status: "shipped" })).isError).toBe(true);
    expect((await call("list_orders", { after: "yesterday" })).isError).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("get_order", () => {
  it("calls GET /orders/{id}", async () => {
    request.mockResolvedValue({ ...order, billing: {}, line_items: [] });
    const out = await call("get_order", { id: 14 });
    expect(request).toHaveBeenCalledWith("GET", "/orders/14");
    expect(JSON.parse(out.text).id).toBe(14);
  });

  it("rejects a negative id", async () => {
    expect((await call("get_order", { id: -1 })).isError).toBe(true);
  });
});

describe("update_order_status", () => {
  it("PUTs the new status", async () => {
    request.mockResolvedValue({ ...order, status: "completed", billing: {}, line_items: [] });
    const out = await call("update_order_status", { id: 14, status: "completed" });
    expect(request).toHaveBeenCalledWith("PUT", "/orders/14", { body: { status: "completed" } });
    expect(JSON.parse(out.text).status).toBe("completed");
  });

  it("rejects a status Woo does not have", async () => {
    const out = await call("update_order_status", { id: 14, status: "shipped" });
    expect(out.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("errors become tool errors, not crashes", () => {
  it("returns the WooError message", async () => {
    request.mockRejectedValue(new WooError("WooCommerce returned 404: Invalid ID."));
    const out = await call("get_order", { id: 999999 });
    expect(out).toEqual({ isError: true, text: "WooCommerce returned 404: Invalid ID." });
  });

  it("hides unexpected error details from the caller but logs them", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    list.mockRejectedValue(new TypeError("secret internals"));
    const out = await call("list_products", {});
    expect(out.isError).toBe(true);
    expect(out.text).toBe("Unexpected error while talking to WooCommerce");
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("does not log expected WooErrors", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    request.mockRejectedValue(new WooError("WooCommerce returned 404: Invalid ID."));
    await call("get_order", { id: 1 });
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
