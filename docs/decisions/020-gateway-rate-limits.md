# 020: Gateway rate limits and closing sessions on access change

Status: accepted (7c part 1). Chat cap, `/mcp` session cap, sweeps and the `last_used_at` throttle are part 2.

## Decisions
- **Close sessions when access changes.** Revoking a key (`DELETE /api/keys/:id`) closes the `/mcp` sessions opened with that key; disabling a user or changing their role (`PATCH /api/members/:id`) closes all of that user's sessions. `server.close()` ends the session and every open SSE stream, so no `list_changed` reaches the client. Setting the role a user already has, or re-enabling, closes nothing. The per-request check in `authenticate` stays as the backstop (a revoke done straight in the database). This closes the known gap in ADR 014. A role change closes too because 7e will make the tool list depend on the role.
- **One small limiter we wrote** (`src/rate-limit.ts`, `FixedWindowLimiter`): first take of a key opens a window, at most `max` takes fit, then `Retry-After` is the seconds left, rounded up. `refund`, `reset`, `sweep` and an injectable clock. No library: it is 40 lines I can explain and test with a fake clock.
- **In memory is fine because the gateway is one replica** (ADR 006). Limits are per process; with more replicas each pod would count on its own, so multi-replica would need the counters in Postgres or Redis.
- **Login** (`POST /api/auth/login`): every attempt is counted before the password check, in an IP bucket (default 30) and an email bucket (default 5) per 15 minutes. The email is the same trimmed, lowercased value the lookup uses, so `Admin@X` and `admin@x` are one bucket; unknown emails count too, so the limit does not reveal which exist. Over a limit: 429 + `Retry-After`, even for the right password.
  - A successful login resets the email bucket and refunds its IP token. The IP bucket is never reset, or an attacker could reset it by logging in to their own account between guesses. Refunds matter because dod-check, browser sessions and tests all log in from the same k3d source IP.
  - An attempt refused by the email bucket gives its IP token back, so hammering one known email cannot use up the shared IP budget.
- **`/mcp`**: each `tools/call` message takes one token from the key's bucket (default 60 per minute) before any tool lookup or audit, so unknown tools count too. `initialize`, `tools/list`, GET and DELETE are not counted. Over the limit: HTTP 429 + `Retry-After` + a JSON-RPC error (`-32000`, "rate limit exceeded, retry in Ns").
  - 60/min is far above dod-check (12 requests on its busiest key in a whole run).
- **Client IP**: `trust proxy` is `1`, so `req.ip` is the address Traefik appended to `X-Forwarded-For`. Safe because Traefik overwrites a client-sent value and the NetworkPolicy lets only Traefik reach the gateway (ADR 019). Proved on the cluster: 32 wrong logins with distinct emails and distinct spoofed `X-Forwarded-For: 9.9.9.N` still hit 429 after 30 attempts from the one real IP, and 6 wrong logins for one email with spoofed `1.2.3.N` gave 429 on the 6th.
- **Config** in `charts/gateway/values.yaml` under `limits:` (`login.perEmail`, `login.perIp`, `login.windowSeconds`, `mcp.callsPerMinute`), passed as env, read in `src/config.ts` (empty = default, a non-positive or non-integer value fails at start).

## Trade-offs
- The per-email limit lets anyone lock a known email out for 15 minutes. Accepted: it expires by itself, and there is no CAPTCHA in scope.
- Limits are per process and reset when the gateway restarts.
- A `/mcp` 429 is an HTTP status plus a JSON-RPC error body, so both HTTP clients and MCP clients see a clear reason.
- Behind k3d's load balancer many local clients share one source IP, hence the higher per-IP number and the per-email limit as the main brute-force guard.
