# Explain: services/woo-mcp/src/tools.ts

Status: service done (c45cce0). The image, chart and NetworkPolicy are **not built yet** (Phase 2b). Section 3 says what is planned vs real.

## 1. What and why
`tools.ts` registers the five MCP tools (`list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`) on an `McpServer` and turns each call into one WooCommerce REST v3 request (`tools.ts:46`). It exists so the gateway, and through it chat and external clients, can run store operations without ever holding WordPress credentials or knowing the Woo API.

## 2. Request flow (target, once the gateway exists)
1. Client (chat agent or Claude Code) calls a tool on the gateway `/mcp` with a user API key. The gateway checks the key, picks the upstream and writes the audit row (Phase 3).
2. Gateway pod -> woo-mcp **Service** (ClusterIP :3000) -> woo-mcp pod. No Ingress. The NetworkPolicy lets only gateway pods in. (planned)
3. HTTP `POST /mcp`, JSON-RPC `tools/call` (`server.ts:38`). A fresh `McpServer` and a stateless transport are built per request (`server.ts:52`, `sessionIdGenerator: undefined`).
4. The SDK validates arguments against the zod schema (for example `tools.ts:42`, `:69`). Invalid input returns a tool error and **never reaches our handler**.
5. The handler runs inside `toolResult()` (`tools.ts:8`), which calls `woo.request(...)`.
6. `woo-client.ts:22` adds Basic auth (user plus Application Password). `:42` adds a timeout. The request goes `http://store-wordpress/wp-json/wc/v3/...` (Service `store-wordpress` -> WordPress pod -> MariaDB).
7. The Woo JSON is trimmed (`tools.ts:22`, `:26`) and returned as one text content block. The reply is plain JSON because `enableJsonResponse: true`, not SSE.

## 3. Kubernetes objects
**Real today:** the `store-wordpress` Service, the `woo-api` Secret (`username` from `scripts/secrets.sh`, `password` written by the setup Job), and the MariaDB and wp-content PVCs. woo-mcp touches none of the PVCs; it only speaks HTTP.
**Planned in 2b (check the chart when it lands):**
- Deployment env `WOO_URL`, `WOO_USER` and `WOO_APP_PASSWORD` (`secretKeyRef` to `woo-api`). A missing password leaves the pod in CreateContainerConfigError until the Job fills it.
- Liveness `/healthz` never calls Woo (`server.ts:64`), so a Woo outage doesn't restart-loop us. Readiness `/readyz` calls Woo (`:65`), so the pod leaves the Service when Woo or the credentials are bad.
- Requests and limits, non-root, read-only rootfs.
- NetworkPolicy ingress only from `app.kubernetes.io/name=gateway` on port 3000.
- Open question for ADR 005: whether k3s's policy controller blocks kubelet probes.

## 4. Failure modes
| Failure | Handling |
|---|---|
| Bad arguments (price "twelve", status "shipped", id -1) | zod rejects; tool error; no Woo call (tests in `tools.test.ts`) |
| Woo returns 4xx/5xx | `WooError` "WooCommerce returned 404: Invalid ID." -> `isError` (`tools.ts:14`) |
| Woo down or DNS failure | `WooError` "Could not reach WooCommerce" -> `isError` |
| Woo slow | `AbortSignal.timeout` (10s default) -> "timed out after Nms" |
| Unexpected bug (e.g. Woo returns non-array) | generic message, no internals (`tools.ts:14`). **It is not logged**, see section 7 |
| Pod restart | stateless, so nothing to lose and no session to re-establish |
| Woo unready | `/readyz` 503; pod removed from endpoints, not restarted |

## 5. Security
- **Trusted:** the caller is in-cluster and is the gateway (NetworkPolicy, planned). The gateway authenticates users; woo-mcp does **no auth of its own**.
- **Not trusted:** tool arguments (zod). Woo response text is passed through only as a `WooError` message, never raw payloads.
- **Credential:** Application Password for the WP user `woo-mcp`, stored in Secret `woo-api`, read into env at pod start, sent only over in-cluster HTTP to `store-wordpress`. It never goes to the gateway, browser or LLM. Over plain HTTP it is only base64, so the safety is the cluster network, not encryption.
- Blast radius: that password can do anything the WP user can. The tools are a narrow API, but the credential is wider than the tools.
- Responses are trimmed, so customer email, address and phone are not returned (only the name).

## 6. Ten likely questions
1. **Why REST + Application Password, not WP-CLI or direct DB?** REST is a stable versioned contract and runs Woo logic (stock, hooks, emails). The password is revocable and tied to one user. WP-CLI means exec rights into the WordPress pod. A direct DB write skips business logic and couples us to the schema.
2. **Why a separate service instead of tools inside the gateway?** The assignment requires it. It also keeps the Woo credential out of the gateway and lets woo-mcp scale, fail and be network-restricted on its own.
3. **Why stateless Streamable HTTP?** Our tools are plain request/response. There is no server-to-client push, so no session is needed. Restarts and multiple replicas then just work.
4. **Why `enableJsonResponse`?** One JSON reply per call is simpler than an SSE stream and passes cleanly through proxies. Cost: no streaming progress, which we don't use.
5. **Why trim responses?** A raw Woo order is many KB. LLM context costs money and degrades answers. It also drops personal data we don't need to expose.
6. **Why `dates_are_gmt=true`?** Without it Woo reads `after`/`before` in the store timezone, so "orders today" would be off by hours (`tools.ts:101`).
7. **Why do errors return `isError` instead of throwing?** A thrown error is a JSON-RPC protocol error; the LLM often doesn't see it. `isError` lets the model read the message and recover, and the process never crashes.
8. **Why does `/healthz` not check Woo?** Otherwise a Woo outage would kill woo-mcp pods and make recovery slower. Liveness asks "is the process stuck", readiness asks "can I serve".
9. **How is it isolated?** ClusterIP, no Ingress, and a NetworkPolicy from the gateway label only. Anyone *inside* the gateway pod can still call it.
10. **Why zod?** One schema gives runtime validation and the JSON Schema the LLM sees. The `.describe()` text is effectively our prompt for each argument.

## 7. Weak spots to be ready to defend
- **Swallowed errors:** `toolResult` (`tools.ts:12`) hides non-Woo errors and doesn't log them. Debugging a production bug would be blind. Fix: `console.error(err)` before the generic return.
- **No authorization in woo-mcp:** any caller that gets past the NetworkPolicy can call `update_order_status`. Per-role tool permissions belong in the gateway (stand-out item).
- **No pagination info:** `list_*` returns an array with no total, so the model can't tell if there is more than one page.
- **Unchecked casts:** `as Rec[]` (`tools.ts:55`, `:103`) trusts Woo's shape. A 200 with HTML (bad permalinks) causes a TypeError, which becomes the opaque generic message.
- **`z.iso.datetime()` accepts only `Z` by default**, so `+05:30` offsets are rejected. Safe, but the model may need one retry.
- **Credential is broader than the tools** (see section 5). A dedicated WP role with only product and order caps would be tighter.
- **Server-side status changes are irreversible-ish** (cancelled/refunded trigger Woo side effects, maybe emails). No confirmation step at this layer.
- Woo error text comes from an upstream and goes to an LLM, a small prompt-injection surface (THREAT_MODEL).
