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
- woo-mcp references the `woo-api` Secret; its pod waits in CreateContainerConfigError and kubelet retries until the Job creates the Secret. No special code needed.
- Never use `helm --wait` when a workload depends on a hook-created Secret.
- woo-mcp uses WooCommerce REST API v3 (`/wp-json/wc/v3/...`) with Basic auth from the Application Password Secret. Map REST errors to MCP tool errors (`isError: true`) with a readable message; never crash the process.
