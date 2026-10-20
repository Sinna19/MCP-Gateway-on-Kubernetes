# Phase 7 hardening: how to explain it

Covers: NetworkPolicies, rate limits, tool permissions per role, audit redaction, `CREDENTIALS_KEY` rotation, image digests.
ADRs: 019, 020, 022, 023. (File name is a slug because the requested title has `:` and `/`, which Windows paths refuse.)

## 1. What it does and why

Phase 7 makes the system safe to leave running: every pod can only talk to the pods it must (NetworkPolicies), no caller can hammer login, `/mcp` or the LLM without a ceiling (rate limits), members cannot run write tools (role rules), the audit log never stores secrets, the one encryption key can be replaced without losing data, and third-party images cannot change under us (digests).
Each control sits at one choke point (one policy per workload, one `Gateway` class, one `auditArgs`, one rotation transaction), so I can say where to look and the tests cover that one place.

## 2. Request flows (where each control bites)

**Dashboard login** (`POST app.localtest.me/api/auth/login`)
1. Browser to Traefik (Ingress) to the dashboard Service; nginx serves the SPA. The API call goes to the gateway Ingress path, to the `gateway` Service, to the pod on 8080. The gateway NetworkPolicy admits only Traefik (`charts/gateway/templates/networkpolicy.yaml` ingress block).
2. `req.ip` is the last `X-Forwarded-For` hop because `trust proxy = 1` (`services/gateway/src/app.ts:74`). Traefik overwrites a client-sent header and nobody else can reach the pod, so it cannot be forged.
3. `src/api/auth.ts:32` parses the body and lowercases the email. `:39` takes an IP token, `:41` an email token, before the slow password check. Over a limit: 429 + `Retry-After` (`:35-38`). An email refusal refunds the IP token (`:44`).
4. Unknown email still verifies a dummy hash (`:15`, `:49`) so timing does not reveal who exists. Success resets the email bucket, refunds the IP token (`:56-57`).

**MCP tool call** (client to `app.localtest.me/mcp`, `tools/call`)
1. Traefik to gateway pod. `authenticate` (`src/mcp-endpoint.ts:82`) hashes the Bearer key and checks Postgres on every request; revoked or disabled gets 401. Only after that does `express.json` parse the body (`:138`), capped at 1 MB.
2. `handle` (`:95`): the session must belong to the same key (`:102`, else 404). Each `tools/call` in the body takes one token from the key's bucket (`:104-111`, default 60/min). Over: HTTP 429 + `Retry-After` + JSON-RPC `-32000`.
3. `initialize` with no session: refused if the key already has `sessionsPerKey` (10) open sessions (`:116-122`). Nobody is evicted.
4. SDK transport calls `gateway.callTool` (`src/gateway.ts:50`): split `slug__tool`, `restrictedFor(user)` reads the role from Postgres (`:34-41`), restricted gives `McpError InvalidParams` (`:58`). Otherwise `backend.callTool` makes an MCP call to the upstream Service (woo-mcp, fx, notes), which the upstream's NetworkPolicy only lets the gateway reach. woo-mcp then calls WordPress on port 80 (woo-mcp egress policy allows only WordPress), WordPress calls MariaDB 3306.
5. `finally` writes the audit row (`:79-81`) through `auditArgs` (`src/audit-args.ts:29`): redact keys, 2 KB cap.

**Chat** (`POST /api/chat`): cookie auth, then 503 if no LLM, body validation, busy check, then `takeChatTurn` (`src/chat/daily-cap.ts:12`) as the agent's `beforeTurn` hook, then the LLM call (public 443 egress) and tool calls through the same `callTool` (so the same role check and audit, `source=chat`).

**Rotation** (`make rotate-key`): laptop runs `scripts/rotate-credentials-key.sh`, which uses kubectl only. Job pod reads two key files and talks to Postgres 5432 (`rotate-networkpolicy.yaml`); nothing else.

## 3. Kubernetes objects and fields that matter

| Object | Field | Why |
|---|---|---|
| `default-deny-ingress` (`charts/platform/templates/default-deny-ingress.yaml`) | `podSelector: {}`, `policyTypes: [Ingress]`, no rules | Every pod in the namespace accepts nothing unless another policy names it. Policies are additive allow-lists. |
| `gateway` policy | `ingress.from` namespace+pod selector (Traefik) on port 8080 | Only the ingress controller reaches the gateway. This is what makes `trust proxy = 1` safe. |
| same | `egress`: DNS 53, `gateway-postgres` 5432, woo/fx/notes on `global.network.upstreamPort`, `ipBlock 0.0.0.0/0 except privateRanges` on 443 | Gateway needs the DB, the upstreams, and public HTTPS (LLM, external upstreams). The `except` list is the same ranges as `src/url-guard.ts`, so a registered URL pointing at the API server or a metadata endpoint is blocked a second time. |
| `woo-mcp-egress` | DNS + `app.kubernetes.io/name: wordpress` port 80 | woo-mcp can only reach the store. |
| `store-wordpress` | ingress Traefik + woo-mcp on 80; egress DNS, mariadb 3306, public 443 | Browser and woo-mcp in; DB and plugin downloads out. |
| `gateway-postgres-allow-gateway` | `from` gateway and `gateway-rotate-key` pods, 5432 | Only DB clients we own. |
| `gateway-rotate-key` | `ingress: []`, egress DNS + Postgres only | The Job can do nothing but rewrite the table. Its label differs from `gateway` on purpose, or the gateway Service would select the Job pod. |
| Gateway Deployment (`charts/gateway/templates/deployment.yaml`) | `replicas: 1`, `automountServiceAccountToken: false`, `runAsNonRoot`, `readOnlyRootFilesystem`, `drop ALL`, startup/liveness/readiness (`/healthz`, `/readyz`) | One replica because sessions and limiters are in memory. Readiness checks the DB only, so an upstream outage does not pull the gateway out of its Service. No SA token: the gateway never calls the Kubernetes API. |
| same | env `LOGIN_LIMIT_*`, `MCP_*`, `CHAT_DAILY_CAP` from `values.yaml` `limits:` | Limits are config, not code. Bad values fail at start (`src/config.ts`). |
| Secret `gateway-app` | key `credentials-key` (32 bytes base64) | The AES-256-GCM key for `upstream_servers.credential_enc`. |
| Secrets `gateway-key-old` / `gateway-key-new` | mounted as files `/keys/old`, `/keys/new` in the Job | Exist only during a rotation; deleted after every server is connected. |
| Images | `name:tag@sha256:<index digest>` in `charts/gateway/values.yaml`, `charts/store/values.yaml`, every Dockerfile `FROM` | Immutable content. Multi-arch index digest works on amd64 and arm64. |

Not covered by a policy: the store **setup Job** has open egress (it needs the Kubernetes API and a WooCommerce download); ADR 019 says so. Also Kubernetes NetworkPolicy on k3s (kube-router) *rejects* rather than drops, so a blocked connection shows "connection refused", not a timeout.

## 4. Failure modes and handling

| Failure | What happens |
|---|---|
| Brute-force login on one email | 6th attempt gets 429 for 15 min, even with the right password (`auth.ts:42`). Side effect: anyone can lock a known email out. Accepted, expires by itself. |
| Many logins from one IP | 30 per 15 min per IP, then 429. Success refunds, so shared k3d IP does not lock everyone. |
| Spoofed `X-Forwarded-For` | Ignored: Traefik overwrites it; proven with 32 spoofed attempts still hitting 429 (ADR 020). |
| Runaway MCP client | 61st `tools/call` in a minute gets 429; unknown tool names count too. |
| Client opens many sessions | 11th `initialize` gets 429; half-open sessions are swept after 60 s (`mcp-endpoint.ts:150-157`). |
| Chat spend | 201st turn that day gets 429 with seconds to UTC midnight. Counter is in Postgres, atomic conditional upsert (`daily-cap.ts:14-20`), so restart or two tabs cannot exceed it. |
| Member calls a restricted tool | `McpError` -32602 "tool not permitted for your role", audit row outcome `error`, nothing sent upstream. In chat it becomes a tool message. |
| Role change or key revoke with an open session | Role is read from the DB per request, so it applies at once; revoke/disable also closes the sessions (ADR 020). |
| Audit args contain a secret key or huge object | Redacted by key name, depth cap 10, over 2 KB stores `{_truncated:true,bytes}`; odd args (BigInt, cycle) store `{_unauditable:true}`; audit failure never fails the call (`gateway.ts:90-108`). |
| Rotation: a row does not decrypt | Exception, `ROLLBACK`, nothing changes; error names the slug only. |
| Rotation: Job `ECONNREFUSED` to Postgres (policy sync race) | `waitForDb` retries `SELECT 1` 15x2 s; the rotation itself is never retried (`rotate-key.ts:57`). |
| Rotation: Job failed | Rolled back. Trap scales gateway back to 1 on the old key, deletes temp Secrets. |
| Rotation: Job timed out | Unknown whether it committed. Script deletes the Job, waits for the pod to vanish, keeps gateway at 0 and both Secrets, prints recovery. Use `prefixes` to compare IV prefixes with the "before" list: changed means DB is on the new key, run `finish`. |
| Rotation: committed but swap of `gateway-app` fails | Trap retries once; if it fails again the gateway stays at 0 and prints `finish`. Starting it would read new-key data with the old key. |
| Rotation: servers not connected after swap | Both backup Secrets are kept; read gateway logs. |
| Leftover `gateway-key-*` Secret on next run | Script refuses and tells you which recovery case applies. |
| Digest bump forgotten | Image stays pinned and unpatched. Manual recurring task. |

## 5. Security: trusted and not

- **Trusted**: Traefik (sets client IP), the cluster's NetworkPolicy enforcement (kube-router), admins (can register upstreams, set tool rules), the gateway process (holds the key in memory).
- **Not trusted**: every client request body, tool names/args, upstream tool descriptions and results (ADR 018), LLM output, registered upstream URLs (url-guard + egress `except` list), the `X-Forwarded-For` value past the last hop.
- **Where credentials live**: API keys as SHA-256 hashes; passwords hashed (`passwords.ts`); upstream credentials AES-256-GCM in `credential_enc` with the slug as AAD (a ciphertext cannot be moved to another server row); `CREDENTIALS_KEY` in Secret `gateway-app`; during rotation the keys go through temp files (`umask 077`, removed on EXIT) and `kubectl patch --patch-file`, never argv or env; the rotation Job reads them as mounted files.
- **Audit args** can hold Woo customer data (names, emails in `create_product` or order updates). Redaction is key-name based, so PII under a harmless key is stored. Admins see all rows, members their own.

## 6. Ten likely questions

1. **Why default-deny ingress but not default-deny egress?** The store setup Job must reach the Kubernetes API (to write the `woo-api` Secret) and download WooCommerce; allowing the API server by ipBlock is fragile. So that one Job is open, and every long-running workload has its own egress policy. Honest gap: a new workload added later has open egress until someone writes a policy.
2. **Why ports in policies are container ports, not Service ports?** kube-router evaluates after Service translation, so the pod's port is what it sees. Hence `upstreamPort` is one shared value.
3. **Why allow `0.0.0.0/0 except private ranges` on 443 for the gateway?** The LLM and any external upstream are on the public internet and have no stable IP. Excluding private ranges blocks the API server, other pods and cloud metadata. The weakness is that a compromised gateway could send data to any public HTTPS host.
4. **Why write your own rate limiter instead of `express-rate-limit`?** 40 lines I can test with a fake clock, and I need refund/reset semantics (successful login gives its IP token back). Trade-off: it is in memory, so one replica only; multi-replica would need Redis or Postgres.
5. **Why is the chat cap in Postgres but the others in memory?** A spend cap must survive a restart and two tabs must not both take the last turn; one conditional `INSERT ... ON CONFLICT ... WHERE count < cap` is both the counter and the lock. Login and `/mcp` windows are short-lived and resetting on restart is harmless.
6. **Why fixed window, not token bucket or sliding window?** Simplest to explain and test. Downside: up to 2x burst across a window boundary. Fine for abuse protection, not for exact quotas.
7. **Why enforce tool permissions in `Gateway` and not in the `/mcp` handler or the dashboard?** Both `/mcp` and the chat agent call `listTools` and `callTool`, so one check covers both and a new entry point cannot forget it. The dashboard checkbox is only the editor for the rules.
8. **Why is a tool with no rule open to members?** Default-open is simple and woo's two write tools are seeded as admin-only in three places (migration 006, bootstrap, register script). The safer default-closed needs a "new, unreviewed" UI state, deferred. I should say it is a known gap.
9. **Why redact by key name, not by value pattern?** Values are arbitrary (a product description, an order note); I cannot know what is secret. Key names like `password`, `token`, `key` are how secrets are labelled in practice. Over-redacting (`author`, `keyword`) is deliberately the safe direction. Under-redaction: a secret in a free-text field is stored.
10. **Why a one-off Job and scale-to-zero for rotation, and why not support two keys at once?** The Job runs inside the cluster where Postgres is reachable only by policy, with keys as mounted files, in one transaction with verify-before-commit. The gateway is stopped so nothing can save a credential with the old key between commit and Secret swap. Dual-key (try new, fall back to old) would remove downtime (~30 s) but adds a code path in the one place that handles secrets.
    Bonus: **Why digests and not just pinned tags?** A tag is mutable; the registry owner can repoint it. A digest names exact bytes. Cost: no automatic security patches.

## 7. Weak spots to be ready to defend

- **Egress is wide on 443** for the gateway and WordPress. A compromised pod can exfiltrate to any public host. Mitigated by non-root, read-only FS, no SA token, but not eliminated.
- **Setup Job has no egress policy** and the namespace has no default-deny egress (ADR 019).
- **Limits are per process.** Scaling the gateway beyond one replica silently multiplies every limit; sessions would also break. It is a documented single-replica design (ADR 006).
- **Per-email lockout is a DoS lever** (anyone can lock `admin@...` for 15 min). No CAPTCHA, no alerting.
- **429 and 401 `/mcp` requests are not audited**; abuse leaves no row (listed in REHEARSAL follow-ups).
- **Session cap can overshoot** under truly parallel `initialize` (race by design, ADR 020).
- **A chat confirm with unknown id or bad history still spends a turn** (cap runs before those checks).
- **Tool rules default-open**, and a renamed upstream tool loses its rule until an admin re-marks it.
- **Redaction is key-name only** and audit args may contain customer PII.
- **Audit writes are best effort** (ADR 009): a Postgres hiccup loses a row, the call still succeeds.
- **Rotation causes ~30 s downtime** and cuts open sessions. Timeout path needs a human. The keys exist as plain Kubernetes Secrets (base64, not encrypted unless etcd encryption is on). On Windows `chmod` is ignored in Git Bash, so temp-file privacy relies on the user-profile ACL.
- **Digest pinning is manual.** Our own images use a git-tree-hash tag, not a digest; fine for local k3d (`IfNotPresent`, imported), but on a registry I would want digests there too.
- **Known flaky test**: `test/mcp-endpoint.test.ts` fails a different case on some runs (HANDOFF). Fix before the final DoD, and do not be surprised if it flakes on camera.
