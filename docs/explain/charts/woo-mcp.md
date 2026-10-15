# charts/woo-mcp (with the service it runs)

Files: `charts/woo-mcp/{values.yaml, templates/deployment.yaml, service.yaml, networkpolicy.yaml, _helpers.tpl}`.
Service code: `services/woo-mcp/src/{server,tools,woo-client}.ts`.

## 1. What it is and why
woo-mcp is a small MCP server that turns five tools (list/create products, list/get/update orders) into
WooCommerce REST calls. The chart runs it as one pod that only the gateway may reach, because it holds a
credential that can change the store.

## 2. Request flow (gateway -> store and back)
1. Gateway pod sends an HTTP POST to `http://woo-mcp:3000/mcp` with a JSON-RPC message
   (`tools/call`, e.g. `list_orders`) and `Accept: application/json, text/event-stream`.
2. CoreDNS resolves `woo-mcp` to the ClusterIP (`templates/service.yaml`, type ClusterIP, no Ingress).
3. kube-proxy rewrites the ClusterIP to the pod IP. The NetworkPolicy
   (`templates/networkpolicy.yaml:11-22`) lets the packet in only if the source pod has label
   `app.kubernetes.io/name=gateway`, TCP 3000.
4. `server.ts:73` routes `/mcp` to `handleMcp` (`server.ts:38-59`): parses the JSON body, builds a fresh
   McpServer + transport (stateless, `server.ts:37`, `enableJsonResponse` so the reply is plain JSON, not SSE).
5. `tools.ts` validates the arguments with zod (bad input becomes a tool error, Woo is never called), then calls
   `woo.list` / `woo.request`.
6. `woo-client.ts:34-76` (`send`) calls `http://store-wordpress/wp-json/wc/v3/...` with
   `Authorization: Basic base64(user:app-password)` and a timeout (`woo-client.ts:51`, 10 s).
7. The store Service -> WordPress pod -> Woo -> MariaDB answer comes back as JSON. `trimProduct`/`trimOrder`
   (`tools.ts`) cut it to a few fields; the result goes back as MCP `{content:[{type:"text",text:"<json>"}]}`.
8. Errors at any step return `isError: true` with a readable message, never an HTTP 500 or a crash.
Traefik is not involved: woo-mcp has no Ingress. (The storefront is the only thing behind Traefik.)

## 3. Kubernetes objects and the fields that matter
- **Deployment** `deployment.yaml`
  - `replicas: 1` (line 9): stateless, so it could scale; one is enough for the demo.
  - `runAsNonRoot` + uid 1000 (19-22), `readOnlyRootFilesystem`, drop ALL caps, no privilege escalation (27-31):
    the app only listens on port 3000 and writes nothing, so it needs no privileges.
  - `imagePullPolicy: IfNotPresent` (26): k3d has the image from `k3d image import`; no registry.
  - Image tag (25) is the git tree hash of `services/woo-mcp`, set by `make deploy` (`Makefile`).
  - `WOO_USER` / `WOO_APP_PASSWORD` via `secretKeyRef` on Secret `woo-api` (40-50). Never in values or ConfigMaps.
    The `password` key does not exist until the store setup Job adds it, so the pod waits in
    `CreateContainerConfigError`. That ordering is free; no init container.
  - **livenessProbe** `/healthz` (52-57): process is up, does not touch WordPress. A store outage must not restart us.
  - **readinessProbe** `/readyz` (59-64): does a real call to Woo with our credentials (`server.ts:65-70`). While
    the store is down the pod leaves the Service. `timeoutSeconds: 12` is above the client's 10 s timeout.
  - `resources` (65-66, values 18-24): small requests, hard limits, so a bug cannot starve the node.
- **Service** `service.yaml`: ClusterIP, port 3000 -> named port `http`. Only reachable in-cluster.
- **NetworkPolicy** `networkpolicy.yaml`: selects woo-mcp pods; `policyTypes: [Ingress]` means "deny all
  ingress except the list". Allowed source label comes from `values.yaml:15-16`. Egress is not restricted.
- **Secret** `woo-api`: created by `scripts/secrets.sh:48` (username `woo-mcp`), password added by the setup Job
  (`charts/store/files/setup.sh:110`, ADR 004).
- **PVC**: none. woo-mcp stores nothing. (MariaDB and wp-content have PVCs in the store chart.)

## 4. Failure modes
| What fails | What happens | Where |
|---|---|---|
| Store down / DNS fails | tool returns `isError` "Could not reach WooCommerce"; `/readyz` 503, pod leaves Service | `woo-client.ts:53-58`, `server.ts:69` |
| Store slow | aborted after 10 s, "timed out after 10000ms" | `woo-client.ts:51,54-55` |
| Woo returns 4xx/5xx | "WooCommerce returned 404: Invalid ID." (Woo's message passed through) | `woo-client.ts:69-72` |
| 200 with HTML (bad permalinks) | "unexpected non-JSON response" | `woo-client.ts:74` |
| Bad tool arguments | zod rejects, tool error, Woo not called | `tools.ts` schemas |
| Bug in our code | generic message to caller, real error `console.error`'d | `tools.ts` `toolResult` |
| Malformed/huge JSON-RPC body | 400, or body > 1 MB cut off | `server.ts:9-31,47` |
| Password key missing | pod stuck `CreateContainerConfigError` until the Job finishes | `deployment.yaml:45` |
| Wrong/revoked app password | Woo 401 -> tool error; `/readyz` 503 (pod NotReady, not restarted) | `server.ts:65` |
| Pod crashes | Deployment restarts it; stateless, nothing lost | liveness |

## 5. Security
- **Trusted:** the gateway (only caller allowed by the NetworkPolicy), WordPress, the cluster network inside the namespace.
- **Not trusted:** tool arguments (zod-validated), Woo responses (parsed defensively), the LLM that sits behind the gateway.
- **Credential:** one Application Password for WordPress user `woo-mcp`, role `shop_manager` (`setup.sh:88`),
  not admin. It lives in Secret `woo-api`, is injected as an env var, and travels as a Basic auth header over plain
  HTTP inside the cluster (Application Passwords only allow HTTP because `WP_ENVIRONMENT_TYPE=local`, ADR 005).
  Our code never prints the Authorization header. Unexpected errors are logged with `console.error`
  (`tools.ts` `toolResult`), which prints the error, not the request headers.
- **Auth on woo-mcp itself: none.** The NetworkPolicy is the only gate. Any pod labelled `gateway` is trusted
  (that label can be set by anyone who can create pods in the namespace).
- Hardening: non-root, read-only rootfs, no caps, ClusterIP only, no Ingress.

## 6. Ten interview questions
1. **Why REST + Application Password, not WP-CLI or the DB?** REST runs Woo's own logic and hooks, needs no `pods/exec`, and the credential is revocable. DB access skips business rules and exposes everything. (ADR 005)
2. **Why stateless Streamable HTTP, not sessions or stdio?** Streamable HTTP is the transport the gateway client speaks over the network; stateless means a restart loses nothing and no sticky routing. We don't need server-initiated messages.
3. **Why different liveness and readiness probes?** Liveness restarts the pod, so it must only check the process. Readiness only removes it from traffic, so it can depend on the store.
4. **How do you know the NetworkPolicy works?** A pod without the gateway label gets connection refused, a pod with it gets `ok`, from the same URL. DNS and the Service are proven by the control. (Exit 7, not a timeout: kube-router rejects. ADR 005)
5. **Why not an Ingress with auth?** Only the gateway should call it; an Ingress would expose a store-changing credential to the internet.
6. **Why `secretKeyRef` and not a ConfigMap or values?** Secrets are the Kubernetes object for credentials, kept out of git and `helm get values`. Caveat: base64, not encrypted, unless etcd encryption is on.
7. **What if the store restarts?** Readiness fails, traffic stops, liveness keeps the pod running, and it rejoins when Woo answers. No restart loop.
8. **Why one replica?** Nothing needs more for this scope; it is stateless, so raising `replicas` is safe. Single replica means a rollout has a short gap unless the new pod is ready first (Deployment default surge covers that).
9. **Why `shop_manager` and not admin?** Least privilege: it can manage products and orders but not install plugins or manage users.
10. **Why a tree-hash image tag?** It changes only when the service code changes, so Helm rolls the pod exactly then, and docs-only commits don't point at a never-imported image.

## 7. Weak spots to be ready for
- **No auth on woo-mcp itself.** The label is the only gate; any pod in the namespace can set it. Defence: NetworkPolicy plus RBAC on who creates pods; stronger option is a shared bearer token checked by woo-mcp (not built).
- **Egress is open.** A compromised woo-mcp could call anything. Easy follow-up: egress policy to `store-wordpress` and DNS only.
- **Plain HTTP and Basic auth in-cluster.** Acceptable inside one namespace on one node; on a multi-node VPS it crosses the node network. Mesh/TLS is the upgrade.
- **Same-namespace label match.** The policy has no `namespaceSelector`, so it only matches pods in `urumi`. That is intended, but say so.
- **`/readyz` makes a Woo call every 10 s** and a bad password makes the pod NotReady (not a clear alert).
- **Single replica, `latest` default tag in `values.yaml:4`** (always overridden by `make deploy`; a plain `helm install` would fail to pull).
- **No pagination beyond `page`/`per_page`**, and `trimOrder` returns the customer's name, which is personal data going to the LLM.
- **The deny test exits 7, not 28**, and a brand-new pod is refused for a few seconds even when labelled. Know why.
