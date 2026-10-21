# Handoff
## Done this session
- Phase-7 review fixes, all 13 findings handled: `1138a28 fix: phase-7 review findings ...`
  - dod-check refuses non-k3d contexts unless `DOD_ALLOW_PROD=1` (`ENV=prod make dod` sets it); ADR 024 notes the standing `dod-member` user.
  - Backup CronJob: `activeDeadlineSeconds: 900`, `startingDeadlineSeconds: 3600`, `umask 077`; backup-pull trap + umask 077.
  - Hook guards exec/cp/label/annotate/set/run/taint/uncordon/rollout undo and ssh azureuser@ / k3s kubectl; fixtures extended.
  - restore-check: in-pod EXIT trap drops restore_check, names read from the StatefulSet, pod resources set.
  - `push-images` fails on uncommitted services/apps; `checksum/mu-plugin` on WordPress Deployment and setup Job; dashboard ingress `if`; stale Makefile message.
  - PLAN phase 9 THREAT_MODEL list has the mu-plugin X-Forwarded-For line.
- Proof: `make lint`, `make test`, hook tests ok. k3d: `make dod` 8/8 (a forced `DOD_WAIT=1` failure still restored notes replicas=1), backup Job complete (dump mode 600), `make restore-check` PASS.
- VPS: `ENV=prod make deploy` ok (setup-6), `ENV=prod make restore-check` PASS after a fresh dump, `ENV=prod make dod` 9/9; the unflagged script refused.

## In progress
- Nothing half-finished. The handoff and rules edits are the only changes after `1138a28`.

## Next step
`9 THREAT_MODEL` (docs/THREAT_MODEL.md, the four required questions, including the mu-plugin line in PLAN phase 9).

## Gotchas learned
- restore-check false-fails on any write since the last dump; take a fresh dump first (now in `.claude/rules/kubernetes.md`).
- Raw kubectl against the VPS needs KUBECONFIG exported; the hook denies commands that merely mention a foreign context (use a script file).
- Optional later: make restore-check take its own dump so it cannot false-fail.

## Files the next task needs
- docs/REQUIREMENTS.md (security questions), docs/PLAN.md (phase 9), docs/decisions/019 (NetworkPolicy), 023 (credentials key), 024, 025
