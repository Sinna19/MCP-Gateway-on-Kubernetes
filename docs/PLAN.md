# Build Plan

Two weeks. A working core beats an unfinished bonus. Each phase ends with acceptance checks that must pass before the next phase starts. Work one checkbox group per session (`/phase N task`), tick checks as they pass, and end each session with `/handoff`. Tiny checkbox groups may share one session; Phase 0 is one session.

| Phase | Days | Outcome |
|---|---|---|
| 0. Foundation | 1 | Repo, k3d cluster, Traefik, Makefile, empty umbrella chart deploys |
| 1. Store | 2 to 3 | Storefront checkout works, order visible in WP admin, data survives pod restart |
| 2. woo-mcp | 3 to 4 | Five tools work via MCP Inspector (port-forward), not reachable from outside |
| 3. Gateway core | 5 to 7 | Aggregated `/mcp` endpoint with API keys, routing, collisions, timeouts, audit |
| 4. Extra upstreams | 7 | fx-mcp and notes-mcp registered; cross-server prompt works |
| 5. Dashboard | 8 to 9 | Servers, members, keys, audit log UI for admin and member |
| 6. Chat agent | 10 | Tool loop in dashboard, calls attributed to logged-in user |
| 7. DoD run + hardening | 11 | `make dod` passes; full two-user flow rehearsed |
| 8. VPS (k3s) | 12 | Same charts on a VPS with values-prod.yaml, TLS optional |
| 9. Docs + demo | 13 to 14 | README, DESIGN, THREAT_MODEL, stand-out list, demo video |

Stretch, only once phase 9 is drafted: tool permissions per role (stand-out #2) and SSRF protection (#6). Both are small given this design.

---

## Phase 0: Foundation
- [x] Repo layout from CLAUDE.md, `.gitignore` (node_modules, .env*, *.tgz), README stub
- [x] `scripts/cluster-up.sh`: k3d cluster `urumi` with ports 80/443 mapped to the load balancer
- [x] `charts/platform` umbrella with empty subcharts; `deploy/values-local.yaml`, `deploy/values-prod.yaml`
- [x] Makefile targets: cluster-up, cluster-down, images, deploy, lint, test, dod. `lint` and `test` print only failures and a one-line summary (saves tokens on every run)
- [ ] Deploy the empty umbrella chart to the VPS with `values-prod.yaml` (once the VPS is rented; still week 1)
- **Accept:** `make cluster-up && make deploy` succeeds; `kubectl get ns urumi` exists; `make lint` clean.

## Phase 1: Store
- [x] MariaDB StatefulSet + PVC + Secret (created by script, not templated with a literal)
- [ ] WordPress Deployment + PVC for `wp-content`, Service, Ingress `shop.localtest.me`
- [ ] Setup Job (plain Job named setup-<release revision>, ttlSecondsAfterFinished: 600, idempotent; not a Helm hook) with WP-CLI: install WP, install + activate WooCommerce, enable COD, seed 3 products, create the integration user + Application Password, write it to Secret `woo-api` (needs a ServiceAccount with get/create/patch on that one Secret only)
- [ ] Probes + requests/limits on all of it
- **Accept:** checkout with COD at `http://shop.localtest.me`; order visible in WP admin; `kubectl delete pod` on WordPress and MariaDB, data still there; Job rerun is a no-op.

## Phase 2: woo-mcp
- [ ] TS service using the MCP SDK, Streamable HTTP at `/mcp`, `/healthz` and `/readyz`
- [ ] Tools with zod schemas and clear descriptions: `list_products`, `create_product`, `list_orders` (filter by date/status), `get_order`, `update_order_status`
- [ ] Reads Woo URL + app password from env (Secret). Errors become MCP tool errors, not crashes
- [ ] Chart: ClusterIP Service, no Ingress, NetworkPolicy ingress only from `app.kubernetes.io/name=gateway`
- [ ] ADR: why REST API + Application Passwords over WP-CLI or direct DB
- **Accept:** MCP Inspector via `kubectl port-forward` lists 5 tools; create product shows on storefront; a curl pod without the gateway label is blocked by the NetworkPolicy.

## Phase 3: Gateway core
- [ ] Postgres chart + migrations: users, api_keys (hash, prefix, revoked_at), upstream_servers (slug, url, enabled, encrypted credential, header name), audit_log
- [ ] Bootstrap admin from a Secret on first start; seed woo-mcp as the first registered server
- [ ] Upstream manager: one MCP client per enabled upstream, connect with timeout, cached tools, background health check every ~5s, status Connected / Unreachable / Disabled
- [ ] `/mcp` endpoint: bearer API key auth, `tools/list` aggregates `<slug>__<tool>`, `tools/call` routes, per-call timeout, audit in `finally`, `list_changed` on registry change
- [ ] REST API for dashboard: auth (session cookie), servers CRUD (admin), members + invites (admin), keys (own; admin can revoke any), audit query
- [ ] Credentials encrypted at rest; response serializers never include them (unit test asserts this)
- **Accept:** Claude Code connects with `claude mcp add --transport http urumi http://app.localtest.me/mcp --header "Authorization: Bearer umk_..."` and lists woo tools; revoked key gets 401; `kubectl delete pod` on woo-mcp leaves the endpoint working and the dashboard shows it Unreachable within one health interval (~5s).

## Phase 4: Extra upstreams
- [ ] `fx-mcp`: `convert_currency`, `list_rates` (static or cached rates), requires a bearer token (exercises upstream credentials)
- [ ] `notes-mcp`: `add_note`, `list_notes`, plus a tool whose name also exists on woo-mcp to demonstrate the collision scheme
- [ ] Both registered via the API (or seed), not hardcoded in the gateway
- **Accept:** a single prompt like "total today's orders and convert to EUR" uses woo and fx tools; both colliding tools appear with distinct prefixed names.

## Phase 5: Dashboard
- [ ] Login, role-aware nav
- [ ] Servers page: status badge, tools per server, add / edit / disable / delete (credential field write-only)
- [ ] Members page: invite, role, revoke keys; My Keys page: generate (show once), revoke
- [ ] Audit log: table with user, server, tool, time, duration, outcome, filters
- [ ] Served by nginx in-cluster; Ingress `app.localtest.me` routes `/api` and `/mcp` to gateway, `/` to dashboard
- **Accept:** a member cannot reach admin pages or admin API routes (API test, not just UI); credentials never appear in browser network tab.

## Phase 6: Chat agent
- [ ] Backend endpoint `/api/chat`: LLM call with tools from the user's view of the gateway, loop until no tool calls (max N steps), each call through the same `callTool(user, name, args)` used by `/mcp`, audit `source=chat`
- [ ] UI shows each tool call (name, args, result summary)
- [ ] Treat tool descriptions and results as untrusted text in the system prompt
- **Accept:** as user A, "create a product called X for 19.99" appears on storefront; after a manual order, "what orders came in today" returns it; audit shows user A.

## Phase 7: DoD run + hardening
- [ ] `scripts/dod-check.sh` automates what it can (key revoke rejects, disabled server tools gone, pod kill keeps others working, audit rows per user)
- [ ] Full manual rehearsal with users A and B, following the DoD in `docs/ASSIGNMENT.md`
- **Accept:** every DoD bullet demonstrated in one clean run on a fresh cluster.

## Phase 8: VPS (k3s)
- [ ] `deploy/values-prod.yaml`: real hosts, storage class, ingress class, optional cert-manager issuer, resource sizes
- [ ] Secrets created on the server via script, never committed
- [ ] Upgrade + rollback rehearsal: `helm upgrade`, `helm history`, `helm rollback`
- **Accept:** DoD flow works at the public hostname; README lists exactly what differs from local.

## Phase 9: Docs + demo
- [ ] README: local setup, VPS setup, place an order, connect an MCP client, use chat
- [ ] `docs/DESIGN.md` (architecture, aggregation, routing, failure handling, prod changes)
- [ ] `docs/THREAT_MODEL.md` (the four required questions)
- [ ] Stand-out items list with file pointers
- [ ] Demo script following the six required video sections; record
