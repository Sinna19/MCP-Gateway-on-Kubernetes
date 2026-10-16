#!/usr/bin/env bash
# Registers fx and notes in the gateway through its admin API (same calls the dashboard makes).
# Safe to re-run: an existing server is PATCHed (url, credential, enabled=true). Prints no secrets.
set -euo pipefail

NS="${NS:-urumi}"
BASE="${GATEWAY_URL:-http://app.localtest.me}"

secret() { kubectl -n "$NS" get secret "$1" -o jsonpath="{.data.$2}" | base64 -d; }

ADMIN_EMAIL="$(secret gateway-app admin-email)"
ADMIN_PASSWORD="$(secret gateway-app admin-password)"
FX_TOKEN="$(secret fx-mcp-token token)"
NOTES_KEY="$(secret notes-mcp-key key)"

JAR="$(mktemp)"
cleanup() {
  curl -s -o /dev/null -b "$JAR" -X POST -H 'Content-Type: application/json' --data '{}' "$BASE/api/auth/logout" || true
  rm -f "$JAR"
}
trap cleanup EXIT

jq -n --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}' |
  curl -fsS -o /dev/null -c "$JAR" -H 'Content-Type: application/json' --data @- "$BASE/api/auth/login"

list_servers() { curl -fsS -b "$JAR" "$BASE/api/servers"; }

# register <slug> <url> <auth-json>
register() {
  local slug="$1" url="$2" auth="$3" current code body
  current="$(list_servers)"
  if [ "$(echo "$current" | jq --arg s "$slug" 'any(.[]; .slug == $s)')" = "true" ]; then
    local was_enabled
    was_enabled="$(echo "$current" | jq -r --arg s "$slug" '.[] | select(.slug == $s) | .enabled' | tr -d '\r')"
    body="$(jq -n --arg u "$url" --argjson a "$auth" '{url:$u,enabled:true,auth:$a}')"
    code="$(echo "$body" | curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -X PATCH -H 'Content-Type: application/json' --data @- "$BASE/api/servers/$slug")"
    if [ "$was_enabled" = "false" ]; then
      echo "$slug: updated, was disabled and is now enabled (HTTP $code)"
    else
      echo "$slug: updated (HTTP $code)"
    fi
  else
    body="$(jq -n --arg s "$slug" --arg u "$url" --argjson a "$auth" '{slug:$s,url:$u,enabled:true,auth:$a}')"
    code="$(echo "$body" | curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -X POST -H 'Content-Type: application/json' --data @- "$BASE/api/servers")"
    echo "$slug: created (HTTP $code)"
  fi
  case "$code" in 200 | 201) ;; *) echo "$slug: registration failed" >&2; exit 1 ;; esac
}

register fx "http://fx-mcp:3000/mcp" "$(jq -n --arg t "$FX_TOKEN" '{type:"bearer",token:$t}')"
register notes "http://notes-mcp:3000/mcp" "$(jq -n --arg v "$NOTES_KEY" '{type:"header",name:"X-Notes-Key",value:$v}')"

# Status can lag behind the write: wait up to ~30s for both to connect.
for _ in $(seq 1 30); do
  n="$(list_servers | jq '[.[] | select((.slug == "fx" or .slug == "notes") and .status == "connected")] | length' | tr -d '\r')"
  [ "$n" = "2" ] && break
  read -t 1 <> <(:) || true
done

list_servers | jq -r '.[] | "\(.slug) \(.status) \(.tools | length)"' | tr -d '\r'
[ "${n:-0}" = "2" ] || { echo "fx and notes did not both reach connected within 30s" >&2; exit 1; }
