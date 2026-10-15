# Handoff

- **Done this session:** Phase 3b, commit 2 of 3. `make lint` and `make test` green; 41 tests in the two new files pass against real Postgres.
  - f0a7ef0 `feat(gateway): servers API with safe serializers`: `src/api/servers.ts` (`serverView` allow-list serializer, GET/POST/PATCH/DELETE `/api/servers`), `statuses()` now returns prefixed `tools`, new `UpstreamControl` + `ServerStatus` types in `upstreams.ts`, `AppOptions.credentialsKey`, `createApiRouter` takes `upstreams` + `credentialsKey`. Tests: `server-view.test.ts`, `api-servers.test.ts`.
  - Rules beyond the plan: `strictObject` bodies (unknown fields such as `slug` on PATCH give 400), URLs with a username/password are rejected, header/bearer values must be printable ASCII (no CR/LF).
- **In progress:** nothing half-finished, tree clean apart from this file. PLAN 3b boxes stay unticked until commit 3.
- **Next step:** `3b keys and audit` (commit 3 of the approved plan: `src/api/{keys,audit}.ts`, `test/api-keys-audit.test.ts` tests first, ADR 008, live smoke, all described below; tick PLAN 3b boxes).
- **Gotchas learned:**
  - `startServer(pool, upstreams)` in `test/api-helpers.ts` now passes the shared `CREDENTIALS_KEY`; a real `UpstreamManager` in a test must use that same key.
  - `emptyUpstreams()` has `reload` and `statuses` stubs; keep them if `UpstreamControl` grows.
  - `audit_log.server_slug` is plain text (no FK), so deleting a server keeps its audit history.
  - Express 5: async handlers can throw and reach `apiErrors`, no try/catch or wrapper needed.
  - The guard-secrets hook still blocks literal passwords/tokens in tests: use `randomBytes(12).toString("hex")`.
- **Files the next task needs:** CLAUDE.md, `.claude/rules/gateway.md`, `src/api-keys.ts`, `src/api/{router,middleware,members}.ts` (members.ts as the style model), `test/api-helpers.ts`, `test/api-invites-members.test.ts` (setup pattern), migration `001_init.sql` (audit_log columns).

## Commit 3 plan: keys and audit (copied from the approved plan)

**Approach**
- Keys: anyone creates/lists/revokes own; admin lists all (`GET /keys?all=true`, member gets 403) and revokes any; another user's key id gives 404. Plaintext key is shown once, only to its owner; list shows prefix only. Reuse `createKey`/`revokeKey`/`hashKey` from `api-keys.ts`; a revoked key fails `findUserByKey`.
- Audit: `GET /audit?user=&server=&outcome=&before=<id>&limit=` (limit <= 200, newest first, `before` pages by id). A member is forced to `user_id = self`.
- Routes (all under `/api`, JSON): GET `/keys`, POST `/keys {name}`, DELETE `/keys/:id`, GET `/audit`. Files: `src/api/{keys,audit}.ts`, mount in `router.ts`.

**Tests first** (`test/api-keys-audit.test.ts`): create shows key once, list shows prefix only; revoke own; member revoking other's key gives 404; member `GET /keys?all=true` gives 403; admin revokes any; revoked key fails `findUserByKey`; audit: member sees own rows only, filters and `before` paging work.

**ADR `docs/decisions/008-dashboard-auth.md`**: session token in cookie `urumi_session` (HttpOnly, SameSite=Strict, Secure via `COOKIE_SECURE`, 12h), only SHA-256 hash stored in Postgres `sessions`, user joined on every request so disable/logout act at once. CSRF: SameSite=Strict plus JSON-only POST/PATCH (415 otherwise), no CORS headers. Login: dummy-hash verify for unknown email (no timing enumeration), same 401 message; rate limiting deferred to Phase 7. Invites: one-time link, hash stored, 7-day expiry, 409 on existing account. No hard delete of members (audit keeps user); disable deletes sessions, API keys stay but are rejected while disabled, re-enable restores them. Admin cannot demote or disable self. Central error handler: zod 400, 23505 409, else generic 500, nothing internal in bodies.

**Live smoke** (charts come in 3c): `kubectl port-forward svc/woo-mcp`, run the gateway locally with Postgres in Docker, then curl and report PASS/FAIL with one output line each:
1. login gives the cookie; 2. `GET /api/servers` shows `woo` connected with 5 tools and no credential field; 3. `POST /api/keys` returns a key; 4. `/mcp tools/list` with it lists `woo__*`; 5. `DELETE /api/keys/:id`; 6. `/mcp` with that key gives 401; 7. `GET /api/audit` shows the call.

Then tick the PLAN 3b boxes ("REST API for dashboard" and the 3b part of "credentials encrypted at rest; serializers never include them") and run `/handoff`. Phase 3 Accept checks need the chart (3c); not claimed here.
