# Handoff

- **Done this session:** Phase 3c steps 0 to 3. `make lint` and `make test` green, `make deploy` green.
  - dce32ee `test(gateway): drop test DB without FORCE` (plain DROP, retry on 55006, FORCE last; 10x loop of mcp-endpoint.test.ts passed 13/13).
  - 5ea9785 `feat(gateway): Dockerfile and secrets` (Dockerfile copies `migrations/`; `scripts/secrets.sh` makes `gateway-db`, `gateway-app`).
  - b7465eb `feat(gateway): chart with Postgres, Ingress, NetworkPolicy` (+ Makefile GATEWAY_TAG).
  - Live: `gateway` and `gateway-postgres-0` 1/1 Running, log "gateway listening on :8080", `curl http://app.localtest.me/api/servers` gives 401.
- **In progress:** nothing half-finished; tree clean after this commit. PLAN 3c boxes are NOT ticked yet (Accept not run).
- **Next step:** `3c Accept + ADR 009`: write `docs/decisions/009-gateway-deployment.md`, run Accept checks 1 to 6 from the plan file `C:\Users\aashi\.claude\plans\3c-dockerfile-charts-glowing-rainbow.md`, tick PLAN 3c, add gotchas to rules.
  - Accept: curl login + `POST /api/keys` + `tools/list` lists 5 `woo__*`; `claude mcp add` in default local scope (never `-s project`); revoked key 401; `scale deploy/woo-mcp --replicas=0` then poll `/api/servers` for Unreachable (gateway stays Ready), scale back to 1; delete `gateway-postgres-0`, login still works; `timeout 90 curl -N` GET `/mcp` with a session id stays open.
- **Gotchas learned:**
  - A long `cat > file <<'EOF'` batch in Bash failed to parse and wrote nothing; use the Write tool for chart files.
  - `cd` in a Bash call moves the working directory for later calls; use `cd /c/Users/aashi/dev/urumi-assignment && ...` or absolute paths.
  - Gateway Postgres pods are labelled `gateway-postgres`, never `gateway` (the woo-mcp NetworkPolicy allows `name=gateway`). `DB_PASSWORD` must precede `DATABASE_URL` in env. Read the admin password with the command in `scripts/secrets.sh`.
  - `sleep N` in Bash is blocked; use `kubectl rollout status` or Monitor.
- **Files the next task needs:** the plan file above, `docs/PLAN.md` (Phase 3 section, lines 45 to 52), `docs/decisions/008-dashboard-auth.md` (ADR style), `.claude/rules/{kubernetes,gateway}.md`, `charts/gateway/templates/{deployment,ingress}.yaml`.
