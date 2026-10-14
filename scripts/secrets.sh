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
