# Handoff

- **Done this session (phase 3-fix, all 12 review findings):**
  - 7894be3 `fix(gateway): review hardening`: #2 generic `server '<slug>' failed` to callers and audit (detail in `console.warn`), #6 last-admin check in a locked transaction (409), #8 tool name cut to 100, #9 decrypt failure only marks that server unreachable, #11 migration 003 unique `lower(email)` + lowercase bootstrap admin, #12 more forbidden headers, #1 `src/url-guard.ts` SSRF block at registration and at connect.
  - 1794ce9 `fix(charts): deploy waits, secret guard, postgres hardening`: #3 rollout status in `make deploy`, #4 `secrets.sh` refuses to recreate `gateway-db` when the PVC exists, #5 `runAsGroup: 70`.
  - PLAN gained: Phase 5 ingress paths in values, Phase 6 cap tool descriptions, Phase 7 session cap per key + sweep failed initialize, Phase 7 gateway egress NetworkPolicy. ADR 009 notes #1's scope.
  - Checks: `make lint` ok, `make test` ok, `make deploy` ok (both rollouts waited), `GET /api/servers` 401, Postgres `uid=70 gid=70`, migration 003 applied, gateway RESTARTS 0. Guard script exit 1 proven in a scratch namespace.
- **In progress:** nothing. Tree is clean after the handoff commit.
- **Next step:** `4 fx-mcp` (then `4 notes-mcp` and registration in a later session, per the split-big-phases memory). The Phase 0 VPS deploy checkbox (PLAN line 27) is still open.
- **Gotchas learned:**
  - `allowLoopback` (UpstreamManager, createApp, serverRoutes, `startServer` third arg in `test/api-helpers.ts`) is test-only. New tests with fake upstreams on 127.0.0.1 must pass it, or the server shows unreachable / 400. Noted in `.claude/rules/gateway.md`.
  - The no-chart local smoke with `SEED_WOO_URL=http://127.0.0.1:...` now fails the guard; run the smoke against the cluster instead.
  - Real fx-mcp and notes-mcp are registered by in-cluster DNS or private IP, which the guard allows.
  - Concurrency tests: both requests pass `loadUser` before either writes, so `Promise.all` on two PATCHes really exercises the lock.
  - Git Bash blocks `sleep`; poll with `read -t 1 <> <(:) || true`. Namespace is `urumi`, login is `POST http://app.localtest.me/api/auth/login`.
- **Files the next task needs:** `docs/PLAN.md` (Phase 4, line 54), `docs/REQUIREMENTS.md`, `services/woo-mcp/` (template for a new MCP service), `.claude/rules/gateway.md`, `.claude/rules/kubernetes.md`.
