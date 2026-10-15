# Handoff

- **Done this session:** Phase 3a (gateway service + /mcp). 61 tests pass against real Postgres (Docker), `make lint` clean.
  - 340eeae scaffold, migrations, test Postgres (global-setup starts `postgres:17.6-alpine`)
  - 044e9c9 crypto (AES-GCM, slug as AAD), API keys, scrypt passwords, tool names, bootstrap
  - 12da94b UpstreamManager (persistent clients, ping tick, `reload()`, `toolsChanged` only on a real diff)
  - 92f23a2 Gateway.callTool (audit in finally), stateful `/mcp` (DELETE, 30 min idle sweep), config, index
  - 2042c8f ADRs 006 (sessions) and 007 (tool naming), PLAN split into 3a/3b/3c
  - Smoke on real cluster: port-forward woo-mcp + local gateway: `tools/list` = 5 `woo__*` tools, call returned a product, no key 401, revoked key 401, audit row written.
- **In progress:** nothing half-finished. PLAN Phase 3 boxes: 3a ticked for manager and `/mcp`; the rest are annotated with what is left.
- **Next step:** `3b gateway REST API`
  - Session-cookie login (`verifyPassword` exists), servers CRUD (admin; call `upstreams.reload()` after each change, encrypt credentials with slug as AAD), members + invites, own keys (admin revokes any), audit query, serializers that never include credentials (unit test). Then 3c: Dockerfile, Postgres + gateway charts, Ingress, Accept checks.
- **Gotchas learned:**
  - Reads under `node_modules` are denied; SDK docs are thin. Use `raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/...` (answers are in `.claude/rules/gateway.md`).
  - Bash permission rules choke on `cmd | tail; other` chains: keep one command per call.
  - Upstream `list_changed` is lost if it arrives before the client's GET stream opens; tests wait for the GET first (ADR 006).
  - `migrations/` is read from `../migrations` relative to `dist/`: the Dockerfile must copy it (3c).
  - `bootstrap` seeds woo only when there are no users, so a removed woo is not re-added.
  - `docker` must be running for `make test` (gateway).
- **Files the next task needs:** CLAUDE.md, docs/REQUIREMENTS.md, docs/PLAN.md (Phase 3), `.claude/rules/gateway.md`, `services/gateway/src/{app,gateway,api-keys,passwords,upstreams,crypto}.ts`, `services/gateway/test/helpers.ts`.
