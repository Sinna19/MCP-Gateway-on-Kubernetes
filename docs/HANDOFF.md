# Handoff

- **Done this session:** Phase 1, box 2 (WordPress).
  - cec3f98 feat(store): wordpress deployment, wp-content pvc, ingress.
  - Chart: `charts/store/templates/wordpress-{deployment,pvc,service,ingress}.yaml`, values under `wordpress.*`.
  - Image pinned `wordpress:7.1.3-php8.3-apache`. Core in an emptyDir, only wp-content on PVC `store-wordpress-content`. Strategy Recreate, uid 33.
  - `scripts/secrets.sh` also creates `store-wp-salts` (8 keys, create-if-missing). ADR 003.
  - Verified: pod 1/1 with 0 restarts; `curl -sI http://shop.localtest.me/` returns 302 to `/wp-admin/install.php`; `id` shows uid 33; `wp-content/.persist-check` survived `kubectl delete pod`; `make secrets` rerun skips; `make lint` ok.
- **In progress:** none. PLAN.md box 2 ticked. The "Probes + requests/limits on all of it" box stays unticked until the setup Job has them.
- **Next step:** `1 setup job` (WP-CLI Job: install WP, WooCommerce, COD, 3 products, integration user + Application Password into Secret `woo-api`, ServiceAccount/Role limited to that Secret).
- **Gotchas learned:**
  - The official image's entrypoint copies core with `tar`, which exits 2 as non-root. The first start crashed once. Fixed with a `copy-core` init container using `cp -rn` (ADR 003, `.claude/rules/store.md`).
  - Readiness on `/wp-login.php` shows a kubelet "ProbeWarning: terminated redirects" before install. That is expected and counts as ready.
  - Image pull of wordpress took about 65s on first deploy; the 5 min startupProbe covers it.
  - The Job's WP-CLI image must match core 7.1.3, run as uid 33, and mount its own emptyDir plus the same wp-content PVC and DB env. Set `WP_ENVIRONMENT_TYPE=local` so Application Passwords work over HTTP. WordPress is not installed yet, so `install.php` is where the Job starts.
  - `CLAUDE.md` has an uncommitted change from before this session. I left it out of the commits.
- **Files the next task needs:** CLAUDE.md, docs/PLAN.md (Phase 1), `.claude/rules/store.md`, `.claude/rules/kubernetes.md`, `charts/store/values.yaml`, `charts/store/templates/wordpress-deployment.yaml` (env, init container, volumes pattern), `docs/decisions/003-wordpress-core-vs-content.md`.
