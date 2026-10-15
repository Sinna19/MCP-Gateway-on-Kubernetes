# Handoff

- **Done this session:** Phase 3c complete, PLAN 3c ticked.
  - a340a35 `fix(gateway): keep-alive, startupProbe, graceful shutdown` (keepAlive 95s / headers 96s, startupProbe, SIGTERM drains 10s, grace 15s; PLAN phase 7/8 hardening bullets added).
  - 1fd97bb `docs: ADR 009, tick PLAN 3c` (ADR 009 says audit is best-effort on purpose; gotchas added to rules).
  - Step 0a: no stale flake note was left in HANDOFF; the flake is fixed in dce32ee.
  - Accept (real cluster): 1 PASS (login, `POST /api/keys`, `tools/list` shows 5 `woo__*`). 2 PASS (`claude mcp get urumi` Connected, local scope, no `.mcp.json`). 3 PASS (revoked key 200 then 401). 4 PASS (woo `unreachable` at t+5s, `tools/list` 200, gateway Ready, `connected` again after scale to 1). 6 PASS (`timeout 90 curl -N` GET `/mcp`: exit 124 after 91s).
  - Accept 5 PASS WITH A BUG: after `kubectl delete pod gateway-postgres-0`, login returned 503 for about 40s, then 200 (same admin, so the PVC works). The gateway process crashed and crash-looped on `migrate()` ECONNREFUSED until Postgres was back.
- **In progress:** nothing half-finished. Tree is clean except untracked `docs/explain/gateway-deployment.md` (not committed).
- **Next step:** `3c pool error handler`: `services/gateway/src/db.ts:8` `createPool` has no `pool.on("error", ...)`, so an idle-client error (57P01 when Postgres dies) is an unhandled event that kills the process. Test first, then add the handler (log only) and a bounded connect retry around `migrate()` in `src/index.ts:9`. Then re-run Accept 5 and expect no restarts.
- **Gotchas learned:**
  - Git Bash blocks `sleep`; poll with `read -t 1 <> <(:) || true`. `/api/servers` status is lowercase (`connected`, `unreachable`), so my first `case` patterns never matched.
  - Traefik idles backend sockets for 90s, so Node keepAliveTimeout must exceed it (in `.claude/rules/kubernetes.md`). The pool-error gotcha is in `.claude/rules/gateway.md`.
  - A scripted `initialized` notification needs its URL, or curl errors "no URL specified" (the session still worked).
  - Scratchpad has `login.json`, `key.txt`, cookie jars (secrets; never print them). The `accept-main` key is still active and is what `claude mcp` uses.
- **Files the next task needs:** `services/gateway/src/db.ts`, `services/gateway/src/index.ts`, `services/gateway/test/helpers.ts` (test DB patterns), `.claude/rules/gateway.md`.
