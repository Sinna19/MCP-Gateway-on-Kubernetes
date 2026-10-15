import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ErrorCode, McpError, ToolListChangedNotificationSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type pg from "pg";
import { decrypt } from "./crypto.js";
import { isValidToolName, prefixed } from "./tool-names.js";

export type UpstreamStatus = "connected" | "unreachable" | "disabled";

export interface ServerStatus {
  slug: string;
  url: string;
  status: UpstreamStatus;
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
}

// What the admin API needs from the manager (a plain object in tests).
export interface UpstreamControl {
  reload(): Promise<void>;
  statuses(): ServerStatus[];
}

interface ServerRow {
  slug: string;
  url: string;
  enabled: boolean;
  header_name: string | null;
  credential_enc: string | null;
}

interface Entry {
  row: ServerRow;
  status: UpstreamStatus;
  client?: Client;
  tools: Tool[];
}

export interface UpstreamManagerOptions {
  pool: pg.Pool;
  credentialsKey: Buffer;
  callTimeoutMs?: number; // longer than woo-mcp's own 10s, so woo's clear error arrives first
  connectTimeoutMs?: number;
  pingTimeoutMs?: number;
  intervalMs?: number;
}

// Errors with a message that is safe to show to the caller (names the server, never a credential).
export class UpstreamError extends Error {}

// Keeps one MCP client per enabled upstream. Emits "toolsChanged" only when the combined tool list really changes.
export class UpstreamManager extends EventEmitter {
  private entries = new Map<string, Entry>();
  private lastSignature = "[]";
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private readonly pool: pg.Pool;
  private readonly key: Buffer;
  private readonly callTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly pingTimeoutMs: number;
  private readonly intervalMs: number;

  constructor(options: UpstreamManagerOptions) {
    super();
    this.pool = options.pool;
    this.key = options.credentialsKey;
    this.callTimeoutMs = options.callTimeoutMs ?? 15_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
    this.pingTimeoutMs = options.pingTimeoutMs ?? 3_000;
    this.intervalMs = options.intervalMs ?? 5_000;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    for (const entry of this.entries.values()) this.dropClient(entry);
    this.entries.clear();
  }

  // Re-reads upstream_servers and makes the connections match. Called at startup and after every admin change.
  async reload(): Promise<void> {
    const { rows } = await this.pool.query<ServerRow>("SELECT slug, url, enabled, header_name, credential_enc FROM upstream_servers");
    const toConnect: Entry[] = [];
    for (const row of rows) {
      const existing = this.entries.get(row.slug);
      if (existing && JSON.stringify(existing.row) === JSON.stringify(row)) continue;
      if (existing) this.dropClient(existing);
      const entry: Entry = { row, status: row.enabled ? "unreachable" : "disabled", tools: [] };
      this.entries.set(row.slug, entry);
      if (row.enabled) toConnect.push(entry);
    }
    const slugs = new Set(rows.map((r) => r.slug));
    for (const [slug, entry] of this.entries) {
      if (slugs.has(slug)) continue;
      this.dropClient(entry);
      this.entries.delete(slug);
    }
    await Promise.allSettled(toConnect.map((e) => this.connect(e)));
    this.emitIfChanged();
  }

  // Every interval: ping connected upstreams (no tools/list), and try again to connect the unreachable ones.
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const enabled = [...this.entries.values()].filter((e) => e.row.enabled);
      await Promise.allSettled(
        enabled.map(async (entry) => {
          if (entry.status !== "connected" || !entry.client) return this.connect(entry);
          try {
            await entry.client.ping({ timeout: this.pingTimeoutMs });
          } catch {
            this.markUnreachable(entry);
          }
        }),
      );
      this.emitIfChanged();
    } finally {
      this.ticking = false;
    }
  }

  statuses(): ServerStatus[] {
    return [...this.entries.values()].map((e) => ({
      slug: e.row.slug,
      url: e.row.url,
      status: e.status,
      toolCount: e.tools.length,
      tools: e.tools.map((t) => ({ name: prefixed(e.row.slug, t.name), description: t.description ?? "" })),
    }));
  }

  // Tools of connected upstreams, named "<slug>__<tool>".
  tools(): Tool[] {
    const all: Tool[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "connected") continue;
      for (const tool of entry.tools) all.push({ ...tool, name: prefixed(entry.row.slug, tool.name) });
    }
    return all;
  }

  async callTool(slug: string, tool: string, args: Record<string, unknown> | undefined): Promise<CallToolResult> {
    const entry = this.entries.get(slug);
    if (!entry) throw new UpstreamError(`server '${slug}' not found`);
    if (entry.status === "disabled") throw new UpstreamError(`server '${slug}' is disabled`);
    if (entry.status !== "connected" || !entry.client) throw new UpstreamError(`server '${slug}' is unreachable`);
    try {
      const result = await entry.client.callTool({ name: tool, arguments: args }, CallToolResultSchema, { timeout: this.callTimeoutMs });
      return CallToolResultSchema.parse(result);
    } catch (err) {
      if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
        throw new UpstreamError(`server '${slug}' timed out after ${this.callTimeoutMs / 1000}s`);
      }
      throw new UpstreamError(`server '${slug}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async connect(entry: Entry): Promise<void> {
    const { row } = entry;
    const headers = row.header_name && row.credential_enc ? { [row.header_name]: decrypt(this.key, row.credential_enc, row.slug) } : undefined;
    const transport = new StreamableHTTPClientTransport(new URL(row.url), {
      requestInit: headers ? { headers } : undefined,
      fetch: this.limitedFetch,
    });
    const client = new Client({ name: "urumi-gateway", version: "0.1.0" });
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      if (entry.client !== client) return;
      try {
        entry.tools = await this.listAll(client, row.slug);
        this.emitIfChanged();
      } catch {
        this.markUnreachable(entry);
        this.emitIfChanged();
      }
    });
    client.onclose = () => {
      if (entry.client !== client) return;
      this.markUnreachable(entry);
      this.emitIfChanged();
    };
    entry.client = client;
    try {
      await client.connect(transport, { timeout: this.connectTimeoutMs });
      const tools = await this.listAll(client, row.slug);
      if (this.entries.get(row.slug) !== entry) throw new Error("replaced while connecting");
      entry.tools = tools;
      entry.status = "connected";
    } catch (err) {
      if (entry.client === client) this.markUnreachable(entry);
      else void client.close().catch(() => undefined);
      console.warn(`upstream '${row.slug}' unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async listAll(client: Client, slug: string): Promise<Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: this.connectTimeoutMs });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools.filter((t) => {
      const ok = isValidToolName(prefixed(slug, t.name));
      if (!ok) console.warn(`upstream '${slug}': skipping tool '${t.name}', the prefixed name is not a valid MCP tool name`);
      return ok;
    });
  }

  private markUnreachable(entry: Entry): void {
    this.dropClient(entry);
    entry.status = "unreachable";
    entry.tools = [];
  }

  private dropClient(entry: Entry): void {
    const client = entry.client;
    entry.client = undefined;
    if (client) void client.close().catch(() => undefined);
  }

  private emitIfChanged(): void {
    const signature = JSON.stringify(
      this.tools()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => [t.name, t.description, t.inputSchema]),
    );
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.emit("toolsChanged");
  }

  // Never follow redirects. POSTs (initialize, tools/call, ping) get a hard limit that includes reading the body.
  // The long-lived GET stream that carries notifications is left without a limit.
  private limitedFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signals = [init?.signal, init?.method === "POST" ? AbortSignal.timeout(this.callTimeoutMs + 5_000) : undefined].filter((s): s is AbortSignal => !!s);
    return fetch(input, { ...init, redirect: "error", signal: signals.length > 0 ? AbortSignal.any(signals) : undefined });
  };
}
