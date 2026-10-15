---
paths:
  - "services/gateway/**"
  - "apps/dashboard/**"
---
# Gateway design rules

- **Tool naming**: `<server_slug>__<tool_name>`, slug unique `[a-z0-9_]`, router splits on the first `__`.
- **Failure isolation**: list upstreams in parallel with per-upstream timeout (`Promise.allSettled`); a dead upstream drops out and is marked Unreachable, never fails the whole request. Calls have a timeout and return an MCP error naming the server.
- **Health**: background checker (connect + `tools/list`) caches tools and status Connected / Unreachable / Disabled.
- **Credentials**: upstream credentials encrypted at rest (AES-256-GCM, key from a Secret), decrypted only when calling the upstream. Never in API responses, logs, browser, or MCP responses. Client API keys are never forwarded upstream.
- **API keys**: 32+ random bytes, prefix `umk_`, stored as SHA-256 hash, shown once, revocation checked on every request.
- **Audit**: every tool call (MCP endpoint and chat) writes user, server, tool, started_at, duration_ms, outcome, error, source (`mcp` | `chat`) in a `finally` block.
- **Disabled servers**: tools vanish from `tools/list`, calls rejected, `notifications/tools/list_changed` sent to open sessions.
- **Roles**: `admin` and `member`, enforced server-side on every route.
- **Chat agent**: uses the same `callTool(user, name, args)` as `/mcp`. Tool descriptions and results are untrusted text.
- Check the MCP TypeScript SDK's current docs before writing transport code; don't code from memory.
- HTTP servers set requestTimeout/headersTimeout. Outbound fetch to upstreams uses redirect: 'error' and a timeout that covers the body.
