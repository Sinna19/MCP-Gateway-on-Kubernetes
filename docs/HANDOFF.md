# Handoff

- **Done this session:** Phase 2a, the woo-mcp service and its tests.
  - c45cce0 feat(woo-mcp): `services/woo-mcp` with client, 5 tools, stateless Streamable HTTP `/mcp`, `/healthz`, `/readyz`. 28 vitest tests. `make test` and `make lint` now loop over `TS_SERVICES` in the Makefile.
  - `list_orders` always sends `dates_are_gmt=true` (after/before are read as UTC), covered by a test.
  - Verified: `make test` -> `test: ok`, `make lint` -> `lint: ok`. Local smoke with a dead Woo URL: `/healthz` 200, `/readyz` 503, curl `tools/list` shows 5 tools, `get_order` returns `isError:true` "Could not reach WooCommerce".
  - Plan was approved with the split: 2a service, 2b chart and cluster (plan file: `~/.claude/plans/2-generic-barto.md`).
- **In progress:** nothing in code. `docs/PLAN.md` is edited but NOT committed: Phase 2 items 1 to 3 ticked by me, plus your own GitHub Actions CI line in Phase 9. Commit it with the 2b work.
- **Next step:** `2b woo-mcp image, chart, NetworkPolicy, ADR 005, cluster accept`
  - Dockerfile (multi-stage `node:24-alpine`, `USER node`, port 3000), `make images` build + `k3d image import`.
  - `charts/woo-mcp`: Deployment (secretKeyRef `woo-api` `username`/`password`, `WOO_URL=http://store-wordpress`, probes, limits, non-root, read-only rootfs), ClusterIP Service, NetworkPolicy from `app.kubernetes.io/name=gateway`.
  - ADR 005 (REST + Application Password vs WP-CLI vs DB). If readiness fails after the NetworkPolicy, check whether k3s blocks kubelet probes, and record the result in the ADR.
  - Run the Phase 2 Accept checks and tick the last two boxes.
  - Service fixes first, each with a test (see `docs/explain/services/woo-mcp/src/tools.ts.md` section 7):
    1. `toolResult` (`tools.ts:12`): `console.error` the unexpected error before returning the generic message.
    2. `woo-client.ts`: a non-JSON response (e.g. HTML from bad permalinks) throws `WooError("unexpected non-JSON response")`, so no cast fails later.
    3. `list_products` / `list_orders` return `{ items, total, total_pages }` from Woo's `X-WP-Total` / `X-WP-TotalPages` headers (the client must expose headers).
- **Gotchas learned:**
  - Reading `node_modules` is denied by the harness, so SDK APIs were used from knowledge and confirmed by `tsc` and tests. Imports used: `server/mcp.js`, `server/streamableHttp.js`, `inMemory.js`, `client/streamableHttp.js`.
  - Big multi-file Bash heredocs failed with "unexpected EOF". Use the Write tool for files.
  - SDK 1.32.1 with zod 4.6.7 and `z.iso.datetime()` works. TypeScript pinned to 5.9.3 on purpose (latest 7.x untested with typescript-eslint).
  - Stateless mode uses `enableJsonResponse: true`, so replies are plain JSON, not SSE. The gateway client must send `Accept: application/json, text/event-stream`.
- **Files the next task needs:** CLAUDE.md, docs/PLAN.md (Phase 2), `.claude/rules/kubernetes.md`, `charts/woo-mcp/{Chart.yaml,values.yaml}`, `charts/store/templates/wordpress-deployment.yaml` (probe and securityContext pattern), `charts/store/templates/_helpers.tpl`, `Makefile` (`images`), `docs/decisions/000-template.md`.
