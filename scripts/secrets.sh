#!/usr/bin/env bash
# Creates Secrets the charts reference by name. Create-if-missing, so re-running never rotates a
# password the database already initialised with. Prints names only, never values. See ADR 002.
set -euo pipefail

NS="${NS:-urumi}"

kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create ns "$NS" >/dev/null

if kubectl -n "$NS" get secret store-db >/dev/null 2>&1; then
  echo "secret store-db: exists, skipped"
else
  kubectl -n "$NS" create secret generic store-db \
    --from-literal=root-password="$(openssl rand -hex 16)" \
    --from-literal=password="$(openssl rand -hex 16)" >/dev/null
  echo "secret store-db: created"
fi

# WordPress auth keys/salts. Fixed so logins and carts survive pod restarts (ADR 003).
if kubectl -n "$NS" get secret store-wp-salts >/dev/null 2>&1; then
  echo "secret store-wp-salts: exists, skipped"
else
  args=()
  for k in auth-key secure-auth-key logged-in-key nonce-key auth-salt secure-auth-salt logged-in-salt nonce-salt; do
    args+=("--from-literal=$k=$(openssl rand -hex 32)")
  done
  kubectl -n "$NS" create secret generic store-wp-salts "${args[@]}" >/dev/null
  echo "secret store-wp-salts: created"
fi

# WP admin login, used by the setup Job and by you to open WP admin. Read it with:
#   kubectl -n urumi get secret store-wp-admin -o jsonpath='{.data.password}' | base64 -d
if kubectl -n "$NS" get secret store-wp-admin >/dev/null 2>&1; then
  echo "secret store-wp-admin: exists, skipped"
else
  kubectl -n "$NS" create secret generic store-wp-admin \
    --from-literal=username=admin \
    --from-literal=password="$(openssl rand -hex 16)" >/dev/null
  echo "secret store-wp-admin: created"
fi

# woo-api is created here with no password key, so the setup Job's Role can be get/patch on this one
# name and nothing else (RBAC cannot limit "create" by name). The Job fills in "password". Until then
# woo-mcp's secretKeyRef on "password" keeps its pod waiting. See ADR 004.
if kubectl -n "$NS" get secret woo-api >/dev/null 2>&1; then
  echo "secret woo-api: exists, skipped"
else
  kubectl -n "$NS" create secret generic woo-api --from-literal=username=woo-mcp >/dev/null
  echo "secret woo-api: created"
fi
