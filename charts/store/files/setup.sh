#!/usr/bin/env bash
# Store setup, run by the setup-<revision> Job. Every step checks before it acts, so a rerun changes
# nothing. Secrets are never printed. See docs/decisions/004-setup-job.md.
set -euo pipefail

# Needs: SITE_URL SITE_TITLE ADMIN_EMAIL WC_VERSION INTEGRATION_USER API_SECRET
#        WC_USER WC_PASS (admin login), PRODUCTS_FILE (lines "sku|price|name")
cd /var/www/html

# The cli image ships php without a php.ini, so the default memory_limit (128M) is too small for plugin installs.
WP_BIN="$(command -v wp)"
wp() { php -d memory_limit=512M "$WP_BIN" --path=/var/www/html "$@"; }
log() { echo "setup: $*"; }

log "waiting for the database"
until wp db query 'SELECT 1' >/dev/null 2>&1; do sleep 3; done

if wp core is-installed; then
  log "wordpress: already installed, skipped"
else
  wp core install --url="$SITE_URL" --title="$SITE_TITLE" --admin_user="$WC_USER" \
    --admin_password="$WC_PASS" --admin_email="$ADMIN_EMAIL" --skip-email
  log "wordpress: installed"
fi

if wp plugin is-installed woocommerce; then
  log "woocommerce: already installed, skipped"
else
  wp plugin install woocommerce --version="$WC_VERSION"
  log "woocommerce: installed"
fi
wp plugin is-active woocommerce || { wp plugin activate woocommerce; log "woocommerce: activated"; }

# Plain permalinks make /shop/ and /wp-json/wc/v3/ return 404. The .htaccess that apache reads lives in
# the WordPress pod's own core volume (written by the image entrypoint), not here.
if [ "$(wp option get permalink_structure)" = "/%postname%/" ]; then
  log "permalinks: already set, skipped"
else
  wp rewrite structure '/%postname%/'
  log "permalinks: set"
fi

# New WooCommerce stores start in "coming soon" mode, which hides the storefront from visitors.
wp option update woocommerce_coming_soon no >/dev/null

# Every "wp wc" call goes through REST and needs --user.
if [ -z "$(wp option get woocommerce_shop_page_id 2>/dev/null)" ] || [ "$(wp option get woocommerce_shop_page_id)" = "0" ]; then
  wp wc tool run install_pages --user="$WC_USER" >/dev/null
  log "woocommerce pages: created"
fi

wp wc payment_gateway update cod --enabled=true --user="$WC_USER" >/dev/null
log "cash on delivery: enabled"

# Checkout of physical products needs one shipping method. Zone 0 is "locations not covered by other zones".
if [ -z "$(wp wc shipping_zone_method list 0 --field=id --user="$WC_USER")" ]; then
  wp wc shipping_zone_method create 0 --method_id=flat_rate --user="$WC_USER" >/dev/null
  log "shipping: flat rate added"
else
  log "shipping: already set, skipped"
fi

while IFS='|' read -r sku price name; do
  [ -n "$sku" ] || continue
  if [ -n "$(wp wc product list --sku="$sku" --field=id --user="$WC_USER")" ]; then
    log "product $sku: exists, skipped"
  else
    wp wc product create --name="$name" --sku="$sku" --regular_price="$price" --type=simple \
      --status=publish --user="$WC_USER" >/dev/null
    log "product $sku: created"
  fi
done < "$PRODUCTS_FILE"

if wp user get "$INTEGRATION_USER" >/dev/null 2>&1; then
  log "user $INTEGRATION_USER: exists, skipped"
else
  wp user create "$INTEGRATION_USER" "$INTEGRATION_USER@example.invalid" --role=shop_manager \
    --user_pass="$(php -r 'echo bin2hex(random_bytes(16));')" >/dev/null
  log "user $INTEGRATION_USER: created"
fi

# Secret woo-api already exists (scripts/secrets.sh) with only "username". This Job fills in "password".
SA=/var/run/secrets/kubernetes.io/serviceaccount
SECRET_URL="https://kubernetes.default.svc/api/v1/namespaces/$(cat $SA/namespace)/secrets/$API_SECRET"
kube() { curl -sS --fail --cacert "$SA/ca.crt" -H "Authorization: Bearer $(cat $SA/token)" "$@"; }

# shellcheck disable=SC2016  # the $ signs are PHP variables, not shell
current="$(kube "$SECRET_URL" | php -r '$d = json_decode(stream_get_contents(STDIN), true); echo $d["data"]["password"] ?? "";')"
if [ -n "$current" ]; then
  log "secret $API_SECRET: password already set, skipped"
else
  # Drop any application password of ours (a previous run may have died before patching the Secret).
  wp user application-password list "$INTEGRATION_USER" --fields=uuid,name --format=csv | tail -n +2 |
    while IFS=, read -r uuid name; do
      [ "$name" = "$INTEGRATION_USER" ] && wp user application-password delete "$INTEGRATION_USER" "$uuid" >/dev/null
    done
  app_password="$(wp user application-password create "$INTEGRATION_USER" "$INTEGRATION_USER" --porcelain)"
  # Body goes in on stdin so the password never shows up in a process list.
  printf '{"data":{"password":"%s"}}' "$(printf %s "$app_password" | base64 | tr -d '\n')" |
    kube -X PATCH -H 'Content-Type: application/merge-patch+json' --data-binary @- "$SECRET_URL" >/dev/null
  log "secret $API_SECRET: password written"
fi
log "done"
