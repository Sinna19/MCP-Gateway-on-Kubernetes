# Handoff
## Done this session (Phase 9: review fixes)
- `/phase-review phase-8` found 4 items; all fixed in 70a0d0c (`fix: phase 9 review findings`), pushed.
- `scripts/restore-check.sh`: wait loop polls Job conditions (Complete/Failed), not `.status.failed`; the pod picks the dump by name (`ls | sort | tail -1`); MIN_DUMP comment cites `charts/gateway/templates/backup-cronjob.yaml:68`, example timestamp removed.
- `.claude/hooks/guard-kube-context.sh`: read-only segments with `--pre`, `--ext-diff`, `--output`, `-O` or `--open-files-in-pager` are still scanned; the mutating pattern now also matches a kubectl/helm right after a quote.
- Proof (k3d only): `make restore-check` -> RESTORE CHECK: PASS (gateway-20261022T062410Z.dump); hook tests ok (62 checks); `make lint` ok; `make test` ok. No ENV=prod.

## In progress
- Nothing half-finished. The recording itself is still to do (Ash).

## Next step
`9 D record`: Ash works through the checklist in `docs/DEMO_SCRIPT.md`, rehearses sections 1 and 3 once, then records. After that, only the submission form remains (https://forms.gle/nftwgyNeenSDmiRb6).

## Gotchas learned
- Hook gate only fires on a mutating kubectl/helm verb or a `vps_action` marker; a bare `urumi-vps` in a flag value is not gated. The `git diff --ext-diff --output=x` fixture therefore carries `ENV=prod`.
- `ENV=prod make dod` scales notes-mcp to 0 and disables fx itself: do not run it during the recording.
- Disabling fx: the chat model may answer a currency question from memory. Prove it with the Audit page and the tool list.
- Never delete TLS Secrets or the namespace on the VPS; roll back one Helm revision at most.
- Cannot show live: a timeout, the two-upstream single prompt through an LLM client, Claude Code/Desktop snippets. Full list at the end of DEMO_SCRIPT.md.

## Files the next task needs
- docs/DEMO_SCRIPT.md (checklist and sections), docs/REHEARSAL.md only if a step fails
