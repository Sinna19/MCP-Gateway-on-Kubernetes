---
paths:
  - "charts/store/**"
  - "services/woo-mcp/**"
---
# WordPress / WooCommerce gotchas

- Application Passwords are disabled over plain HTTP unless `WP_ENVIRONMENT_TYPE=local` or a mu-plugin returns true for `wp_is_application_passwords_available`. In-cluster traffic is HTTP.
- WordPress stores its site URL in the DB; set `WP_HOME`/`WP_SITEURL` from values so local and prod hosts both work.
- Setup runs as a normal Job, not a Helm hook. Name it with `{{ .Release.Revision }}` (Job specs are immutable, so a fixed name breaks `helm upgrade`). It must still be idempotent (check before install/create).
- The WP-CLI setup Job needs WP core too: it mounts its own emptyDir plus the same wp-content PVC and the DB env, copies core the same way as the `copy-core` init container in `wordpress-deployment.yaml`, and its image must match the WordPress core version (`wordpress.image`, ADR 003). Run it as uid 33 so files on the PVC stay owned by www-data. RWO is fine only because the Job and WordPress share one node.
- The image entrypoint's `tar` copy fails as non-root (exit 2); core is copied by an init container with `cp -rn` instead.
- `woo-api` is pre-created by `scripts/secrets.sh` with only `username`; the setup Job (Role: get/patch on that name only, ADR 004) adds `password`. woo-mcp's `secretKeyRef` on `password` waits in CreateContainerConfigError until then. No special code needed.
- New WooCommerce stores start in "coming soon" mode; the setup script sets `woocommerce_coming_soon=no`. Plain permalinks 404 `/shop/` and `/wp-json/`, so it also sets `/%postname%/`. Every `wp wc` call needs `--user`.
- Never use `helm --wait` when a workload depends on a hook-created Secret.
- woo-mcp uses WooCommerce REST API v3 (`/wp-json/wc/v3/...`) with Basic auth from the Application Password Secret. Map REST errors to MCP tool errors (`isError: true`) with a readable message; never crash the process.
