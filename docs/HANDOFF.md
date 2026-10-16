# Handoff
- **Latest (fx-mcp fix):** graceful 10s drain on SIGTERM, strict PORT validation, grace period 15s, ADR 010 float note. Next step unchanged: notes-mcp, copying fx-mcp.

- **Done this session (phase 4, fx-mcp):**
  - 527d3ac `feat(fx-mcp)`: `services/fx-mcp` (tools `convert_currency`, `list_rates`; static USD table with per-currency minor units; case-insensitive Bearer check; `FX_TOKEN` must be >= 32 chars), chart objects in `charts/upstreams` (Deployment, ClusterIP Service, NetworkPolicy gateway-only, all under an `fx:` block), Secret `fx-mcp-token` in `scripts/secrets.sh`, Makefile (`FX_MCP_TAG`, image import, rollout wait, lint/test), ADR 010.
  - Checks: `make lint` ok, `make test` ok (26 fx tests), `make deploy` ok, fx-mcp 1/1 Ready, Service ClusterIP and no Ingress, image present in k3d. Gateway-labelled pod: no token 401, token 200. Unlabelled pod: curl exit 7. `helm template charts/upstreams --set fx=null` renders 0 objects, exit 0.
  - PLAN: fx-mcp ticked. Nothing pushed.
- **In progress:** nothing. fx-mcp is deployed but NOT registered in the gateway, so the Phase 4 Accept (woo + fx prompt) is not checked yet.
- **Next step:** `4 notes-mcp` (service + tests + chart, same shape as fx-mcp; a tool name that also exists on woo-mcp, e.g. `list_products`... pick one for the collision demo). Registration of both via the API is a later session.
- **Gotchas learned:**
  - Read the fx token without printing it: `kubectl -n urumi get secret fx-mcp-token -o jsonpath='{.data.token}' | base64 -d` into a variable. Register it in the gateway as a bearer credential (URL `http://fx-mcp:3000/mcp`).
  - NetworkPolicy proof used two curl pods (labelled and unlabelled) plus a ~12s wait; unlabelled gave exit 7.
  - A big multi-file bash heredoc failed to parse in the Bash tool; use the Write tool for several files.
  - The Makefile Python patch inserted a literal `\n`; check `cat -A` on Makefile recipe lines after scripted edits.
  - Rotating a token Secret needs `kubectl rollout restart` (env var), noted in ADR 010.
- **Files the next task needs:** `docs/PLAN.md` (Phase 4, line 54), `services/fx-mcp/` (template), `charts/upstreams/` (add a `notes:` block + templates), `Makefile`, `scripts/secrets.sh` only if notes needs a token, `docs/decisions/007-tool-naming.md` for the collision scheme.
