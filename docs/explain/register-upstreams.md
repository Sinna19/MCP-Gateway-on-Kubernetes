# register-upstreams (Phase 4)

Status when written: read from code only. HANDOFF (commit 35af58b) records `make register` run twice (`created 201`, then `updated 200`), both ending `fx connected 2 / notes connected 3 / woo connected 5`, and a leak check (fx token 0, notes key 0 in gateway logs). I did not re-run the script or the tests for this document.

## 1. What it does and why

`scripts/register-upstreams.sh` (`make register`, Makefile:49-51) logs into the gateway as the bootstrap admin and registers `fx` and `notes` through the same `/api/servers` calls the dashboard will make, then waits until both show `connected`. It exists because the assignment says upstreams are registered through the gateway, not hardcoded in it: the credentials live in Kubernetes Secrets, the gateway stores them encrypted in Postgres, and this script is the glue that moves them from one to the other.

## 2. Flow, step by step

1. **Read secrets from the cluster** (`register-upstreams.sh:9-14`): `kubectl get secret ... -o jsonpath | base64 -d` for `gateway-app` (admin email and password), `fx-mcp-token` and `notes-mcp-key`. Needs your kubeconfig, so only a cluster admin can run it.
2. **Login** (`:23-24`): `POST http://app.localtest.me/api/auth/login` with `{email,password}` as a JSON body piped on stdin (`--data @-`). Hops: your machine, Docker port map, k3d loadbalancer, Traefik Ingress `gateway` (host `app.localtest.me`), Service, gateway pod. The handler (`services/gateway/src/api/auth.ts:24-35`) checks the password with a dummy hash for unknown users (same timing), and sets the `urumi_session` cookie (`httpOnly`, `sameSite: strict`, `secure` only if configured; `auth.ts:18`). curl keeps it in a cookie jar file (`-c "$JAR"`).
3. **List** (`:26`): `GET /api/servers` with the cookie. `requireUser`, then returns rows (`api/servers.ts:99-104`).
4. **Create or update** (`:29-47`), per slug:
   - slug not present: `POST /api/servers` with `{slug,url,enabled:true,auth}` (`servers.ts:106-118`). Zod validates (strict object, slug regex, URL check, forbidden headers, printable-ASCII secret). The credential is encrypted with AES-256-GCM, AAD = slug (`crypto.ts:9-15`, `servers.ts:82-85`), inserted, then `upstreams.reload()` connects.
   - slug present: `PATCH /api/servers/<slug>` with `{url,enabled:true,auth}` (`servers.ts:121-140`). `auth` present means replace the credential. This is what makes the script idempotent.
5. **Connect** (inside the gateway, `upstreams.ts:181-219`): decrypt the credential, build `{header_name: value}`, MCP `initialize` plus `tools/list` over Streamable HTTP to `http://fx-mcp:3000/mcp` or `http://notes-mcp:3000/mcp` (cluster DNS, ClusterIP Service). Before connecting, `url-guard.ts:31-37` resolves the host and refuses loopback or link-local (private ranges are allowed on purpose, ADR 009).
6. **Upstream** checks its own credential: fx wants `Authorization: Bearer <token>`, notes wants `X-Notes-Key`. NetworkPolicy lets only gateway pods reach them.
7. **Wait** (`:53-58`): up to 30 polls, one per second, of `GET /api/servers` until both are `connected`. Status can lag the write because connecting is async in the manager.
8. **Print and verify** (`:60-61`): `slug status toolcount` per server; exit 1 if not both connected.
9. **Cleanup** (`trap`, `:17-21`): `POST /api/auth/logout` (deletes the session row) and `rm` the cookie jar. Runs on any exit.

## 3. Kubernetes objects involved

The script itself creates none. It reads three Secrets in namespace `urumi` (override with `NS`), made by `scripts/secrets.sh`:
- `gateway-app`: admin email and password. Bootstrap admin is created from it on first start.
- `fx-mcp-token` (key `token`) and `notes-mcp-key` (key `key`): the same Secret is mounted into the upstream pod (what it expects) and read by this script (what the gateway will send). One source of truth.

Objects on the path: Ingress `gateway` (Traefik, `app.localtest.me`), the gateway Service and Deployment, Postgres StatefulSet (PVC, holds `upstream_servers`), Services `fx-mcp` and `notes-mcp` on port 3000, and their NetworkPolicies (gateway only). The probe, limit and PVC details are in `docs/explain/gateway-deployment.md`, `fx-mcp.md` and `notes-mcp.md`; they are not repeated here.

Note: registration lives in Postgres, so it survives pod restarts but not a database wipe. After a fresh `make deploy` you must run `make register` again.

## 4. Failure modes

| Failure | What happens |
|---|---|
| Secret missing | `kubectl` fails, `set -e` aborts before any request. |
| Gateway not ready or wrong `GATEWAY_URL` | login `curl -f` fails, script exits non-zero. Cleanup logout is `|| true`. |
| Wrong admin password | login returns 401, `-f` makes curl fail. |
| Validation error (bad URL, header) | POST/PATCH returns 400; `-w` captures the code, the `case` at `:47` prints "registration failed" and exits 1. The response body is discarded (`-o /dev/null`), so you do not see why. |
| Upstream unreachable or credential rejected | Write still succeeds (201/200). Status stays `unreachable`; the 30s wait then ends with exit 1 and the status table. |
| Re-run | PATCH, not duplicate-key error. Prints `updated`. |
| Server was disabled | PATCH forces `enabled:true` and the script says so (`:37-38`). |
| Script killed | `trap` runs on EXIT/INT/TERM-style exits; on a hard kill the cookie jar stays in the temp dir and the session expires on its own. |

## 5. Security

- **Trusted**: the operator's kubeconfig (can read all Secrets anyway), the Docker/loopback path to `app.localtest.me` (plain HTTP locally).
- **Not trusted**: nothing the script receives is executed; JSON is built by `jq --arg`, so secrets cannot break out of quotes.
- **Where secrets go**: Secret, then shell variables, then `jq` argv, then stdin of curl, then the gateway, where they are encrypted at rest (AES-256-GCM, key from `credentialsKey`, AAD = slug) and never returned: `serverView` exposes only `hasCredential` (`servers.ts:19-24`). Nothing is echoed. The HANDOFF leak check found 0 matches in gateway logs.
- **Caveat**: `jq --arg` puts the values in a process argument list for a moment. On a shared Linux host another user could see them via `ps`. Fine for a single-user dev machine; I should say so honestly.
- **Cookie and CSRF**: the session cookie is `SameSite=Strict`, and `requireJsonBody` rejects non-JSON POST/PATCH (`middleware.ts:8-14`). The script is not a browser so it is unaffected.
- **Admin-only**: POST/PATCH use `requireAdmin`. A member session gets 403.
- **Over HTTP locally**: the password and tokens cross loopback unencrypted. On the VPS they would go through TLS on the Ingress.

## 6. Ten interview questions

1. **Why a script, why not seed the gateway from Helm values?** Requirement: registered via API. A Helm seed would put upstream tokens in values or the chart and would bypass the admin API (and its validation, encryption, SSRF checks). The script proves the real path works. Trade-off: it is one more manual step.
2. **Why not a Kubernetes Job or Helm hook?** It would need the admin password in a pod, an image with curl and jq, and ordering logic with the gateway readiness. For two upstreams that is more moving parts than I can justify. A Job is the right answer if this had to be fully automatic in CI.
3. **Why log in as the admin and not use an API key?** `/api/servers` is a dashboard API guarded by session cookies. API keys (`umk_`) only authorise `/mcp`. Admin actions should need an admin session.
4. **How is it idempotent?** It lists servers and chooses POST or PATCH by slug. PATCH replaces url, enabled and credential with the Secret's current value, so rotating a Secret and re-running updates the gateway.
5. **Where is the upstream token stored and who can read it back?** Encrypted in Postgres; the API never returns it, only `hasCredential`. The key is in a Secret mounted in the gateway. A DB dump alone is useless; DB plus key is not.
6. **What does AAD = slug give you?** A ciphertext copied onto another row fails to decrypt, so someone with DB write access cannot make `notes` send fx's token to another URL without the key.
7. **Why poll for 30 seconds?** `reload()` returns after the connect attempt, but the status shown comes from the manager, and a slow pod start can make the first try fail; the periodic retry then connects it. Polling avoids reporting a false failure.
8. **Why not Secrets mounted straight into the gateway as env vars?** Then a credential change would need a redeploy and the dashboard could not add servers. The requirement is dynamic registration by an admin.
9. **What stops an admin pointing a server at the cloud metadata IP?** URL validation at registration plus a DNS check at connect time (`url-guard.ts`), blocking loopback, link-local and unspecified. Private ranges are allowed because upstreams live there; that is the residual SSRF risk (ADR 009).
10. **What would you change for production?** TLS for the login call, a real credential rotation flow, run it as a Job or operator, and not passing secrets via argv. Possibly a service account token instead of the admin password.

## 7. Weak spots to be ready to defend

- **PATCH always overwrites** url, `enabled` and the credential. If someone changed the URL or disabled a server in the dashboard, `make register` silently reverts it (it only prints a note when it re-enables).
- **Error bodies are hidden** (`-o /dev/null`). A 400 only says "registration failed" with the code. Better to print the `error` field (it contains no secrets).
- **The `read -t 1 <> <(:)` sleep trick** (`:57`) is obscure and Bash-specific. `sleep 1` would be clearer; I would be asked why it is there. I do not know the reason from the code, so check git history before claiming one.
- **Secrets in argv** via `jq --arg` (see section 5).
- **Hard-wired list**: fx and notes are hardcoded in the script, and the wait only checks those two. Adding a fourth upstream means editing the script.
- **Admin password from the cluster Secret** is used for automation. A leaked kubeconfig already means game over, but I should say that explicitly.
- **Depends on Ingress and DNS**: `app.localtest.me` resolves to 127.0.0.1 via public DNS. Offline, it fails; `GATEWAY_URL` with a port-forward is the fallback.
- **Not covered by tests**: there is no automated test for this script; its proof is the manual double run in HANDOFF.
