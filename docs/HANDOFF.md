# Handoff
## Done this session (Phase 9, A3 — group A is complete)
- `8406b61` restore-check takes a fresh backup first: Job `gateway-backup-for-check` from the CronJob, wait up to 900 s, `MIN_DUMP` (Job startTime in dump-name form) passed to the pod, which fails with `stale dump` if the newest dump is older. `SKIP_BACKUP=1` keeps the old behaviour. EXIT trap deletes the Job. ADR 025 line, kubernetes.md restore-check line and PLAN A3 box updated.
- Proof on k3d: after `make dod` (8 passed) `SKIP_BACKUP=1 make restore-check` gave `DIFF audit_log live=126 restored=120`; `make restore-check` gave `restoring /backups/gateway-20261021T140801Z.dump` + `RESTORE CHECK: PASS`; no `for-check` Job left. `make lint` and `make test` ok.

## In progress
- Nothing half-finished. Working tree is clean after this commit. No `ENV=prod` run was done.

## Next step
`9 B THREAT_MODEL.md` (first unchecked box of group B in PLAN.md Phase 9; the later B boxes are separate sessions).

## Gotchas learned
- Editing a script with a python heredoc through Bash mangled `\n`, `\r`, `\$` and left a literal CR byte; use the Edit tool for escape-heavy lines. Check with `grep -c $'\r' file` (must be 0).
- `make dod` takes ~6.5 min; run it in the background and wait for the notification.

## Files the next task needs
- docs/PLAN.md (Phase 9 B boxes), docs/ASSIGNMENT.md (security questions only), docs/decisions/011, 014, 019, 024
