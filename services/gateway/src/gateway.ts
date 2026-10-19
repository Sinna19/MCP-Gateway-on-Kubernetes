import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type pg from "pg";
import type { AuthUser } from "./api-keys.js";
import { auditArgs } from "./audit-args.js";
import { splitName } from "./tool-names.js";
import { UpstreamError } from "./upstreams.js";

export type CallSource = "mcp" | "chat";
type Outcome = "ok" | "error" | "declined";

// What the gateway needs from the upstream manager (a plain object in tests).
export interface ToolBackend {
  tools(): Tool[];
  callTool(slug: string, tool: string, args: Record<string, unknown> | undefined): Promise<CallToolResult>;
}

const MAX_AUDIT_ERROR = 500;
const MAX_TOOL_NAME = 100; // caller-chosen text: bounded before it is echoed back or stored

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

// The one path every tool call takes, from /mcp and from the chat agent: route, call, audit.
export class Gateway {
  constructor(
    private readonly pool: pg.Pool,
    private readonly backend: ToolBackend,
  ) {}

  listTools(): Tool[] {
    return this.backend.tools();
  }

  // Failures come back as error results (so the caller, often an LLM, can read them), never as exceptions.
  async callTool(user: AuthUser, name: string, args: Record<string, unknown> | undefined, source: CallSource): Promise<CallToolResult> {
    const startedAt = new Date();
    const timer = performance.now();
    const parts = splitName(name);
    let outcome: "ok" | "error" = "error";
    let error: string | null = null;
    try {
      if (!parts) throw new UpstreamError(`unknown tool '${name.slice(0, MAX_TOOL_NAME)}'`);
      const result = await this.backend.callTool(parts.slug, parts.tool, args);
      if (result.isError) {
        // The upstream's own error text is a result, so it is not copied into the audit log.
        error = "tool returned an error";
        return result;
      }
      outcome = "ok";
      return result;
    } catch (err) {
      if (err instanceof UpstreamError) {
        error = err.message;
        return errorResult(err.message);
      }
      console.error(`tool call ${name} failed:`, err instanceof Error ? err.message : err);
      error = "internal error";
      return errorResult("internal error while calling the tool");
    } finally {
      await this.audit(user, name, args, startedAt, Math.round(performance.now() - timer), outcome, error, source);
    }
  }

  // The user declined a held chat write: audited like a call, but nothing is sent upstream.
  async recordDeclined(user: AuthUser, name: string, args: Record<string, unknown> | undefined): Promise<void> {
    await this.audit(user, name, args, new Date(), 0, "declined", null, "chat");
  }

  // The one audit writer, for calls and declines: the tool name split and the args redaction live here only.
  private async audit(user: AuthUser, name: string, args: Record<string, unknown> | undefined, startedAt: Date, durationMs: number, outcome: Outcome, error: string | null, source: CallSource): Promise<void> {
    const parts = splitName(name);
    const stored = auditArgs(args);
    try {
      await this.pool.query(
        "INSERT INTO audit_log (user_id, server_slug, tool, started_at, duration_ms, outcome, error, source, args) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [user.id, parts?.slug ?? null, (parts?.tool ?? name).slice(0, MAX_TOOL_NAME), startedAt, durationMs, outcome, error?.slice(0, MAX_AUDIT_ERROR) ?? null, source, stored === null ? null : JSON.stringify(stored)],
      );
    } catch (err) {
      console.error("audit write failed:", err instanceof Error ? err.message : err);
    }
  }
}
