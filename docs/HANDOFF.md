# Handoff

- **Done this session:** Phase 1 is complete and its Accept line is ticked.
  - 2a49fb6 fix(cluster): pin k3d API port to 6550 (random port hit a Windows reserved range; ADR 001).
  - 43c4997 feat(store): setup Job, scoped RBAC (get/patch on `woo-api` only), pre-created `woo-api`, ADR 004.
  - 5c75323 chore(store): shellcheck SC2016 silenced for the php snippet.
  - 2573177 docs: tick phase 1 accept. 0d13b20 feat(store): make shop the front page.
  - Verified: COD order 14 is `processing` and survived deleting the WordPress and MariaDB pods; `setup-4` logged "front page: already set, skipped"; `/` returns 200 with 3 products; REST v3 lists 3 SKUs with the `woo-mcp` app password; `shellcheck` and `make lint` clean.
- **In progress:** nothing. Working tree is clean.
- **Next step:** `2 woo-mcp service` (TS service, Streamable HTTP `/mcp`, `/healthz`, `/readyz`, the 5 tools). Big task, so use plan mode.
- **Gotchas learned:**
  - After any cluster-down, run `make secrets` before `make deploy`. It recreates `woo-api` empty and the Job refills it.
  - Windows path, CRLF and reserved-port tips are now in `.claude/rules/kubernetes.md`. `git status` can show stale "M" files after a VS Code restart; `git update-index --refresh` and a diff settle it.
  - `values-prod.yaml` keeps `environmentType: local` while TLS is off, because Application Passwords need HTTPS in production mode.
  - woo-mcp will use the `woo-api` Secret keys `username` and `password`, and Woo URL `http://store-wordpress` in-cluster (check the Service name in `wordpress-service.yaml`). Permalinks are pretty, so `/wp-json/wc/v3/` works.
  - Admin login is in Secret `store-wp-admin` (user `admin`). Products: TSHIRT-001, MUG-001, TOTE-001.
- **Files the next task needs:** CLAUDE.md, docs/PLAN.md (Phase 2), `.claude/rules/store.md`, `.claude/rules/kubernetes.md`, `docs/decisions/004-setup-job.md`, `charts/store/templates/wordpress-service.yaml`, `charts/store/values.yaml` (`setup:` block).
