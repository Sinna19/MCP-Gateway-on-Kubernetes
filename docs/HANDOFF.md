# Handoff

- **Done this session:** `/phase-review phase-0` (18 findings), then fixed 14 of them.
  - ab77a56 fix: review hardening. setup.sh recreates the app password if WP lost it (JSON + uuid, not CSV); no SA token + RuntimeDefault seccomp on woo-mcp/wordpress/mariadb pods; WP PVC kept on uninstall; wait-setup waits for `job/setup-<revision>`; images pinned (node 24.20.0, wp-cli 2.12.0, mariadb 11.4.13); woo-mcp request/header timeouts, 413 on big bodies, `redirect: "error"`; lint renders values-prod; `.NOTPARALLEL`.
  - a709e0a docs: PLAN Phase 8 (TLS annotations, single-node note), gateway rule on HTTP timeouts and redirects.
  - 076b488 docs: ADR 004 Recovery note, PLAN Phase 7 item (woo-mcp re-reads a mounted password file on 401).
  - Verified on k3d: all pods Ready, `tools/list` = 5 tools, Phase 2 Accept checks pass (unlabelled pod exit 7, labelled exit 0).
- **In progress:** nothing half-finished. Known gaps, deliberately left:
  - Deleting the app password makes the Job write a new one, but woo-mcp stays 0/1 until `kubectl -n urumi rollout restart deploy/woo-mcp` (env var read at startup; ADR 004 Recovery).
  - `docs/decisions/004-setup-job.md` "Decision" bullets still say "If `password` is set the Job skips" and "never appears in a process list"; both are now less exact (see setup.sh:98-125).
  - Not done from the review: #12 Woo response size cap, #13 cache `/readyz`, #7 other secrets in argv (admin password, SA token).
- **Next step:** `3a gateway service + tests`
- **Gotchas learned:**
  - A Windows `jq -r` ends lines with CR; pipe through `tr -d '\r'` (added to `.claude/rules/kubernetes.md`).
  - Writing `\r` or `\n` through a JS template literal in a node heredoc puts a real CR/LF in the file. Use the Edit tool for lines containing escapes.
  - WP-CLI has no known `--name` filter on `application-password list`; filter the `--format=json` output instead.
  - Secret changes do not restart pods; any env-from-Secret value needs a restart or a file mount.
- **Files the next task needs:** CLAUDE.md, docs/REQUIREMENTS.md, docs/PLAN.md (Phase 3), `.claude/rules/gateway.md`, `services/woo-mcp/{package.json,tsconfig.json,eslint.config.js,vitest.config.ts,src/server.ts}` (copy the layout), `Makefile` (`TS_SERVICES`).
