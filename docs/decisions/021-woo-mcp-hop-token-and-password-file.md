# 021: woo-mcp password from a file, and a required bearer token

**Status:** accepted
**Date:** 2026-10-19

## Context
woo-mcp took the Woo Application Password from an env var, which is fixed when the pod starts. If the store setup Job regenerates the password, woo-mcp gets 401s until someone restarts it. woo-mcp also accepted any `/mcp` call, so NetworkPolicy was its only protection, while fx-mcp already required a bearer token.

## Decision
- **Password from a mounted file.** Secret `woo-api` is mounted with `items: [password]` at `/var/run/secrets/woo/password` (no `subPath`, because kubelet does not update subPath mounts). The client reads the file on every request.
- **Retry once, only if the password changed.** On a Woo 401 the client reads the file again. If the value differs, it retries once with the new one and logs `woo password changed on disk; retrying` (never the value). If it is the same, the 401 is returned at once, because retrying would fail the same way. Woo rejects a 401 before doing anything, so the retry is safe for POST and PUT too.
- **kubelet delay.** After the Secret changes, kubelet needs up to about 90s to sync the file. The setup Job deletes the old app password immediately, so woo calls fail for that window. It is expected, and no restart is needed.
- **/readyz** goes through the same client, so readiness recovers by itself too.
- **Required bearer token.** `/mcp` needs `Authorization: Bearer <token>`. The check is `checkBearer`, copied from fx-mcp: sha256 both sides, then `timingSafeEqual` (constant time, equal lengths). A missing or wrong token gets 401 and one log line without the token. `/healthz` and `/readyz` stay open because probes carry no token. `WOO_MCP_TOKEN` must be at least 32 characters or the pod will not start.
- **Credential path.** Secret `woo-mcp-token` is created by `scripts/secrets.sh` if missing. `make register` sets it on the `woo` server as a `bearer` upstream credential (the same type fx uses) without printing it.
- **Order on a fresh cluster:** `make deploy`, then `make register`. Until register runs, the gateway's seeded woo server gets 401 and shows Unreachable.
- NetworkPolicy is unchanged. The token is a second layer, not a replacement.

## Token rotation
`WOO_MCP_TOKEN` is an env var, so rotating it means: delete Secret `woo-mcp-token`, run `make secrets`, run `make register`, then `kubectl -n urumi rollout restart deploy/woo-mcp`. We accept that: the token is internal and rarely rotated. The password is different because the Woo setup Job rotates it, which is why it needed the file approach.

## Consequences
- fx and notes 401 logging and audit changes are 7d part 2.
- Token compare code is duplicated in fx-mcp and woo-mcp on purpose: each service stays self-contained.
