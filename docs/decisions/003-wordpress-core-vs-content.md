# 003: WordPress core comes from the image, only wp-content is persistent

## Status
Accepted

## Context
The store needs WordPress data to survive pod restarts, and a pinned, reproducible WordPress version.
The official image copies core into `/var/www/html` on start and generates `wp-config.php` with random
salts if none are given.

## Decision
- Image pinned to `wordpress:7.1.3-php8.3-apache` (latest on Docker Hub on 2026-10-15; exact patch
  version, no floating tag). The setup Job's WP-CLI image must match this core version.
- `/var/www/html` is an `emptyDir`; core is copied from the image on every pod start. Only
  `/var/www/html/wp-content` is a PVC (`store-wordpress-content`).
- Auth keys and salts live in Secret `store-wp-salts`, created by `scripts/secrets.sh` (create-if-missing,
  same pattern as ADR 002) and passed as `WORDPRESS_*_KEY/SALT` env vars. Without this, each restart
  gets new salts and logs everyone out.
- Runs as uid 33 (www-data). `net.ipv4.ip_unprivileged_port_start=0` (a safe sysctl) lets apache bind :80.
- An init container `copy-core` copies core with `cp -rn`. The image entrypoint uses `tar`, which exits 2
  as non-root (it tries to chmod the mount root), so a fresh pod crashed once before working.
- Deployment `strategy: Recreate`, one replica: the PVC is ReadWriteOnce.

## Why not the alternatives
- **PVC on all of `/var/www/html`**: bumping the image tag would not upgrade core, because the old core
  files would sit on the volume.
- **Random salts per start**: logins and carts would not survive a pod delete.

## Consequences
- Upgrading WordPress is a tag bump; the setup Job image must be bumped with it.
- Plugins and uploads (including WooCommerce) persist on the PVC. `cp -n` never overwrites them.
- Brief downtime on every rollout (Recreate). Acceptable for a single-replica store.
