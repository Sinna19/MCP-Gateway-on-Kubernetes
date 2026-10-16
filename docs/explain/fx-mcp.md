# fx-mcp (Phase 4)

Status when written: deployed and Ready, bearer check and NetworkPolicy verified by hand (HANDOFF). It is NOT registered in the gateway yet, so the "woo + fx in one prompt" Accept has not been run. The gateway-to-fx hop below is read from gateway code, not live-tested. I did not re-run tests for this document.

## 1. What it does and why

fx-mcp is a small MCP server with two tools, `convert_currency` and `list_rates`, backed by a fixed rate table. It exists as the second upstream, and the one that needs a credential, so the gateway's encrypted upstream-credential path is exercised for real and the demo can ask "total today's orders and convert to EUR" across two upstreams (`docs/decisions/010-fx-mcp.md:6`).

## 2. Request flow: `tools/call fx__convert_currency`

1. **Caller** sends JSON-RPC to the gateway at `http://app.localtest.me/mcp` with its own `umk_` key. The caller never sees the fx token.
2. **Gateway** authenticates, splits `fx__convert_currency` into slug `fx` and tool `convert_currency`, and uses its persistent MCP client for `fx` (see the gateway explain).
3. **Credential**: the gateway decrypts the stored credential and puts it in the `Authorization` header of every request to that upstream (`services/gateway/src/upstreams.ts:183,190`).
4. **Service** `fx-mcp` (`charts/upstreams/templates/fx-mcp-service.yaml:10-16`): ClusterIP, port 3000, named targetPort `http`. There is no Ingress, so nothing outside the cluster can address it.
5. **NetworkPolicy** `fx-mcp-allow-gateway` (`fx-mcp-networkpolicy.yaml:12-23`): only pods labelled `app.kubernetes.io/name=gateway`, TCP 3000, get in.
6. **Pod, Node http server** (`server.ts:69-83`): path `/mcp` goes to `handleMcp`.
7. **Auth** (`server.ts:42`, `auth.ts:7-10`): parse `Bearer <token>`, SHA-256 both sides, `timingSafeEqual`. Failure gives 401 with `WWW-Authenticate: Bearer`.
8. **Method check** (`server.ts:46`): not POST gives 405. This comes after auth, so unauthenticated callers learn nothing.
9. **Body** (`server.ts:11-34`): read up to 1 MB (413 beyond), then `JSON.parse` (400 if invalid).
10. **MCP handling** (`server.ts:58-66`): build a fresh `McpServer`, register tools, connect a fresh `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` (stateless) and `enableJsonResponse: true` (plain JSON, not an SSE stream). `handleRequest` runs the tool.
11. **Tool** (`tools.ts:21-44`): zod validates input (3-letter code, 0 < amount <= 1e12), then `convert()` in `rates.ts:28`. The result goes back as one text content block of JSON. An unknown currency throws, and `toolResult` turns it into `isError: true`.
12. **Back**: response to the gateway, which audits it and returns it to the caller. On `res.close` the transport and server are closed (`server.ts:61-64`).

Kubelet probes hit `/healthz` and `/readyz` directly with no token (`server.ts:73-74`).

## 3. Kubernetes objects and fields that matter

`charts/upstreams/templates/fx-mcp-deployment.yaml`:
- `{{- if .Values.fx }}` (1): the whole block renders only if `fx:` exists. `--set fx=null` removes every object, which is how notes-mcp can sit beside it.
- `replicas: 1` (10): stateless, so more replicas would work, but one is enough for a demo. No Ingress and no PDB.
- `automountServiceAccountToken: false` (20): it never calls the Kubernetes API, so no token is mounted.
- Pod `securityContext` (21-26): non-root uid 1000 (matches `USER node` in the Dockerfile), seccomp RuntimeDefault.
- Container `securityContext` (31-35): no privilege escalation, read-only root filesystem, drop ALL capabilities. No `/tmp` emptyDir is needed because the app writes no files.
- `image` with `required` (29): an empty tag fails at template time, so there is no accidental `:latest`. `make deploy` passes the git tree hash of `services/fx-mcp`.
- `FX_TOKEN` from `secretKeyRef` `fx-mcp-token` key `token` (42-46). Env vars are read once, so rotating needs `kubectl rollout restart deploy/fx-mcp` (`values.yaml:11-12`). If the Secret or key is missing, the pod sits in `CreateContainerConfigError` and never starts.
- `livenessProbe` `/healthz` every 20 s, `readinessProbe` `/readyz` every 10 s, timeout 3 s (48-59). Both only prove the process answers, because there is no backend to wait for (comment at 47).
- `resources` (`values.yaml:19-25`): requests 25m CPU / 48Mi, limits 200m / 128Mi. Exceeding the memory limit means OOMKill and a restart. Exceeding CPU only throttles.

`fx-mcp-service.yaml`: ClusterIP, selector by name label. Only Ready pods get traffic.

`fx-mcp-networkpolicy.yaml`: `policyTypes: [Ingress]` selects the fx pods, so everything not listed is dropped (comment at 3). It restricts ingress only. Egress from fx-mcp is unrestricted, which does not matter much because it makes no outbound calls.

Secret `fx-mcp-token` is created by `scripts/secrets.sh:66-74` (32 random bytes as hex, skipped if it exists). There is no PVC: fx-mcp has no state.

## 4. Failure modes

| What breaks | What happens | Where |
|---|---|---|
| `FX_TOKEN` empty or under 32 chars | Process throws at start, pod CrashLoops. It never serves with a weak check | `config.ts:10-12` |
| Secret missing | `CreateContainerConfigError`, visible in `kubectl describe pod` | Deployment 42-46 |
| No or wrong token | 401 + `WWW-Authenticate` | `server.ts:42-45` |
| GET or DELETE on `/mcp` | 405 (after auth) | `server.ts:46` |
| Body over 1 MB | 413, rest of the body drained | `server.ts:17-21,54` |
| Bad JSON | 400 | `server.ts:55` |
| Unknown or invalid currency | Invalid shape: zod error from the SDK. Valid shape but unsupported code (e.g. `ABC`): MCP tool error `isError: true`, not a crash | `tools.ts:5-9,12-18`, `rates.ts:18` |
| Slow or stalled client | `requestTimeout` 15 s, `headersTimeout` 10 s, so the socket is cut (slowloris) | `server.ts:85-86` |
| Unexpected throw in the handler | Logged, 500 if headers not yet sent | `server.ts:76-79` |
| Pod dies | Service stops routing (readiness fails), Deployment restarts it. No session state to lose, since it is stateless. The gateway's persistent client reconnects (gateway explain) | `server.ts:40` |
| Rotated token but gateway not updated | Gateway gets 401 from fx. Both sides must change | ADR 010 line 14 |

## 5. Security

- **Trusted**: the gateway (by NetworkPolicy label and by holding the token). Nothing else.
- **Not trusted**: every request body (size-capped, zod-validated), the headers (hash-compared), and any pod other than the gateway.
- **Where the credential lives**: generated by `secrets.sh`, stored in the Kubernetes Secret `fx-mcp-token`, injected as env `FX_TOKEN`. The same value is pasted into the gateway when fx is registered; there it is stored encrypted in Postgres and decrypted only to build the header (`upstreams.ts:183`). Users and the dashboard never receive it back.
- **How it travels**: plain HTTP inside the cluster, in the `Authorization` header, from the gateway pod to the fx pod. No TLS or mTLS in between.
- **Two layers**: NetworkPolicy (network) and bearer token (application). The ADR says the token is a second layer, not a replacement.
- **Comparison**: hash both with SHA-256 then `timingSafeEqual`, so lengths match, `timingSafeEqual` never throws, and timing does not show how much matched (`auth.ts:5-6`).
- **Container hardening**: non-root, read-only filesystem, no capabilities, no service account token.

## 6. Ten likely questions

1. **Why does fx-mcp need a token if the NetworkPolicy already blocks everyone but the gateway?** Defence in depth. A NetworkPolicy only works if the CNI enforces it, and it is a label match: any pod that can carry the gateway label gets in. The token also makes the gateway's encrypted-credential path real, which the assignment wants exercised.
2. **Why static rates and not a live API?** No internet, no API key, deterministic tests, nothing to fail mid-demo. The cost is that the data is fake, which is flagged in the tool description ("fixed demo rates") and the `as_of` field.
3. **Why stateless, a new McpServer per request?** No sessions to lose on a restart, and no sticky routing if it ever scaled. Cost: a little allocation per request, irrelevant for two tiny tools. The gateway is the stateful part (ADR 006).
4. **Why `enableJsonResponse: true`?** Each call is one request and one response, so plain JSON is simpler than opening an SSE stream. Streaming would only matter for long-running tools or server-initiated messages.
5. **Why hash before `timingSafeEqual`, why not `===`?** `===` can exit at the first differing byte. `timingSafeEqual` throws if lengths differ, so hashing makes both 32 bytes and also hides the token length.
6. **Why not mTLS or a service mesh instead of a bearer token?** It would be stronger (identity per pod, encryption), but it needs a mesh or cert-manager and is much more to run and explain for a two-week project. The gateway's design (one credential per upstream) also supports third-party upstreams that only take a header.
7. **Why not use a Kubernetes ServiceAccount token (TokenReview)?** It would remove the shared secret, but every upstream would need Kubernetes API access, and it would not work for upstreams outside the cluster. I chose the model that works for any upstream.
8. **How do you rotate the token?** Update the Secret, `kubectl rollout restart deploy/fx-mcp`, and update the credential in the gateway. Env vars are read at start, so there is a short window where they disagree. A mounted file could be re-read live, but I judged that unnecessary.
9. **What if the fx pod is compromised?** It holds only its own token and has no service account token, no writable filesystem, no capabilities, and no secrets for other services. Its NetworkPolicy does not restrict egress, so it could connect to other pods; the other upstreams' own policies and tokens are what stop it.
10. **How do you prove it is not reachable from outside?** `kubectl get svc fx-mcp` shows ClusterIP, no Ingress exists for it, and an unlabelled pod gets a connection failure (curl exit 7) while a gateway-labelled pod gets 401 without a token and 200 with one (HANDOFF).

## 7. Weak points to be ready to defend

- **Not registered in the gateway yet.** Until it is, "two upstreams working through the gateway" is unproven. Say so honestly.
- **Float rounding**: `Math.round(value * f) / f` (`rates.ts:22-25`) can misround cases like 1.005 to 2 decimals. Fine for a demo with fake rates, wrong for real money. Real money would use integers or a decimal library.
- **Shutdown**: on SIGTERM `server.close` waits for open connections (`index.ts:8-10`). The gateway's persistent client may hold a keep-alive socket, so the pod might wait for the 30 s grace period and then be killed. Harmless here, but it is not clean. I have not tested it.
- **PORT parsing**: `Number(env.PORT ?? 3000)` accepts garbage like `abc` as NaN (`config.ts:13`). Helm always sets a valid value, so it is low risk.
- **Token strength is only length-checked** (32 chars), not entropy. `secrets.sh` generates 64 hex characters, so the real value is fine.
- **No rate limit and no request logging** besides errors. Acceptable for an internal service behind the gateway, which audits calls.
- **Single replica, no PDB**: a restart means a brief unavailable window. The gateway's per-call timeout and error handling cover it.
- **Plain HTTP in-cluster**: the bearer token crosses the pod network unencrypted. Defended by the NetworkPolicy and single-node scope; production would want mTLS.
- **NetworkPolicy depends on the CNI.** k3s enforces it (the unlabelled-pod test shows it here), but a cluster whose CNI does not would silently ignore it.
- **Readiness equals liveness**, so the probes tell you nothing about correctness beyond "the process answers".
