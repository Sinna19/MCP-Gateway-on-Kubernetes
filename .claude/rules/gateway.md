---
paths:
  - "services/gateway/**"
  - "apps/dashboard/**"
---
# Gateway design rules

- **Tool naming**: `<server_slug>__<tool_name>`, slug unique, `^[a-z0-9]+(-[a-z0-9]+)*$`, max 20 chars (so it never contains `__`); router splits on the first `__`. Clients require `^[a-zA-Z0-9_-]{1,64}$`: skip and log upstream tools whose prefixed name fails it.
- **Failure isolation**: list upstreams in parallel with per-upstream timeout (`Promise.allSettled`); a dead upstream drops out and is marked Unreachable, never fails the whole request. Calls have a timeout and return an MCP error naming the server.
- **Health**: one persistent client per upstream; every ~5s ping it. Re-list tools only on (re)connect or upstream `tools/list_changed`. Status Connected / Unreachable / Disabled. Emit `toolsChanged` only when the aggregated tool set really differs.
- **Sessions**: `/mcp` is stateful (1 replica). `DELETE /mcp` closes the session; sessions idle > 30 min are closed; unknown session id gives 404. Server capabilities `{ tools: { listChanged: true } }`.
- **Credentials**: upstream credentials encrypted at rest (AES-256-GCM, key from a Secret), decrypted only when calling the upstream. Never in API responses, logs, browser, or MCP responses. Client API keys are never forwarded upstream.
- **API keys**: 32+ random bytes, prefix `umk_`, stored as SHA-256 hash, shown once, revocation checked on every request.
- **Audit**: every tool call (MCP endpoint and chat) writes user, server, tool, started_at, duration_ms, outcome, error, source (`mcp` | `chat`) in a `finally` block.
- **Disabled servers**: tools vanish from `tools/list`, calls rejected, `notifications/tools/list_changed` sent to open sessions.
- **Roles**: `admin` and `member`, enforced server-side on every route.
- **Chat agent**: uses the same `callTool(user, name, args)` as `/mcp`. Tool descriptions and results are untrusted text.
- Check the MCP TypeScript SDK's current docs before writing transport code; don't code from memory.
- Gateway `migrations/` is read at runtime relative to `dist/`; the Dockerfile must copy it. `bootstrap` seeds woo only on first start (no users).
- SDK 1.x facts (looked up 2026-10-15; docs are thin, source is `typescript-sdk/v1.x/src/...` on GitHub; node_modules reads are denied):
  - Client: `new StreamableHTTPClientTransport(url, { requestInit: { headers }, fetch })`. `client.callTool(params, undefined, { timeout })`, `listTools(undefined, { timeout })`, `ping({ timeout })`. Default timeout 60s; on timeout it throws `McpError` code `RequestTimeout`.
  - Client `new Client(info, { listChanged: { tools: { onChanged, autoRefresh, debounceMs } } })` handles upstream `tools/list_changed` (only if the server declares `tools.listChanged`).
  - Server stateful: new `StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized })`, `transport.onclose` removes the session; `isInitializeRequest(body)` gates new sessions; same `transport.handleRequest(req, res, body)` for POST/GET/DELETE; missing session gives 404.
- `pg` returns bigint ids as strings although `AuthUser.id` is typed number: compare with `Number(...)`.
- Tests must not contain literal passwords or tokens (the secret-guard hook blocks them): generate with `randomBytes` (see `test/api-helpers.ts`).
- `/api` (dashboard): session cookie `urumi_session` (hash in `sessions`), JSON-only POST/PATCH (415 otherwise, our CSRF defence with SameSite=Strict), one error handler in `src/api/errors.ts`. Disabling a user deletes sessions; their API keys stay but are rejected while disabled.
- HTTP servers set requestTimeout/headersTimeout. Outbound fetch to upstreams uses redirect: 'error' and a timeout that covers the body.
