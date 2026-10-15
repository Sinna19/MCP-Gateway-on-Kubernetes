# 009: Gateway deployment

Status: accepted (Phase 3c)

## Decision

- **Postgres lives in the gateway chart** as StatefulSet `gateway-postgres` with a PVC. Its pods are labelled `app.kubernetes.io/name: gateway-postgres` and never `gateway`, because the woo-mcp NetworkPolicy allows `name=gateway`; a shared label would let the database reach woo-mcp. Its NetworkPolicy accepts 5432 only from `name=gateway`.
- **One gateway replica, strategy Recreate.** `/mcp` sessions live in memory (ADR 006), and Recreate stops two pods overlapping during a rollout.
- **DATABASE_URL is built from the Secret** with `$(DB_PASSWORD)`. Kubernetes only expands variables defined earlier in the `env` list, so `DB_PASSWORD` must come first. The password is hex so it is safe inside a URL.
- **Startup order**: an init container loops on `pg_isready`, so the first start does not crashloop inside `migrate()`. A `startupProbe` on `/healthz` (every 2s, 30 failures, so 60s) covers migrations and bootstrap before liveness applies.
- **`/readyz` checks the database only**, never woo-mcp. An upstream outage marks the server Unreachable but never removes the gateway from its Service.
- **Ingress paths are `/mcp` and `/api` only.** `/` stays free for the dashboard (Phase 5).
- **Keep-alive**: `keepAliveTimeout` 95s and `headersTimeout` 96s, above Traefik's 90s idle timeout, so Node never closes a socket Traefik is about to reuse (that race gives a 502). `requestTimeout` stays 15s.
- **Shutdown**: on SIGTERM stop accepting, let in-flight requests finish for up to 10s, then `closeAllConnections()`. `terminationGracePeriodSeconds` is 15.
- **Audit is best-effort on purpose.** `Gateway.audit` catches insert errors and logs them. If Postgres hiccups, a tool call that already ran upstream still returns its result, because the side effect (a created product, a changed order) has happened and failing the reply would invite a retry that repeats it.

## Why

The database is part of the gateway's state, so one chart owns it, and a separate label keeps the NetworkPolicies exact. Failing a completed tool call because the log write failed would be worse than losing one log row.

## Consequences

- A row can be lost while Postgres is down. In that window `/readyz` fails and the pod leaves the Service, so the gap is short. If the audit trail ever must be complete, the alternative is to write a "started" row before the call; that is not done now.
- No Postgres backups yet (Phase 8). Gateway ingress is not yet limited to Traefik (Phase 7).
- Each rollout drops open `/mcp` sessions; clients re-initialise.
