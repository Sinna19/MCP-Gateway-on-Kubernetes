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

# Gateway Postgres password. Hex so it is safe inside DATABASE_URL.
if kubectl -n "$NS" get secret gateway-db >/dev/null 2>&1; then
  echo "secret gateway-db: exists, skipped"
else
  # A new random password would not match a database that already initialised with the lost one.
  if kubectl -n "$NS" get pvc data-gateway-postgres-0 >/dev/null 2>&1; then
    echo "gateway-db is missing but PVC data-gateway-postgres-0 exists: a new password would not match the initialised database. Restore the Secret, or delete the PVC to start fresh." >&2
    exit 1
  fi
  kubectl -n "$NS" create secret generic gateway-db \
    --from-literal=password="$(openssl rand -hex 16)" >/dev/null
  echo "secret gateway-db: created"
fi

# Bearer token fx-mcp requires on /mcp (32 random bytes as hex = 64 chars; fx-mcp refuses anything under 32).
# The admin pastes it into the gateway when registering fx. Read it with:
#   kubectl -n urumi get secret fx-mcp-token -o jsonpath='{.data.token}' | base64 -d
if kubectl -n "$NS" get secret fx-mcp-token >/dev/null 2>&1; then
  echo "secret fx-mcp-token: exists, skipped"
else
  kubectl -n "$NS" create secret generic fx-mcp-token \
    --from-literal=token="$(openssl rand -hex 32)" >/dev/null
  echo "secret fx-mcp-token: created"
fi

# Gateway app secrets: AES key for upstream credentials (32 bytes, base64) and the bootstrap admin login.
# Read the admin password with:
#   kubectl -n urumi get secret gateway-app -o jsonpath='{.data.admin-password}' | base64 -d
if kubectl -n "$NS" get secret gateway-app >/dev/null 2>&1; then
  echo "secret gateway-app: exists, skipped"
else
  kubectl -n "$NS" create secret generic gateway-app \
    --from-literal=credentials-key="$(openssl rand -base64 32)" \
    --from-literal=admin-email=admin@urumi.local \
    --from-literal=admin-password="$(openssl rand -hex 16)" >/dev/null
  echo "secret gateway-app: created"
fi
