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

Stretch: none left. Tool permissions per role (stand-out #2) is now in phase 7 (7e); SSRF protection (#6) is done.

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
- [x] WordPress Deployment + PVC for `wp-content`, Service, Ingress `shop.localtest.me`
- [x] Setup Job (plain Job named setup-<release revision>, ttlSecondsAfterFinished: 600, idempotent; not a Helm hook) with WP-CLI: install WP, install + activate WooCommerce, enable COD, seed 3 products, create the integration user + Application Password, write it to Secret `woo-api` (needs a ServiceAccount with get/create/patch on that one Secret only)
- [x] Probes + requests/limits on all of it
- [x] **Accept:** checkout with COD at `http://shop.localtest.me`; order visible in WP admin; `kubectl delete pod` on WordPress and MariaDB, data still there; Job rerun is a no-op.

## Phase 2: woo-mcp
- [x] TS service using the MCP SDK, Streamable HTTP at `/mcp`, `/healthz` and `/readyz`
- [x] Tools with zod schemas and clear descriptions: `list_products`, `create_product`, `list_orders` (filter by date/status), `get_order`, `update_order_status`
- [x] Reads Woo URL + app password from env (Secret). Errors become MCP tool errors, not crashes
- [x] Chart: ClusterIP Service, no Ingress, NetworkPolicy ingress only from `app.kubernetes.io/name=gateway`
- [x] ADR: why REST API + Application Passwords over WP-CLI or direct DB
- **Accept:** MCP Inspector via `kubectl port-forward` lists 5 tools; create product shows on storefront; a curl pod without the gateway label is blocked by the NetworkPolicy.

## Phase 3: Gateway core (3a service + /mcp, 3b REST API, 3c Dockerfile + charts + Accept)
- [x] (3a: migrations done, 3c: Postgres chart) Postgres chart + migrations: users, api_keys (hash, prefix, revoked_at), upstream_servers (slug, url, enabled, encrypted credential, header name), audit_log
- [x] (3a: bootstrap code done, reads env; 3c: Secret + chart) Bootstrap admin from a Secret on first start; seed woo-mcp as the first registered server
- [x] (3a) Upstream manager: one MCP client per enabled upstream, connect with timeout, cached tools, background health check every ~5s, status Connected / Unreachable / Disabled
- [x] (3a) `/mcp` endpoint: bearer API key auth, `tools/list` aggregates `<slug>__<tool>`, `tools/call` routes, per-call timeout, audit in `finally`, `list_changed` on registry change
- [x] (3b) REST API for dashboard: auth (session cookie), servers CRUD (admin), members + invites (admin), keys (own; admin can revoke any), audit query
- [x] (3a: AES-GCM + manager done, 3b: serializers + test) Credentials encrypted at rest; response serializers never include them (unit test asserts this)
- **Accept:** Claude Code connects with `claude mcp add --transport http urumi http://app.localtest.me/mcp --header "Authorization: Bearer umk_..."` and lists woo tools; revoked key gets 401; `kubectl delete pod` on woo-mcp leaves the endpoint working and the dashboard shows it Unreachable within one health interval (~5s).

## Phase 4: Extra upstreams
- [x] `fx-mcp`: `convert_currency`, `list_rates` (static or cached rates), requires a bearer token (exercises upstream credentials). Service, chart in `charts/upstreams`, Secret `fx-mcp-token`, ADR 010; not yet registered in the gateway
- [x] `notes-mcp`: `add_note`, `list_notes`, plus a tool whose name also exists on woo-mcp to demonstrate the collision scheme. In-memory, `X-Notes-Key` header, colliding tool `list_products`, Secret `notes-mcp-key`, ADR 011; not yet registered in the gateway
- [x] Both registered via the API (or seed), not hardcoded in the gateway: `make register` (`scripts/register-upstreams.sh`), idempotent
- **Accept (PASS 2026-10-16, via MCP; re-run in dashboard chat in Phase 6):** a single prompt like "total today's orders and convert to EUR" uses woo and fx tools; both colliding tools appear with distinct prefixed names.

## Phase 5: Dashboard
- [x] Login, role-aware nav (ADR 012; dev via `npm --prefix apps/dashboard run dev`, proxy to app.localtest.me)
- [x] Servers page: status badge, tools per server, add / edit / disable / delete (credential field write-only)
- [x] Members page: invite, role, revoke keys; My Keys page: generate (show once), revoke
- [x] Audit log: table with user, server, tool, time, duration, outcome, filters
- [x] Served by nginx in-cluster; Ingress `app.localtest.me` routes `/api` and `/mcp` to gateway, `/` to dashboard
- [x] Ingress paths (`/api`, `/mcp`, `/`) come from values, not hardcoded in the template
- **Accept:** a member cannot reach admin pages or admin API routes (API test, not just UI); credentials never appear in browser network tab.

## Phase 6: Chat agent
- [x] (6a agent core in `services/gateway/src/chat/`, ADR 017/018; 6b route + chart + Secret, verified on the cluster) Backend endpoint `/api/chat`: LLM call with tools from the user's view of the gateway, loop until no tool calls (max N steps), each call through the same `callTool(user, name, args)` used by `/mcp`, audit `source=chat`
- [x] (6c) UI shows each tool call (name, args, result summary), plain text only
- [x] (6a) Treat tool descriptions and results as untrusted text in the system prompt
- [x] (6a) Cap the length of upstream tool descriptions (and nested schema descriptions) before they go into the LLM prompt
- [x] (6a) Confirm step for write tools: gateway-side read-only allowlist, server-stored pending call (UI card in 6c)
- [x] (6a) Max 8 steps, 20 s per LLM call, 55 s per request, one in-flight request per user
- [x] (6d, 2026-10-17, two members, plus injection and disabled-server checks) **Accept:** as user A, "create a product called X for 19.99" appears on storefront; after a manual order, "what orders came in today" returns it; audit shows user A.

## Phase 7: DoD run + hardening
Tasks 7a to 7g, one per session. Every task's Accept includes rerunning `scripts/dod-check.sh`.

### 7a DoD script
- [x] `scripts/dod-check.sh` automates what it can (key revoke rejects, disabled server tools gone, pod kill keeps others working, audit rows per user). make register leaves a disabled server disabled. Includes the disabled-server check.
- [x] Run it now as a baseline and report PASS/FAIL per check.
- **Accept:** script runs end to end; PASS/FAIL per check reported; `scripts/dod-check.sh` rerun shows the same result.

### 7b NetworkPolicies
Verify each with one blocked and one allowed curl (k3s rejects = exit 7; new pods need ~10s for policy sync).
- [x] MariaDB ingress only from WordPress + setup Job (pods labelled `app.kubernetes.io/name` = `wordpress` or `setup`)
- [x] woo-mcp egress only to store-wordpress + DNS (kube-system CoreDNS); check what phase 2 already has
- [x] Gateway ingress only from Traefik (kube-system)
- [x] Gateway egress: DNS, Postgres, the three upstream pods, TCP 443 to 0.0.0.0/0 except 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 (LLM host must stay reachable). Closes the SSRF gap in ADR 009.
- [x] fx-mcp and notes-mcp: ingress from gateway only, deny all egress except DNS
- [x] Dashboard: ingress from Traefik only, deny egress
- **Accept:** one blocked and one allowed curl per policy shown; `scripts/dod-check.sh` rerun.

### 7c Gateway limits and cleanup
In this order:
- [x] Revoking a key or disabling a user (or changing their role) closes its open MCP sessions/SSE streams (ADR 014)
- [x] Login rate limiting on `POST /api/auth/login` (per IP + per email, 429)
- [x] Per-key rate limit on `/mcp` tool calls (429, configurable in values) (stand-out #7)
- [x] Per-user daily chat cap (Postgres counter, 429, configurable in values)
- [x] `/mcp` session cap per API key; sweep sessions whose `initialize` failed
- [x] Periodic expired-session sweep (Postgres sessions table)
- [x] Throttle `api_keys.last_used_at` writes (at most once per minute per key)
- **Accept:** tests for each limit pass (`make test`); 429s shown with curl; `scripts/dod-check.sh` rerun.

### 7d Upstream and audit fixes
- [x] woo-mcp reads the Woo password from a mounted Secret file and re-reads it on a 401, so a regenerated password needs no restart
- [x] woo-mcp requires a bearer token, sent by the gateway as an upstream credential (hop token; was optional, now required)
- [x] fx-mcp and notes-mcp log one line on 401 (never the key)
- [x] Audit: record tool args (size-capped, never secrets) and declined chat confirms as rows
- **Accept:** regenerated Woo password works without restart; woo-mcp rejects calls without the token; audit shows args and declined confirms; `scripts/dod-check.sh` rerun.

### 7e Tool permissions per role (stand-out #2)
- [x] Admin sets per server/tool which roles may use it; restricted tools are hidden from `tools/list` and rejected if called directly (MCP and chat). Default: members get read tools only for woo (no order status changes or product creation).
- [x] ADR in `docs/decisions/`
- **Accept:** member cannot see or call `create_product` / `update_order_status` over MCP or chat; admin can; `scripts/dod-check.sh` rerun.

### 7f Key and image hygiene
- [x] CREDENTIALS_KEY rotation: script re-encrypts upstream credentials from the old key to the new one, documented in an ADR (023; `make rotate-key`)
- [x] Pin images by digest in values and Dockerfiles (ADR 023; verified on cluster, `make dod` 8/8)
- **Accept:** rotate on a running cluster, upstream calls still work; images pinned or the reason documented; `scripts/dod-check.sh` rerun.

### 7g Full manual rehearsal
- [x] Full manual rehearsal with users A and B on a fresh cluster, following the DoD in `docs/ASSIGNMENT.md`
- **Accept:** every DoD bullet demonstrated in one clean run on a fresh cluster; `scripts/dod-check.sh` rerun.

## Phase 8: VPS (k3s)
- [x] Review #7: `COOKIE_SECURE` and TLS in `values-prod.yaml`; add a `dod-check` assertion that prod renders Secure cookies (lint assertion + dod Secure check; the PASS line is proven on the VPS, session 2)
- [x] `deploy/values-prod.yaml`: real hosts, storage class, ingress class, optional cert-manager issuer, resource sizes
- [x] Secrets created on the server via script, never committed (`scripts/secrets.sh`, run by `make deploy`)
- [x] TLS: `global.ingress.annotations` for a cert-manager issuer, so `ingress.tls` has a Secret to use
- [x] VPS is single-node: setup Job and WordPress share an RWO PVC; say so in README (podAffinity if ever multi-node)
- [x] Upgrade + rollback rehearsal: `helm upgrade`, `helm history`, `helm rollback`
- [x] k3s `--secrets-encryption` so Secrets are encrypted at rest (evidence: `sudo k3s secrets-encrypt status` 2026-10-20, Enabled, AES-CBC, run by Ash on the node)
- [x] Postgres backups for the gateway database: CronJob + PVC + NetworkPolicy, `make backup-pull`, `make restore-check` PASS on k3d and VPS (ADR 025)
- [x] Session 2b done 2026-10-21: prod Let's Encrypt certs, `make dod` 9/9 on https with cookie Secure PASS, deny probes, login/chat/COD order/MCP Inspector verified (ADR 024)
- **Accept:** DoD flow works at the public hostname; README lists exactly what differs from local.

## Phase 9: Docs + demo

### A. Fixes (do first; CI and the demo depend on them)
- [x] Fix flaky `test/mcp-endpoint.test.ts`: find the root cause (timing, port, shared state or ordering), no retries or skips; proof: 20 consecutive green runs of the file and 5 of full `make test`
- [x] Guard hook polish: no false deny when a command ends in a backtick; file names like push-images.sh or ENV=prod as plain text inside read-only commands (grep, cat, git log/diff, ls) must not prompt; hook tests for both plus regression cases proving real ENV=prod deploy/delete/ssh commands still prompt
- [x] restore-check takes a fresh backup first (Job from the backup CronJob, wait, then compare the newest dump to the live DB)

### B. Docs
- [x] `docs/THREAT_MODEL.md`: the four required questions from ASSIGNMENT.md, plus known-risk lines, each with mitigation or "accepted, why": invite token in the URL (ADR 014); notes cross-user injection (ADR 011); own images pinned by tag, not digest; audit redaction never blocks the row write; upstream pagination and size caps; irreversible order status changes; prompt injection via Woo text
  - include: mu-plugin trusts missing X-Forwarded-For; safe only while store NetworkPolicy limits direct callers to woo-mcp + setup Job (ADR 024)
- [ ] Future-work section: admin one-time password reset link, disabled-login hint on the Members page, agent system-prompt line against guessed facts, audit rejected 429/401 /mcp requests; skipped bonuses with one-line reasons: multi-store, OAuth, hosted servers, many tools
- [ ] README local section: prerequisites (Windows + Git Bash + Docker Desktop, macOS/Linux notes), cluster-up, secrets, deploy, place an order, connect an MCP client, use the chat, known gotchas (fresh cluster = new admin password, Chrome autofill lockout and how to clear it)
- [ ] `docs/DESIGN.md` if missing: architecture, aggregation, routing, failure handling, local vs prod differences; link the ADRs instead of repeating them
- [ ] Stand-out items list with file pointers (#1 VPS, #2 tool permissions, #6 hardening, #7 rate limits, #9 upgrade/rollback, CI)

### C. CI (cut first if time is tight)
- [ ] `.github/workflows/ci.yml`: on push and PR run `make lint` and `make test`; no cluster, no secrets; pinned action versions; npm cache; pinned helm binary if lint needs one

### D. Demo
- [ ] Demo script following the six required video sections, run against the live https://app.20.197.63.44.sslip.io, with a pre-flight checklist (tunnel up, admin password from the gateway-app secret, clean browser profile so Chrome autofill can't lock you out); record
