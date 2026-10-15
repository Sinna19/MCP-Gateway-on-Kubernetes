# 006: Gateway MCP endpoint is stateful, single replica, Express, low-level Server

**Status:** accepted
**Date:** 2026-10-15

## Context
When an admin disables a server, its tools must vanish from every open client, so the gateway has to push `notifications/tools/list_changed`. A stateless endpoint (like woo-mcp's) has no open stream to push on. The gateway also needs a REST API with cookies in 3b, and it re-exposes upstream tools whose schemas arrive as raw JSON Schema.

## Decision
- `/mcp` is stateful: one MCP `Server` + `StreamableHTTPServerTransport` per session, kept in an in-memory map. Sessions end on `DELETE /mcp` and after 30 minutes idle. A session is bound to the key that opened it; another key gets 404.
- The API key is checked on every request, not only at `initialize`, so revoking a key works inside an open session.
- The gateway runs as one replica. `UpstreamManager` also holds the upstream connections in memory.
- Express 5 for HTTP, shared with the REST API in 3b.
- The low-level SDK `Server` (not `McpServer`), because `tools/list` and `tools/call` are answered from upstream tools with their JSON Schemas, not from zod-registered tools.

## Alternatives considered
- Stateless like woo-mcp: scales, but `list_changed` cannot be pushed. Clients would see changes only when they next call `tools/list`.
- Sticky sessions or a shared session store (Redis) for several replicas: more moving parts than a two-week project needs. It would also need upstream connections per replica.
- `McpServer` with zod tools: cannot take JSON Schemas from upstreams without converting them.
- Plain `node:http` or Hono: more hand-written routing/cookie code, or one more thing to explain.

## Consequences
- A gateway restart drops all sessions. SDK clients get 404 for the old id and re-initialize.
- Scaling out needs sticky sessions plus a rework of who owns upstream connections. Say so in DESIGN.md.
- A `list_changed` sent by an upstream just before our client's notification stream (GET) opens is lost; the tool list is then stale until the next reconnect. The window is a few milliseconds after `initialize`, and a 5s ping tick does not re-list. Accepted.
- Upstream connections: one persistent client per upstream, a ping every ~5s, tools re-listed only on (re)connect or an upstream `list_changed`. `toolsChanged` is emitted only when the combined tool set differs, so clients are not notified every 5 seconds.
- Gateway call timeout is 15s, longer than woo-mcp's own 10s, so woo's clear error arrives first.
