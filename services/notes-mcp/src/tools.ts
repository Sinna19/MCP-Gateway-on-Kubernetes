import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_LIST, MAX_PRODUCT, MAX_TEXT, type NoteStore } from "./notes.js";

// Success becomes JSON text, a thrown error (full store, bad input) becomes an MCP tool error.
function toolResult(run: () => unknown) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(run()) }] };
  } catch (err) {
    const text = err instanceof Error ? err.message : "Unexpected error";
    return { isError: true, content: [{ type: "text" as const, text }] };
  }
}

export function registerTools(server: McpServer, store: NoteStore): void {
  server.registerTool(
    "add_note",
    {
      description:
        "Save a short free-text note, optionally tagged with a product name. Notes are shared by all users of this gateway and are lost when the notes server restarts.",
      inputSchema: {
        text: z.string().max(MAX_TEXT).describe(`Note text, at most ${MAX_TEXT} characters`),
        product: z.string().max(MAX_PRODUCT).optional().describe("Optional product name this note is about"),
      },
    },
    ({ text, product }) => toolResult(() => store.add(text, product)),
  );

  server.registerTool(
    "list_notes",
    {
      description: `List saved notes, newest first (at most ${MAX_LIST}). Optionally only notes tagged with one product.`,
      inputSchema: {
        product: z.string().optional().describe("Only notes tagged with this product (case-insensitive)"),
        limit: z.number().int().min(1).max(MAX_LIST).optional().describe(`How many notes, 1 to ${MAX_LIST}`),
      },
    },
    ({ product, limit }) => toolResult(() => store.list({ product, limit })),
  );

  // Same name as a woo-mcp tool on purpose: the gateway shows it as notes__list_products (ADR 007).
  server.registerTool(
    "list_products",
    {
      description:
        "List product names that appear in saved notes, with a note count for each. This is NOT the store catalog; use the store's own product tool for that.",
    },
    () => toolResult(() => store.products()),
  );
}
