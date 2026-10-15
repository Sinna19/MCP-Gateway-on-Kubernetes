# Gateway deployment (Phase 3c)

Status when written: pods run, `curl http://app.localtest.me/api/servers` gives 401 (HANDOFF). The Accept checks (revoked key, upstream down, Postgres pod deleted, SSE stays open) have NOT been run yet, so anything below about those behaviours comes from reading the code, not from a live test.

## 1. What it does and why

The gateway is one Node pod plus its own Postgres StatefulSet, exposed on `app.<domain>` for `/mcp` and `/api` only (`charts/gateway/templates/ingress.yaml:2,21`). It gives the team one authenticated MCP endpoint that routes tool calls to private upstreams such as woo-mcp, and it audits every call, so no client ever holds a store credential.

## 2. Request flow: `tools/call woo__list_products`

1. **Caller** (Claude Code, `Authorization: Bearer umk_...`) POSTs JSON-RPC to `http://app.localtest.me/mcp`. `*.localtest.me` resolves to 127.0.0.1, and the k3d load balancer forwards port 80 to Traefik.
2. **Ingress** `gateway` (`ingress.yaml:18-28`): host `app.localtest.me`, path prefix `/mcp`, to Service `gateway` port name `http`. `/healthz` and `/readyz` are not routed.
3. **Service** `gateway` (`service.yaml:9-16`): ClusterIP, selector `app.kubernetes.io/name: gateway`, port 8080 to named targetPort `http`. Only Ready pods receive traffic.
4. **Pod / Express** (`app.ts:47`): `express.json` (1 MB limit), then the MCP router.
5. **Auth** (`mcp-endpoint.ts:59-70`): parse Bearer, hash with SHA-256, and run one `UPDATE ... RETURNING` against Postgres (`api-keys.ts:34-44`). It is checked on every request, so a revoked key or disabled user is rejected at once. Failure gives 401.
6. **Session** (`mcp-endpoint.ts:72-89`): `initialize` creates a session and returns `Mcp-Session-Id`. Later requests carry the header. The session is bound to the key hash, and another key gets 404.
7. **Route** (`gateway.ts:33-41`): `splitName("woo__list_products")` gives slug `woo` and tool `list_products`.
8. **Upstream call** (`upstreams.ts:150-157`): uses the persistent MCP client for `woo` and sends `tools/call` over Streamable HTTP to `http://woo-mcp:3000/mcp`, with a 15 s timeout.
9. **Network** to woo-mcp: Service, then NetworkPolicy `woo-mcp-allow-gateway` (`charts/woo-mcp/templates/networkpolicy.yaml:15-21`) admits only pods labelled as the gateway. woo-mcp then calls WordPress Woo REST v3, which reads MariaDB. This hop is not re-read here (see the woo-mcp explain).
10. **Back**: the result returns to `Gateway.callTool`, whose `finally` inserts the audit row (`gateway.ts:57-59`), then goes through Express and Traefik to the caller.

At startup, `index.ts:7-14` runs: load config, migrate DB, bootstrap admin plus woo row, connect upstreams.

## 3. Kubernetes objects and the fields that matter

`charts/gateway/templates/deployment.yaml` (gateway):
- `replicas: 1` + `strategy: Recreate` (9-12): sessions and upstream connections live in memory (ADR 006). Recreate means the old pod stops before the new one starts. The cost is a short outage on every deploy.
- Pod `securityContext` (23-28): non-root uid 1000 (matches `USER node` in the Dockerfile), seccomp RuntimeDefault. `automountServiceAccountToken: false` (22): the gateway never talks to the Kubernetes API, so it gets no token.
- Container `securityContext` (51-55): no privilege escalation, read-only root filesystem, all capabilities dropped. `/tmp` is an emptyDir (105-110) because Node needs somewhere writable.
- initContainer `wait-for-db` (29-46): loops `pg_isready` against `gateway-postgres`, so the first start does not crashloop inside `migrate()`.
- Env (59-88): `DB_PASSWORD`, `CREDENTIALS_KEY`, `ADMIN_*` come from Secrets via `secretKeyRef`. `DATABASE_URL` is built from `$(DB_PASSWORD)`, which only expands if `DB_PASSWORD` is listed earlier (line 62 comment).
- `COOKIE_SECURE` (87-88) follows `global.ingress.tls`.
- Liveness `/healthz` (90-95): the process answers, and 3 failures at 20 s intervals restart it. Readiness `/readyz` (97-102) runs `SELECT 1` (`app.ts:41-46`), so DB down gives 503 and the pod leaves the Service but is not restarted. It deliberately never checks woo-mcp (comment, 96).
- Resources (`values.yaml:18-24`): requests 50m / 96Mi, limits 500m / 256Mi. Exceeding the memory limit gets the pod OOM-killed.

`postgres-statefulset.yaml`:
- StatefulSet with `volumeClaimTemplates` (80-88): PVC `data`, ReadWriteOnce, 1Gi, storageClass from values (`local-path`). The data survives pod deletion, because the new pod `gateway-postgres-0` re-attaches the same PVC.
- `PGDATA` is a subdirectory (51-52) because the volume root can contain `lost+found`.
- `fsGroup: 70` (24) lets the postgres user write the volume. `startupProbe` (54-58) allows up to 150 s for first-time initdb.
- Labels are `gateway-postgres`, never `gateway` (header comment), because the woo-mcp NetworkPolicy and the gateway Service select on `name=gateway`.

`postgres-networkpolicy.yaml`: pods labelled `gateway-postgres` accept TCP 5432 only from pods labelled `gateway` (12-21). Once a policy selects a pod, all other ingress is dropped.

Secrets (`scripts/secrets.sh:52-72`): `gateway-db/password`, `gateway-app/{credentials-key,admin-email,admin-password}`. Create-if-missing, so re-running never rotates a password the DB already initialised with. Names are printed, never values.

Image (`services/gateway/Dockerfile`): two-stage build, prod deps only, `migrations/` copied next to `dist/` (line 17), pinned `node:24.20.0-alpine`. The tag is the git tree hash of `services/gateway`, so an uncommitted change keeps the old image (rules file).

## 4. Failure modes

| Failure | What happens | Where |
|---|---|---|
| Postgres not up yet at first start | initContainer waits, no crashloop | `deployment.yaml:31-34` |
| Postgres goes down later | `/readyz` 503, pod removed from Service, not restarted. Auth fails closed (401), because key lookup needs the DB. Pool reconnects when the DB returns | `app.ts:41`, `api-keys.ts:36` |
| Postgres pod deleted | StatefulSet recreates it on the same PVC, so data is kept (to be proven in Accept) | `postgres-statefulset.yaml:80` |
| woo-mcp down | Ping fails within 5 s, status `unreachable`, its tools disappear, `toolsChanged` fires. Gateway stays Ready. Calls return an error result naming the server | `upstreams.ts:109-128,150-154` |
| woo-mcp hangs | 15 s timeout, then an `UpstreamError` text result (gateway timeout is longer than woo's 10 s so woo's clear error wins) | `upstreams.ts:156-161` |
| Upstream is slow on POST | `AbortSignal.timeout(call + 5 s)` covers the body too. Redirects are refused | `upstreams.ts:243-246` |
| Audit insert fails | Logged to stderr, the call result is still returned (audit lost) | `gateway.ts:68-70` |
| Bad/missing env | Process exits at startup with the names of the missing variables, and the pod crashloops visibly | `config.ts:16-19` |
| Gateway restarts | All sessions drop. SDK clients get 404 and re-initialize | ADR 006 |
| Slow client / slowloris | `requestTimeout` 15 s, `headersTimeout` 10 s | `index.ts:19-20` |
| Malformed or huge body | 413 / 400 JSON error | `app.ts:27-30` |
| SIGTERM (rollout) | Sessions closed, upstream clients closed, server closed, pool ended | `index.ts:25-31` |
| Two pods migrate at once | Postgres advisory lock | `db.ts:15` |

## 5. Security

- **Untrusted:** every client request, the API key, request bodies, upstream tool descriptions and results (they may be prompt-injection text; the chat agent must treat them as data).
- **Trusted:** the Secrets, Postgres, and the cluster network for the pod-to-pod hops, narrowed by NetworkPolicy.
- **API keys:** 32 random bytes, `umk_` prefix, stored as SHA-256 only (`api-keys.ts:13-20`), shown once. Never forwarded upstream. SHA-256 without a salt is fine for 256-bit random secrets, but would not be for passwords (those use `passwords.ts`).
- **Upstream credentials:** AES-256-GCM, with the slug as AAD so a ciphertext copied to another row fails to decrypt (`crypto.ts:3-23`). The key lives only in Secret `gateway-app` and arrives as an env var. Decryption happens in `connect()` (`upstreams.ts:168`), and the plaintext is held in the HTTP client's headers in memory.
- **DB password:** Secret, then `DB_PASSWORD` env, then expanded into `DATABASE_URL` inside the container. The manifest holds only `$(DB_PASSWORD)`, never the value.
- **Network:** woo-mcp and Postgres are ClusterIP + NetworkPolicy. Only `/mcp` and `/api` are on the Ingress. The woo row sent by bootstrap carries no auth header, so woo-mcp's protection is the NetworkPolicy alone.
- **Pod hardening:** non-root, read-only rootfs, caps dropped, seccomp, no service account token.
- **Sessions:** bound to key hash, 404 on mismatch (does not reveal that the session exists). Idle sweep after 30 minutes (`index.ts:22`).
- **Cookies/CSRF (/api):** `COOKIE_SECURE` follows TLS, SameSite=Strict plus JSON-only bodies (rules file).

## 6. Ten likely interview questions

1. **Why one replica? Isn't that a single point of failure?** Yes. Sessions and upstream connections are in memory, so that is the price of pushing `list_changed` (ADR 006). Kubernetes restarts the pod and clients re-initialize. To scale out I would need sticky sessions or a shared store plus a rethink of who owns upstream connections.
2. **Why `Recreate` and not `RollingUpdate`?** With in-memory sessions, two overlapping pods would split clients and double the upstream connections and health pings. The price is a few seconds of downtime per deploy.
3. **Why not Bitnami charts for Postgres?** The stack rule is official images and our own templates (CLAUDE.md). It means fewer hidden defaults to explain, but I own the backup, upgrade and tuning story.
4. **Why a StatefulSet and not a Deployment for Postgres?** Stable pod name and per-pod PVC via `volumeClaimTemplates`. For one replica a Deployment plus a PVC would also work, but the StatefulSet is the conventional shape and makes scaling or restore semantics clearer.
5. **Why does `/readyz` check only the DB and not woo-mcp?** If readiness included woo-mcp, a woo outage would pull the gateway out of the Service, and every other upstream and the dashboard would go down too. Failure isolation is a requirement.
6. **Liveness vs readiness?** Liveness asks "should I restart this?". Readiness asks "should it get traffic?". DB down is a readiness failure because restarting the gateway does not fix Postgres.
7. **Where is the credential for woo stored, and what if the DB leaks?** Encrypted with AES-256-GCM, with the key only in a Kubernetes Secret. A DB-only leak yields ciphertext. A leak of both the DB and the Secret does not. API keys are only hashes.
8. **Why not Kubernetes Secrets for upstream credentials instead of encrypting in the DB?** The admin adds and rotates servers at runtime from the dashboard. Giving the gateway RBAC to write Secrets means a service account token and a bigger blast radius. Encrypting in the DB keeps the gateway with no Kubernetes API access.
9. **What stops a random pod from calling woo-mcp?** The NetworkPolicy on woo-mcp, which allows only gateway-labelled pods. This depends on the CNI enforcing it (k3s does, via kube-router), and on label integrity: anyone who can create pods in the namespace can copy the label.
10. **How do you handle secrets in git and Helm?** Templates and values contain Secret names only. `scripts/secrets.sh` creates them out-of-band and never prints values (ADR 002). `helm template` never shows a password.

Bonus "why not X": *Why not Ingress for woo-mcp?* It would put store write access on the internet. *Why not an Ingress annotation to expose `/healthz`?* Nothing outside the cluster needs it. *Why Express and the low-level `Server`?* ADR 006.

## 7. Weak spots to be ready to defend

1. **No NetworkPolicy on gateway pods themselves.** Anything in the cluster, including WordPress pods, can reach the gateway on 8080. It authenticates every call, but a default-deny plus allow-from-Traefik policy would be tighter. There is also no egress policy.
2. **Prod values have `tls: false`** (`deploy/values-prod.yaml:7`). Bearer keys and session cookies would cross the network in cleartext. Be ready to say TLS is the first production change, and `COOKIE_SECURE` already follows it.
3. **Audit is best-effort** (`gateway.ts:68-70`): a failed insert is logged and the call still succeeds. Availability over completeness. A compliance setting might require failing the call.
4. **`last_used_at` is an UPDATE on every request** (`api-keys.ts:36`): a DB write on the hot path. It is fine at this scale, but it is a write per request, and auth is down whenever the DB is down.
5. **Node keep-alive vs Traefik.** Node's default `keepAliveTimeout` is 5 s, shorter than a typical proxy idle timeout, which can produce rare 502s on reused connections. I have not set it or tested for it. Treat it as unverified.
6. **Long-lived `GET /mcp` (SSE) through Traefik is not yet proven.** The `timeout 90 curl -N` check is still pending in Accept. `requestTimeout` should not affect it (GET has no body), but only that test shows it.
7. **No `startupProbe` on the gateway.** Liveness starts at once. Migrations plus upstream connects take a few seconds, so a slow cluster could trigger a restart loop (3 x 20 s = 60 s margin). It has not been a problem so far.
8. **Postgres:** a single replica, no backups, no `readOnlyRootFilesystem` (it needs a writable data dir plus `/var/run/postgresql`), and 1Gi `local-path` data is lost if the node or PVC is lost. `helm uninstall` leaves the PVC, but deleting the namespace removes it.
9. **SIGTERM calls `server.closeAllConnections()`** (`index.ts:30`): in-flight tool calls are cut off immediately, and their audit rows may not be written.
10. **`CREDENTIALS_KEY` has no rotation story.** Changing it makes every stored credential undecryptable (it fails to connect, shown as unreachable). It would need a re-encrypt migration.
11. **Secrets in k3s are base64 in etcd, not encrypted at rest** unless enabled. Same for the VPS.
12. **The seeded woo upstream has no auth header.** The gateway to woo-mcp hop relies solely on the NetworkPolicy plus label trust.
