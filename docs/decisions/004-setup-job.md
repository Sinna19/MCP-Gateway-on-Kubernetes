# 004: Store setup is a plain, idempotent Job with a narrowly scoped Role

## Status
Accepted

## Context
After WordPress starts, something must install it and WooCommerce, enable COD, add products, create the
integration user, and hand its Application Password to woo-mcp via Secret `woo-api`.

## Decision
- **Plain Job, not a Helm hook**, named `setup-<release revision>` (Job specs are immutable, so a fixed name
  breaks `helm upgrade`). `ttlSecondsAfterFinished: 600`, `backoffLimit: 3`, `activeDeadlineSeconds: 900`.
  Every step in `charts/store/files/setup.sh` checks before it acts, so each upgrade can rerun it.
- **Core from the WordPress image, `wp` from the cli image.** An init container `copy-core` copies core from
  `wordpress.image` (with `/usr/src/wordpress/.`, not a `*` glob, so dotfiles come along), so the core version
  always matches (ADR 003). The `wordpress:cli` image only supplies the `wp` binary. It runs as uid 33 so files
  on the wp-content PVC stay owned by www-data. RWO is fine because the Job and WordPress share one node.
- **Shared env.** The helper `store.wordpressEnv` gives the Deployment and the Job the same DB, salts and
  config. `WP_ENVIRONMENT_TYPE` comes from values (`local` lets Application Passwords work over HTTP).
- **Permalinks `/%postname%/`.** With plain permalinks `/shop/` and `/wp-json/wc/v3/` return 404. The `.htaccess`
  apache reads is written by the image entrypoint in the WordPress pod's own core volume (the Job's is separate).
- **Every `wp wc` call has `--user=<admin>`.** The WooCommerce CLI goes through REST and fails without a user.
- **Integration user** `woo-mcp` has role `shop_manager`: products and orders over REST v3, no plugins or users.

## The Secret and the RBAC
Kubernetes RBAC cannot limit `create` to one Secret name (the name is not known when the request is
authorised). A Job that creates `woo-api` itself would need `create` on all Secrets in the namespace,
so a compromised Job could plant or overwrite any Secret.
So `scripts/secrets.sh` creates `woo-api` first, with only the key `username`. The Job's Role is:
`get` + `patch` on `secrets`, `resourceNames: [woo-api]`. Nothing else, not even the other store Secrets.
- No `password` key until the Job fills it, so woo-mcp's `secretKeyRef` keeps its pod waiting rather than
  starting with a blank password.
- If `password` is set the Job skips. If it is empty, the Job deletes any old application password named
  `woo-mcp` (a previous run may have died before patching), creates a new one, and patches the Secret.
  The patch body goes in on stdin, so the password never appears in a process list.
- ServiceAccount `store-setup` is used only by the Job. The WordPress pod keeps `default` with no extra rights.

## Why not the alternatives
- **Helm hook**: hooks are not part of the release, are awkward with `--wait`, and hide failures.
- **kubectl container applying a manifest**: a second image, and the kubectl image has no shell, so
  "skip if it already exists" is hard to write. curl is already in the cli image.
- **Job creates the Secret**: needs `create` on all Secrets (above).

## Consequences
- No probes on the Job (it is run-to-completion). It has requests/limits plus a deadline and backoff limit.
- Rotating the integration credential: patch `woo-api` to remove `password`, then `helm upgrade`.
- Wiping the cluster also loses `woo-api`; `make secrets` recreates it empty and the Job refills it.

## Recovery
If the setup Job regenerates the `woo-api` password (for example after the WordPress database was lost, or
after you removed `password` from the Secret), run `kubectl -n urumi rollout restart deploy/woo-mcp`. The
password is an env var, which the container reads only at startup, so the running pod keeps the old one and
stays NotReady (its `/readyz` gets 401s) until it restarts.
