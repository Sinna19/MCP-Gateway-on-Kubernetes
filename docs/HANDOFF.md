# Handoff

- **Done this session:**
  - eead1bc `docs: explain gateway deployment`.
  - 3902100 `fix(gateway): survive Postgres restarts`: `createPool` in `services/gateway/src/db.ts` now has `pool.on("error")` (log only). Test in `test/db.test.ts` failed first with an unhandled 57P01, then passed.
  - 59d91eb `docs: pool error handler gotcha, ADR 009 failure note` (`.claude/rules/gateway.md`, ADR 009).
  - `make lint` ok, `make test` ok, `make images` + `make deploy` ok.
  - Accept 5 rerun: PASS. After `kubectl delete pod gateway-postgres-0`, login 200 again 8s after the delete (Postgres Ready at 6s), gateway RESTARTS stayed 0. Previously about 40s of 503 plus a crash loop.
- **In progress:** nothing. Tree is clean after the handoff commit.
- **Next step:** `4 extra upstreams` (fx-mcp first, then notes-mcp; split per the split-big-phases memory). Phase 4 is the next unchecked group in PLAN.md (line 54). The Phase 0 VPS deploy checkbox (line 27) is still open.
- **Gotchas learned:**
  - A bounded connect retry around `migrate()` in `src/index.ts:9` was NOT added. The init container (`pg_isready`) covers first start, and the pool handler covers a later Postgres restart. Only a Postgres crash during gateway startup would still crash-loop; kubelet restarts it, which is acceptable.
  - Git Bash blocks `sleep`; poll with `read -t 1 <> <(:) || true`.
  - Login endpoint is `POST http://app.localtest.me/api/auth/login`; credentials JSON is in an older session's scratchpad `login.json` (secret, never print). Namespace is `urumi`.
  - On Windows, Python `open(...,'w')` rewrites LF as CRLF; pass `newline=''`. Keep LF.
- **Files the next task needs:** `docs/PLAN.md` (Phase 4 section), `docs/REQUIREMENTS.md`, `services/woo-mcp/` (as the template for a new MCP service), `.claude/rules/` files for the store and gateway paths.
