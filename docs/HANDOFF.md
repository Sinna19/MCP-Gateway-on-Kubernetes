# Handoff

- **Done this session:** Phase 0 complete except the VPS box.
  - 46d7ede repo layout, umbrella chart (4 empty subcharts), values-local/prod, cluster scripts, Makefile, ADR 001.
  - b4fc9c1 PLAN ticks + handoff. f3d1485 gitignore docs/ASSIGNMENT.md. f5a58ae workflow kit (.claude/, CLAUDE.md, WORKFLOW.md, REQUIREMENTS.md).
  - Verified: cluster-up, deploy (REVISION 1), `kubectl get ns urumi`, `make lint` ok, Traefik answers 404 on shop.localtest.me.
  - Cluster `urumi` is running with the empty platform release. Nothing pushed.
- **In progress:** none.
- **Next step:** `1 store` (Phase 1). The VPS deploy box in Phase 0 waits until the VPS is rented.
- **Gotchas learned:**
  - Traefik takes 1 to 2 min to pull images after first `cluster-up`; port 80 gives 404 until routes exist.
  - Git Bash needs a restart to see newly installed tools (make was "missing" until then).
  - Subchart tarballs are gitignored; `make deploy` and `make lint` rebuild them via `helm dependency update`.
  - Namespace comes from `--create-namespace`, not a template (ADR 001).
  - `/phase` skill shell expansion failed once ("variable can't be checked"); the task text still loaded, so read PLAN.md with Grep + Read.
  - Hook scripts and settings.json in .claude/ were committed unread; skim them.
- **Files the next task needs:** CLAUDE.md, docs/PLAN.md (Phase 1), docs/REQUIREMENTS.md, .claude/rules/kubernetes.md, .claude/rules/store.md, charts/store/, deploy/values-local.yaml.
