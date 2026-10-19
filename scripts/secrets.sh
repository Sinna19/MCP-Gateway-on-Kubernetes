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

# Bearer token woo-mcp requires on /mcp (same shape as fx-mcp-token). `make register` sets it on the woo server.
if kubectl -n "$NS" get secret woo-mcp-token >/dev/null 2>&1; then
  echo "secret woo-mcp-token: exists, skipped"
else
  kubectl -n "$NS" create secret generic woo-mcp-token \
    --from-literal=token="$(openssl rand -hex 32)" >/dev/null
  echo "secret woo-mcp-token: created"
fi

# Static header key notes-mcp requires on /mcp (X-Notes-Key; 32 random bytes as hex; notes-mcp refuses under 32 chars).
# The admin pastes it into the gateway as a header credential. Read it with:
#   kubectl -n urumi get secret notes-mcp-key -o jsonpath='{.data.key}' | base64 -d
if kubectl -n "$NS" get secret notes-mcp-key >/dev/null 2>&1; then
  echo "secret notes-mcp-key: exists, skipped"
else
  kubectl -n "$NS" create secret generic notes-mcp-key \
    --from-literal=key="$(openssl rand -hex 32)" >/dev/null
  echo "secret notes-mcp-key: created"
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

# LLM key for the chat agent (optional). Chat answers 503 until this Secret exists. Preferred: create it
# yourself before `make deploy`, so the key never goes through argv (docs/REHEARSAL.md step 4 has the one-liner).
# Fallback below: when LLM_API_KEY is set in your shell this script creates it, but then the key is briefly
# in the kubectl process args (--from-literal):
#   read -rs LLM_API_KEY; export LLM_API_KEY; scripts/secrets.sh; unset LLM_API_KEY
# Wrong key typed? kubectl -n urumi delete secret llm-api, then repeat. Restart the gateway to pick it up.
if kubectl -n "$NS" get secret llm-api >/dev/null 2>&1; then
  echo "secret llm-api: exists, skipped"
elif [ -n "${LLM_API_KEY:-}" ]; then
  kubectl -n "$NS" create secret generic llm-api --from-literal=api-key="$LLM_API_KEY" >/dev/null
  echo "secret llm-api: created"
else
  echo "secret llm-api: LLM_API_KEY not set, skipped (chat disabled)"
fi
