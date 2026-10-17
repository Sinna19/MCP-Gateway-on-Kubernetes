# Dashboard: login, cookie, route guards, dev proxy, nginx, Ingress

Files: `apps/dashboard/src/{auth.tsx,api.ts,App.tsx,Layout.tsx,pages/Login.tsx}`, `apps/dashboard/{vite.config.ts,nginx.conf,security-headers.conf,Dockerfile}`, `charts/dashboard/`, gateway side `services/gateway/src/{sessions.ts,api/auth.ts,api/middleware.ts}`. ADRs 008 and 016.

## 1. What it is and why

The dashboard is a React single-page app (static files) that talks to the gateway's REST API under `/api` using a session cookie. In-cluster nginx serves the static files and Traefik sends `/api` and `/mcp` to the gateway on the same host, so the browser sees one origin and needs no CORS and no token in JavaScript.

## 2. Request flow

**Page load** (`http://app.localtest.me/servers`):
1. Browser resolves `*.localtest.me` to 127.0.0.1 (k3d maps the host port to Traefik).
2. Traefik (ingress controller) matches host `app.localtest.me`. Two Ingress objects share that host: `gateway` has `/mcp` and `/api` (`charts/gateway/values.yaml:11-13`), `dashboard` has `/` (`charts/dashboard/values.yaml:12-13`). Traefik picks the longest matching prefix, so `/servers` goes to the dashboard.
3. Service `dashboard` (port 80, `charts/dashboard/templates/service.yaml:15-17`) forwards to the pod's `http` port 8080.
4. nginx (`nginx.conf:13-16`): `try_files $uri /index.html`. `/servers` is not a file, so it serves `index.html` and React Router renders the page. `/assets/*` is a real file or a real 404 (`nginx.conf:23-27`).

**Login:**
1. SPA mounts, `AuthProvider` calls `GET /api/me` (`auth.tsx:20-26`). 401 means "not logged in", `status` becomes `ready`, `RequireUser` redirects to `/login` and remembers the target in router state (`Layout.tsx:7-13`).
2. User submits the form: `POST /api/auth/login` with JSON `{email, password}` (`api.ts:15-21`, `auth.tsx:28-32`).
3. Traefik routes `/api` to Service `gateway`, then the gateway pod. Express mounts everything under `/api` (`app.ts:49`). `requireJsonBody` runs first (415 if not JSON).
4. `auth.ts:24-35`: look up user by lowercase email, verify the password against the real hash or a dummy hash (equal timing), reject if disabled. On success `startSession` creates 32 random bytes, stores only the SHA-256 hash in Postgres `sessions` with a 12h expiry (`sessions.ts:9-14`), and sets the cookie.
5. Response `Set-Cookie: urumi_session=<token>; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` (+ `Secure` when TLS is on) and body `{id,email,role}` (`auth.ts:18`).
6. `login()` stores the user in React state, then navigates to the original page or `homeFor(role)` (admin goes to `/servers`, member to `/keys`).

**Every later API call:** browser attaches the cookie automatically (`credentials: "same-origin"`). `loadUser` reads it, hashes it, runs one SQL join of sessions and users (`sessions.ts:17-24`) and sets `res.locals.user`. `requireUser` returns 401 if none, `requireAdmin` returns 403 if role is not admin (`middleware.ts:26-42`).

**Dev mode** (`vite dev`): the browser talks to `localhost:5173`. Vite proxies `/api` to `http://app.localtest.me` (`vite.config.ts:9`). `changeOrigin: true` rewrites the Host header because Traefik routes by Host. The browser still sees one origin (localhost:5173), so the cookie works. `Secure` is off locally (no TLS), otherwise the browser would drop the cookie over http.

## 3. Kubernetes objects (`charts/dashboard/templates/`)

- **Deployment**: 1 replica, image `urumi/dashboard:<tree hash>` (`required` fails the render if no tag, `deployment.yaml:47`). Tag is the git tree hash of `apps/dashboard`, so a changed app means a new tag and a rollout.
- **securityContext**: `runAsNonRoot`, seccomp `RuntimeDefault`, `readOnlyRootFilesystem`, drop ALL caps, no privilege escalation, `automountServiceAccountToken: false` (it never calls the API server). `emptyDir` on `/tmp` because nginx-unprivileged writes its pid and temp files there.
- **Probes**: readiness every 10s and liveness every 20s, both `GET /healthz` (`nginx.conf:32-37`, plain `return 200`). No startup probe: nginx starts in milliseconds.
- **Resources**: requests 10m CPU / 16Mi, limits 100m / 64Mi. Enough for static files.
- **Service**: ClusterIP, port 80 to named port `http`.
- **Ingress**: class from `global.ingress.className` (traefik), host `app.<domain>`, `pathType: Prefix`, TLS block only if `global.ingress.tls` (secret `gateway-tls`, shared with the gateway Ingress).
- **Secrets / PVC**: none. Static content, no state.
- **NetworkPolicy**: none for the dashboard. It has no secrets and calls nothing. (Question to be ready for, see section 7.)

## 4. Failure modes

| What breaks | What happens | Where handled |
|---|---|---|
| Session expired/revoked, user disabled | Any call returns 401, `onUnauthorized` sets user null, `RequireUser` bounces to `/login` | `api.ts:30-33`; SQL checks expiry and `disabled_at` each request |
| Wrong password | 401 with a generic message; does not trigger the logout path because paths under `/auth/` and `/me` are excluded | `api.ts:32` |
| Traefik/gateway down (502/504 HTML) | `JSON.parse` fails, treated as empty body, status still decides, error shows "request failed (502)" | `api.ts:23-29` |
| Logout request fails (network/5xx) | Stay logged in and show "Logout failed, try again", because the cookie may still be valid. Only 401 counts as already logged out | `auth.tsx:34-42` |
| Reload on a client route | nginx fallback serves `index.html` | `nginx.conf:13-16` |
| Missing hashed chunk after a deploy | Real 404, not HTML with 200 (which would cause a confusing JS parse error) | `nginx.conf:23-27` |
| Member types `/servers` | `RequireAdmin` redirects to `/keys`; even if bypassed, the API returns 403 | `Layout.tsx:15-20` |
| Dashboard pod dies | Single replica: brief outage of the UI only. Gateway/MCP are unaffected (not routed through nginx) | `deployment.yaml` |
| Postgres down | `loadUser` throws, Express 5 forwards the rejected promise to the central error handler, 500 | `app.ts` |

## 5. Security

- **Trusted:** the gateway's database check on every request. **Not trusted:** anything in the browser, including `user.role` in React state.
- **`RequireUser`/`RequireAdmin` are UX only** (`Layout.tsx:6` says so). They hide pages. The real boundary is `requireUser`/`requireAdmin` in the gateway. Editing React state in dev tools shows an empty page whose API calls return 403.
- **Cookie:** random 256-bit token. `HttpOnly` (JS and XSS cannot read it), `SameSite=Strict` (not sent on cross-site requests), `Secure` only with TLS (`COOKIE_SECURE` comes from `global.ingress.tls`). Only the SHA-256 hash is in Postgres, so a DB leak does not leak live sessions. Password never stored in the browser, never in localStorage.
- **CSRF:** SameSite=Strict, JSON-only bodies (415 otherwise), no CORS headers. No CSRF token (ADR 008 says so).
- **Headers** (`security-headers.conf`): CSP `default-src 'self'` with no inline scripts or styles, `frame-ancestors 'none'` plus `X-Frame-Options: DENY` (clickjacking), `Referrer-Policy: no-referrer` (the invite token is in the URL, `/invite/<token>`), `nosniff`.
- **Why headers are included in every location:** nginx does not inherit `add_header` into a location that defines its own (`security-headers.conf:1`).
- **Credential travel:** password goes browser to Traefik to gateway over plain HTTP locally, over TLS in prod (`tls: true` gives `Secure` cookie). The only place the password is ever compared is the gateway, against a hash (`passwords.js`).

## 6. Interview questions

1. **Why a cookie session instead of a JWT in localStorage?** JS can't read an HttpOnly cookie, so XSS can't steal it. Server-side sessions can be revoked instantly (logout, disable user). A JWT can't be revoked before expiry without a deny list, which is a session table anyway.
2. **Why store only the hash of the token?** If the DB leaks, the attacker has hashes of 256-bit random values, which are useless as cookies. SHA-256 is fine without a salt or slow hash because the input is high entropy, unlike passwords.
3. **RequireAdmin is client side. Isn't that bypassable?** Yes, and that's fine: it only hides pages. Every admin route checks `requireAdmin` on the gateway, which reads the role from the DB, not from the client.
4. **How do you handle CSRF without a token?** SameSite=Strict means the browser doesn't send the cookie cross-site. As a second layer, mutating routes accept only `application/json`, which a cross-site HTML form can't send, and we set no CORS headers so a cross-origin `fetch` can't read or send JSON with credentials. Weakness: relies on browser behaviour.
5. **Why does the dev proxy exist and why `changeOrigin`?** Browser at `localhost:5173` calling `app.localtest.me` would be cross-origin and the Strict cookie wouldn't work. Vite forwards `/api` server side so the browser sees one origin. Traefik routes by Host, so the Host header must be `app.localtest.me`.
6. **How can two Ingresses share a host?** Traefik turns each path into a router with a rule like ``Host(`app.localtest.me`) && PathPrefix(`/api`)``. Longer rules have higher priority, so `/api` and `/mcp` win over `/`. Why not one Ingress? Separate charts, one owner per route (ADR 016).
7. **Why not have nginx proxy `/api` and `/mcp` too?** Extra hop, and buffering risk for MCP's SSE streaming. Traefik can route directly.
8. **Why does nginx need `try_files $uri /index.html`, and why not for `/assets/`?** Client-side routes don't exist on disk. For `/assets/` a missing file must be a 404, otherwise the browser gets HTML where it expects JS.
9. **Why nginx-unprivileged and read-only root fs?** Runs as UID 101 on 8080 with no root needed, and an attacker who gets code execution can't write to the image filesystem. `/tmp` is an `emptyDir` for nginx's runtime files.
10. **Why not an Ingress with TLS terminated at nginx / why is dashboard single-replica?** TLS belongs at the ingress controller, one place for certs. Single replica is acceptable for a static server in a demo; with 2 replicas nothing would break because the dashboard holds no state (sessions live in Postgres).

## 7. Weak spots to be ready to defend

- **No login rate limiting.** ADR 008 defers it to Phase 7. If asked, say it's known, and describe the plan (per-IP and per-email counters). Don't claim it exists.
- **No NetworkPolicy for the dashboard pod.** Low risk (static files, no secrets, no egress needed) but the assignment emphasizes isolation. Be ready to say why it's lower priority, or add a default-deny egress policy.
- **`Secure` cookie is off locally and in `values-prod.yaml` (`tls: false`).** The cookie travels over plain HTTP in both. Prod must turn TLS on for this to be real.
- **Sessions are purged lazily**, only inside `createSession` (`sessions.ts:10`). Expired rows are rejected by the SQL, so it's safe, but the table isn't trimmed until someone logs in.
- **`readCookie` is hand-parsed** (`sessions.ts:34-40`). Works, but is the kind of thing a reviewer asks about; `cookie-parser` is the alternative.
- **No CSRF token**: a deliberate trade-off recorded in ADR 008, but it is a trade-off.
- **A user with a stolen cookie works until expiry or logout** (12h, no idle timeout, no IP binding).
- **Single replica, `Recreate`/rolling behaviour not tuned.** Fine for the assignment.
- **The CSP forbids inline styles**; any library that injects inline styles will break at runtime in the cluster but not in `vite dev`. Test the built image, not only dev.
