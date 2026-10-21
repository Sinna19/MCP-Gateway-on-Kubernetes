# Handoff
## Done this session (Phase 9, group A items 1-2)
- `1df2a7d` PLAN.md Phase 9 rewritten as groups A (fixes), B (docs), C (CI), D (demo).
- `2416646` mcp-endpoint flake fixed. Cause: `listRequest` never read the body; /mcp sends SSE headers before the handler ends, so a `tool_rules JOIN upstream_servers` query was still running when the next `beforeEach` TRUNCATE ... CASCADE deadlocked. `app.sweep()` now returns the purge promise (second leak, same shape). Proof: file 20/20 (was ~1 in 5), `make test` 5/5, lint ok.
- `f9a4426` guard hook: read-only segments (grep/cat/ls/git log...) ignored unless they hold `$(` backtick `<(` `>(`; context names lose `" ' `` ` `` and stop at `)`; closed a gap where `` `kubectl ...` `` / `$(kubectl ...)` was never matched. 59 fixture checks, `hook tests: ok`. This commit also ticked the A1 box.

## In progress
- Nothing half-finished. Working tree is clean after this commit.

## Next step
`9 A3 restore-check takes a fresh backup first` (plan: `C:\Users\aashi\.claude\plans\pasted-content-id-c503-phase-9-immutable-fairy.md`, section A3, includes the user's approved tweaks).
- Job from `cronjob/gateway-postgres-backup`, wait, pass `MIN_DUMP` to the pod and fail if the newest dump is older; print the file name; `SKIP_BACKUP=1` keeps old behaviour.
- Retention is by age (`find -mtime`), so the extra dump never rotates out a nightly: note it in the header comment. Accept the CronJob-overlap race, no lock.
- Prove on k3d only: `make dod`, `SKIP_BACKUP=1 make restore-check` (expect DIFF audit_log), `make restore-check` (PASS), no `for-check` Job left. No `ENV=prod` without asking.

## Gotchas learned
- Process start is ~0.5 s on this machine, so a hook call is ~2 s and `bash .claude/hooks/test-guard-kube-context.sh` takes ~70 s (run it with `timeout 180`; it is not hung). Added to kubernetes.md.
- The guard hook denies any command whose text mentions a foreign `--context`: write fixtures/loops to a file with Write, then run the file.
- Reads under `node_modules` are denied, so SDK behaviour is observed, not quoted.

## Files the next task needs
- scripts/restore-check.sh, charts/gateway/templates/backup-cronjob.yaml, docs/decisions/025 (one line), .claude/rules/kubernetes.md (restore-check line), docs/PLAN.md (tick A3)
