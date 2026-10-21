#!/usr/bin/env bash
# Registers woo (token), fx and notes in the gateway through its admin API (same calls the dashboard makes).
# Safe to re-run: an existing server is PATCHed (url + credential, never `enabled`). Prints no secrets.
# Secrets reach jq through environment variables, never as command-line arguments (those show up in `ps`).
set -euo pipefail

NS="${NS:-urumi}"
# shellcheck source=lib/kube.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/kube.sh"
BASE="${GATEWAY_URL:-http://app.localtest.me}"

# The admin password and the upstream tokens travel in these requests: plain http only for local hosts.
host="${BASE#*://}"
host="${host%%/*}"
host="${host%%:*}"
case "$BASE" in
  https://*) ;;
  http://*)
    case "$host" in
      localhost | 127.0.0.1 | *.localtest.me) ;;
      *) echo "refusing GATEWAY_URL=$BASE: use https unless the host is localhost, 127.0.0.1 or *.localtest.me" >&2; exit 1 ;;
    esac
    ;;
  *) echo "GATEWAY_URL must start with http:// or https://" >&2; exit 1 ;;
esac

secret() { kubectl -n "$NS" get secret "$1" -o jsonpath="{.data.$2}" | base64 -d; }

ADMIN_EMAIL="$(secret gateway-app admin-email)"
ADMIN_PASSWORD="$(secret gateway-app admin-password)"
WOO_TOKEN="$(secret woo-mcp-token token)"
FX_TOKEN="$(secret fx-mcp-token token)"
NOTES_KEY="$(secret notes-mcp-key key)"

JAR="$(mktemp)"
cleanup() {
  curl -s -o /dev/null -b "$JAR" -X POST -H 'Content-Type: application/json' --data '{}' "$BASE/api/auth/logout" || true
  rm -f "$JAR"
}
trap cleanup EXIT

E="$ADMIN_EMAIL" P="$ADMIN_PASSWORD" jq -n '{email:env.E,password:env.P}' |
  curl -fsS -o /dev/null -c "$JAR" -H 'Content-Type: application/json' --data @- "$BASE/api/auth/login"

list_servers() { curl -fsS -b "$JAR" "$BASE/api/servers"; }

# send <METHOD> <path> reads the JSON body from stdin. Sets $code and $reply (the response body).
send() {
  local out
  out="$(curl -sS -w '\n%{http_code}' -b "$JAR" -X "$1" -H 'Content-Type: application/json' --data @- "$BASE$2")"
  code="${out##*$'\n'}"
  reply="${out%$'\n'*}"
}

# register <slug> <url> <auth-json>
register() {
  local slug="$1" url="$2" auth="$3" current enabled action body
  current="$(list_servers)"
  if [ "$(echo "$current" | jq --arg s "$slug" 'any(.[]; .slug == $s)')" = "true" ]; then
    # PATCH sends url and auth together (the gateway requires it) and leaves `enabled` alone.
    enabled="$(echo "$current" | jq -r --arg s "$slug" '.[] | select(.slug == $s) | .enabled' | tr -d '\r')"
    body="$(U="$url" A="$auth" jq -n '{url:env.U,auth:(env.A|fromjson)}')"
    send PATCH "/api/servers/$slug" <<<"$body" # not a pipe: send sets $code in this shell
    if [ "$enabled" = "false" ]; then action="disabled, left as is"; else action="updated"; fi
  else
    body="$(S="$slug" U="$url" A="$auth" jq -n '{slug:env.S,url:env.U,enabled:true,auth:(env.A|fromjson)}')"
    send POST "/api/servers" <<<"$body"
    action="created"
  fi
  case "$code" in
    200 | 201) echo "$slug: $action" ;;
    *) echo "$slug: registration failed (HTTP $code): $(echo "$reply" | jq -r '.error // "no error field"' 2>/dev/null | tr -d '\r')" >&2; exit 1 ;;
  esac
}

register woo "http://woo-mcp:3000/mcp" "$(T="$WOO_TOKEN" jq -n '{type:"bearer",token:env.T}')"
# Members get woo's read tools only (ADR 022). A deleted and re-added woo has lost its rules, so put the
# defaults back, but only where no rule exists: a rule an admin set (even to false) is never touched.
for tool in create_product update_order_status; do
  has_rule="$(list_servers | jq -r --arg t "$tool" '.[] | select(.slug == "woo") | any(.toolRules[]; .tool == $t)' | tr -d '\r')"
  if [ "$has_rule" = "true" ]; then
    echo "woo/$tool: rule already set, left as is"
  else
    send PATCH "/api/servers/woo/tools/$tool" <<<'{"adminOnly":true}'
    [ "$code" = "200" ] || { echo "woo/$tool: could not set the admin-only rule (HTTP $code)" >&2; exit 1; }
    echo "woo/$tool: admin only"
  fi
done

register fx "http://fx-mcp:3000/mcp" "$(T="$FX_TOKEN" jq -n '{type:"bearer",token:env.T}')"
register notes "http://notes-mcp:3000/mcp" "$(V="$NOTES_KEY" jq -n '{type:"header",name:"X-Notes-Key",value:env.V}')"

# Status can lag behind the write: wait up to ~30s for every enabled one of the three to connect.
mine='select(.slug == "woo" or .slug == "fx" or .slug == "notes")'
want="$(list_servers | jq "[.[] | $mine | select(.enabled)] | length" | tr -d '\r')"
n=0
for _ in $(seq 1 30); do
  n="$(list_servers | jq "[.[] | $mine | select(.enabled and .status == \"connected\")] | length" | tr -d '\r')"
  [ "$n" = "$want" ] && break
  sleep 1 # plain sleep; the old `read -t 1` trick was only for Claude Code's Bash tool
done

summary="$(list_servers | jq -r ".[] | $mine | \"\(.slug) \(.status) \(.tools | length)\"" | tr -d '\r')"
if [ "$n" != "$want" ]; then
  echo "not all enabled servers connected within 30s (want $want, got $n); slug status tools:" >&2
  echo "$summary" >&2
  exit 1
fi
echo "$summary"
