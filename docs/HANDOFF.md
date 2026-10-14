# Handoff

- **Done this session:** Phase 0 complete except the VPS box. Layout, `scripts/cluster-up.sh`, umbrella chart with 4 empty subcharts, values-local/prod, Makefile, ADR 001. Cluster `urumi` is running with the platform release deployed (empty).
- **In progress:** none.
- **Next step:** `/phase 1` (Store). VPS deploy of the empty chart (last Phase 0 box) waits until the VPS is rented.
- **Gotchas learned:** Traefik takes ~1 to 2 min to pull images after first `cluster-up`; port 80 returns 404 until routes exist. `make` was missing at first and had to be installed. Git Bash needs a restart to pick up new PATH. Subchart dependency tarballs are gitignored; `make deploy`/`lint` rebuild them. Namespace comes from `--create-namespace` (ADR 001).
- **Files the next task needs:** CLAUDE.md, docs/PLAN.md (phase 1), docs/REQUIREMENTS.md, charts/store/, deploy/values-local.yaml, .claude/rules/kubernetes and store.
