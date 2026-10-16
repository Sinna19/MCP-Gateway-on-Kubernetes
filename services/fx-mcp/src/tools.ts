import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { convert, ratesFor } from "./rates.js";

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as USD");

// Success becomes JSON text, a thrown error (unknown currency) becomes an MCP tool error.
function toolResult(run: () => unknown) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(run()) }] };
  } catch (err) {
    const text = err instanceof Error ? err.message : "Unexpected error";
    return { isError: true, content: [{ type: "text" as const, text }] };
  }
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "convert_currency",
    {
      description:
        "Convert an amount between currencies using fixed demo rates. Returns the unrounded rate and the result rounded to the target currency's decimals.",
      inputSchema: {
        // The upper bound keeps JSON output out of exponent notation.
        amount: z.number().positive().max(1e12).describe("Amount to convert, greater than 0 and at most 1e12"),
        from: currency.describe("Source currency code, e.g. USD"),
        to: currency.describe("Target currency code, e.g. EUR"),
      },
    },
    ({ amount, from, to }) => toolResult(() => convert(amount, from, to)),
  );

  server.registerTool(
    "list_rates",
    {
      description: "List the exchange rate from a base currency to every other supported currency (default base USD).",
      inputSchema: { base: currency.default("USD").describe("Base currency code, default USD") },
    },
    ({ base }) => toolResult(() => ratesFor(base)),
  );
}
