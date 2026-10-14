# Handoff

- **Done this session:** Phase 1, box 1 (MariaDB).
  - fe2ca30 feat(store): mariadb statefulset, pvc, script-created secret.
  - Chart: `charts/store/templates/mariadb-{statefulset,service}.yaml`, `_helpers.tpl`, values under `mariadb.*`.
  - `scripts/secrets.sh` (create-if-missing Secret `store-db`, keys `root-password`, `password`), `make secrets`, `deploy` now depends on it. ADR 002.
  - Probes: startup + readiness + liveness via the image's `healthcheck.sh`; requests/limits set; runs as uid 999.
  - Verified: PVC Bound (local-path), data survived `kubectl delete pod store-mariadb-0`, `make secrets` rerun skipped, `make lint` ok.
- **In progress:** none.
- **Next step:** `1 wordpress` (WordPress Deployment + wp-content PVC + Service + Ingress `shop.localtest.me`).
- **Gotchas learned:**
  - Use `kubectl exec ... -- sh -c '...'` in single quotes so `$MARIADB_ROOT_PASSWORD` expands inside the pod, not in Git Bash.
  - MariaDB reads password env only on first init; never rotate `store-db` after the PVC exists (ADR 002).
  - The "Probes + requests/limits on all of it" box in PLAN.md stays unticked until WordPress and the setup Job have them too.
  - WordPress will need `WP_HOME`/`WP_SITEURL` from values and the DB host `store-mariadb:3306` (rules: `.claude/rules/store.md`).
- **Files the next task needs:** CLAUDE.md, docs/PLAN.md (Phase 1), `.claude/rules/store.md`, `.claude/rules/kubernetes.md`, `charts/store/values.yaml`, `charts/store/templates/mariadb-statefulset.yaml` (as the pattern), `deploy/values-local.yaml`.
