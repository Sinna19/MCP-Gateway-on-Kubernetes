---
description: Review one phase's changes with the reviewer agents before moving on. Usage /phase-review <git ref, e.g. phase-1>
---

Review the work since `$ARGUMENTS` (a git tag or commit). Report findings only; do not fix anything.

1. Run `git diff --stat $ARGUMENTS..HEAD` and use only the files it lists.
2. In parallel:
   - `k8s-reviewer` agent on the changed files under `charts/`, `deploy/`, `scripts/` and the `Makefile`.
   - `security-reviewer` agent on the changed files under `services/`, `apps/` and `scripts/`, plus any setup or secret handling.
   Skip an agent if none of its files changed.
3. Skip anything already recorded as a known limitation or deliberate trade-off in `docs/decisions/` or `docs/explain/`.
4. Reply with one table, ranked by severity: finding, file:line, why it matters, suggested fix (one line). Under 25 rows. If nothing real is found, say so in one line.
