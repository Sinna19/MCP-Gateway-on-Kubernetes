# Handoff

- **Done this session:** Phase 1 boxes 3 and 4 (setup Job, probes/limits). Phase 1 is complete except the manual checkout.
  - 2a49fb6 fix(cluster): pin k3d API port to 6550 (Windows reserved range blocked the old random port; ADR 001).
  - 43c4997 feat(store): setup Job, scoped RBAC, pre-created `woo-api`, ADR 004.
  - Chart: `charts/store/files/setup.sh`, `templates/setup-{job,configmap,role,serviceaccount}.yaml`, helper `store.wordpressEnv` shared with the Deployment. `scripts/secrets.sh` now creates `store-wp-admin` and `woo-api` (username only).
  - Verified: Job completes; `woo-api` password is set; REST v3 with the app password lists 3 SKUs; `can-i create secrets` is no, `get woo-api` yes, `get store-db` no; `/shop/` 200; `.htaccess` in the WP pod; rerun `setup-2` skips everything and the Secret `resourceVersion` stays 966; products survive deleting the WP and MariaDB pods; `make lint` ok.
- **In progress:** nothing in code. The manual COD checkout and "order visible in WP admin" are not done yet. Open `http://shop.localtest.me`, buy with COD, log in at `/wp-admin` (user `admin`, password from `store-wp-admin`), then tick the Phase 1 Accept line in PLAN.md.
- **Next step:** `2 woo-mcp service` (TS service, Streamable HTTP `/mcp`, `/healthz`, `/readyz`, the 5 tools). Big task, so use plan mode.
- **Gotchas learned:**
  - The k3d cluster was recreated, so the PVCs and Secrets are fresh. After any cluster-down, run `make secrets` before `make deploy`.
  - Git Bash rewrites `/var/www/html` in `kubectl exec` args to a Windows path. Prefix with `MSYS_NO_PATHCONV=1`.
  - Python `open().write()` on Windows writes CRLF. Use `sed -i 's/\r$//'` or edit with the Edit tool.
  - WooCommerce is pinned at 11.2.1 (tested up to WP 7.1.3). The cli image has curl and php but no `jq` or shellcheck.
  - `values-prod.yaml` keeps `environmentType: local` while TLS is off, because Application Passwords need HTTPS in production mode. Switch it when TLS is on.
  - sendmail "connection refused" lines in the Job log are harmless (no mail server).
- **Files the next task needs:** CLAUDE.md, docs/PLAN.md (Phase 2), `.claude/rules/store.md`, `.claude/rules/kubernetes.md`, `docs/decisions/004-setup-job.md`, `charts/store/values.yaml` (the `setup:` block, for product SKUs and the `woo-api` Secret name).
