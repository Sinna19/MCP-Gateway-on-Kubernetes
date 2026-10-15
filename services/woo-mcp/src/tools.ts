import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WooError, type WooClient } from "./woo-client.js";

const ORDER_STATUSES = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"] as const;

// Every handler goes through here: success becomes JSON text, any failure becomes an MCP tool error.
async function toolResult(run: () => Promise<unknown>) {
  try {
    const data = await run();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  } catch (err) {
    // WooError messages are written by us and safe to show. Anything else may leak internals.
    const text = err instanceof WooError ? err.message : "Unexpected error while talking to WooCommerce";
    return { isError: true, content: [{ type: "text" as const, text }] };
  }
}

// Woo payloads are huge. Return only what an LLM needs.
type Rec = Record<string, unknown>;

function trimProduct(p: Rec) {
  return { id: p.id, name: p.name, sku: p.sku, price: p.price, status: p.status, stock_status: p.stock_status };
}

function trimOrder(o: Rec) {
  const billing = (o.billing ?? {}) as Rec;
  const items = ((o.line_items ?? []) as Rec[]).map((i) => ({ name: i.name, quantity: i.quantity }));
  const customer = [billing.first_name, billing.last_name].filter(Boolean).join(" ");
  return {
    id: o.id,
    status: o.status,
    total: o.total,
    currency: o.currency,
    date_created_gmt: o.date_created_gmt,
    customer,
    items,
  };
}

const paging = {
  per_page: z.number().int().min(1).max(100).default(20).describe("Results per page (1-100, default 20)"),
  page: z.number().int().min(1).optional().describe("Page number, starting at 1"),
};

export function registerTools(server: McpServer, woo: WooClient): void {
  server.registerTool(
    "list_products",
    {
      description: "List products in the WooCommerce store. Optionally search by name or SKU text.",
      inputSchema: { search: z.string().optional().describe("Text to search in product name/SKU"), ...paging },
    },
    ({ search, per_page, page }) =>
      toolResult(async () => {
        const products = (await woo.request("GET", "/products", { query: { search, per_page, page } })) as Rec[];
        return products.map(trimProduct);
      }),
  );

  server.registerTool(
    "create_product",
    {
      description:
        "Create a simple product in the store. It is published (visible on the storefront) unless status is set to draft.",
      inputSchema: {
        name: z.string().min(1).describe("Product name"),
        regular_price: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, "must be a decimal string like 12 or 12.50")
          .describe("Price as a decimal string, e.g. \"12.50\""),
        description: z.string().optional().describe("Product description"),
        sku: z.string().optional().describe("Stock keeping unit, must be unique"),
        status: z.enum(["publish", "draft"]).default("publish").describe("publish (default) or draft"),
      },
    },
    ({ name, regular_price, description, sku, status }) =>
      toolResult(async () => {
        const body: Rec = { name, type: "simple", regular_price, status };
        if (description !== undefined) body.description = description;
        if (sku !== undefined) body.sku = sku;
        const created = (await woo.request("POST", "/products", { body })) as Rec;
        return { ...trimProduct(created), permalink: created.permalink };
      }),
  );

  server.registerTool(
    "list_orders",
    {
      description:
        "List orders, newest first. Filter by status and by creation time. 'after' and 'before' are UTC ISO 8601 " +
        "datetimes, e.g. 2026-10-15T00:00:00Z. For 'orders today' pass today's UTC midnight as 'after'.",
      inputSchema: {
        status: z.enum(ORDER_STATUSES).optional().describe("Only orders with this status"),
        after: z.iso.datetime().optional().describe("Only orders created after this UTC time"),
        before: z.iso.datetime().optional().describe("Only orders created before this UTC time"),
        ...paging,
      },
    },
    ({ status, after, before, per_page, page }) =>
      toolResult(async () => {
        // dates_are_gmt=true makes Woo read after/before as UTC, not in the store's timezone.
        const query = { status, after, before, dates_are_gmt: true, per_page, page };
        const orders = (await woo.request("GET", "/orders", { query })) as Rec[];
        return orders.map(trimOrder);
      }),
  );

  server.registerTool(
    "get_order",
    {
      description: "Get one order by its numeric id: status, total, customer name and items.",
      inputSchema: { id: z.number().int().positive().describe("Order id") },
    },
    ({ id }) => toolResult(async () => trimOrder((await woo.request("GET", `/orders/${id}`)) as Rec)),
  );

  server.registerTool(
    "update_order_status",
    {
      description: "Change an order's status, e.g. mark a processing order as completed or cancelled.",
      inputSchema: {
        id: z.number().int().positive().describe("Order id"),
        status: z.enum(ORDER_STATUSES).describe("New status"),
      },
    },
    ({ id, status }) =>
      toolResult(async () => trimOrder((await woo.request("PUT", `/orders/${id}`, { body: { status } })) as Rec)),
  );
}
