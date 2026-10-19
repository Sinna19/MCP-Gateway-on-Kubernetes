#!/usr/bin/env bash
# Definition-of-done checks against the live cluster (DoD item 4 and 5 of docs/REQUIREMENTS.md).
# Needs a running cluster with woo, fx and notes registered and connected (make deploy && make register).
# Two users: A = the admin, B = the fixed member dod-member@example.com (password in Secret dod-member).
# Prints PASS/FAIL per check, never a key or a password. Exits 1 if any check failed.
# The script scales notes-mcp and disables fx on purpose; the EXIT trap puts both back.
# Env: NS (urumi), GATEWAY_URL (http://app.localtest.me), DOD_CONTEXT (k3d-urumi), DOD_WAIT (60 seconds).
set -euo pipefail

NS="${NS:-urumi}"
BASE="${GATEWAY_URL:-http://app.localtest.me}"
WANT_CONTEXT="${DOD_CONTEXT:-k3d-urumi}"
# The gateway pings upstreams every 5s (3s ping timeout), so a status flips within ~8s. 60s is far above 3x that.
WAIT="${DOD_WAIT:-60}"
B_EMAIL="dod-member@example.com"

# ---- guards (before any kubectl call, because this script scales deployments) ----
ctx="$(kubectl config current-context | tr -d '\r')"
if [ "$ctx" != "$WANT_CONTEXT" ]; then
  echo "refusing to run: kubectl context is '$ctx', expected '$WANT_CONTEXT' (set DOD_CONTEXT to override)" >&2
  exit 1
fi
# The admin password and API keys travel in these requests: plain http only for local hosts.
host="${BASE#*://}"; host="${host%%/*}"; host="${host%%:*}"
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

# ---- temp files (mode 600, removed in the trap) ----
TMPFILES=()
tmpfile() { local f; f="$(mktemp)"; chmod 600 "$f"; TMPFILES+=("$f"); printf '%s' "$f"; }
A_JAR="$(tmpfile)"; B_JAR="$(tmpfile)"; BODYF="$(tmpfile)"; OUTF="$(tmpfile)"; HDRF="$(tmpfile)"

# ---- results ----
FAILS=0; PASSES=0
pass() { PASSES=$((PASSES + 1)); echo "PASS $1: $2"; }
fail() { FAILS=$((FAILS + 1)); echo "FAIL $1: $2"; }

# ---- admin API (cookie jar per user). Sets ACODE and ABODY. ----
api() { # api <jar> <METHOD> <path> [json-body]
  local out="" body="${4:-}"
  if [ "$2" = GET ]; then
    out="$(curl -sS --max-time 20 -w '\n%{http_code}' -b "$1" "$BASE$3")"
  else
    out="$(printf '%s' "${body:-{\}}" | curl -sS --max-time 20 -w '\n%{http_code}' -b "$1" -c "$1" -X "$2" -H 'Content-Type: application/json' --data @- "$BASE$3")"
  fi
  ACODE="${out##*$'\n'}"
  ABODY="${out%$'\n'*}"
}
login() { # login <jar> <email> <password>; the secrets go to jq via env, not argv
  E="$2" P="$3" jq -n '{email:env.E,password:env.P}' |
    curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -c "$1" -H 'Content-Type: application/json' --data @- "$BASE/api/auth/login"
}
secret() { kubectl -n "$NS" get secret "$1" -o jsonpath="{.data.$2}" | base64 -d; }
servers() { api "$A_JAR" GET /api/servers; printf '%s' "$ABODY"; }
srv_field() { servers | jq -r --arg s "$1" ".[] | select(.slug == \$s) | .$2" | tr -d '\r'; }

# ---- keys: remembered so the trap can revoke them ----
KEY_IDS=()
KEY="" KEY_ID=""
new_key() { # new_key <jar> <name> sets KEY and KEY_ID
  api "$1" POST /api/keys "$(N="$2" jq -n '{name:env.N}')"
  [ "$ACODE" = 201 ] || { echo "could not create key (HTTP $ACODE)" >&2; return 1; }
  KEY="$(printf '%s' "$ABODY" | jq -r .key | tr -d '\r')"
  KEY_ID="$(printf '%s' "$ABODY" | jq -r .id | tr -d '\r')"
  KEY_IDS+=("$KEY_ID")
}

# ---- tiny MCP client. Sets CODE, SESS and REPLY (the JSON-RPC message whose id matches the request). ----
CALLS=0; NEXT_ID=1
declare -A PER_KEY=()
mcp_post() { # mcp_post <key> <session-or-empty> <json-body> <id-or-empty>
  local key="$1" sess="$2" id="$4" raw sh=()
  CALLS=$((CALLS + 1)); PER_KEY[$key]=$(( ${PER_KEY[$key]:-0} + 1 ))
  printf '%s' "$3" >"$BODYF"
  [ -n "$sess" ] && sh=(-H "Mcp-Session-Id: $sess")
  # The key goes through curl's config on stdin, so it never appears in the process list.
  CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$key" |
    curl -sS --max-time 30 -K - -o "$OUTF" -D "$HDRF" -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
      "${sh[@]}" --data @"$BODYF" "$BASE/mcp")" || CODE=000
  SESS="$(tr -d '\r' <"$HDRF" | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}')"
  REPLY=""
  if [ -n "$id" ]; then
    # A reply is plain JSON or SSE with several data: lines; take the message with our id.
    if grep -q '^data:' "$OUTF"; then
      REPLY="$(sed -n 's/^data: *//p' "$OUTF" | tr -d '\r' | jq -c --argjson id "$id" 'select(.id == $id)' 2>/dev/null | head -n1 || true)"
    else
      REPLY="$(tr -d '\r' <"$OUTF" | jq -c --argjson id "$id" 'select(.id == $id)' 2>/dev/null | head -n1 || true)"
    fi
  fi
}
mcp_open() { # mcp_open <key>: initialize + initialized. Sets MCP_SESSION; returns 1 if refused.
  MCP_SESSION=""
  mcp_post "$1" "" '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"dod-check","version":"1"}}}' 0
  [ "$CODE" = 200 ] || return 1
  MCP_SESSION="$SESS"
  mcp_post "$1" "$MCP_SESSION" '{"jsonrpc":"2.0","method":"notifications/initialized"}' ""
}
mcp_rpc() { # mcp_rpc <key> <session> <method> <params-json>
  local id="$NEXT_ID"
  NEXT_ID=$((NEXT_ID + 1))
  mcp_post "$1" "$2" "$(M="$3" P="$4" I="$id" jq -nc '{jsonrpc:"2.0",id:(env.I|tonumber),method:env.M,params:(env.P|fromjson)}')" "$id"
}
tool_names() { printf '%s' "$REPLY" | jq -r '.result.tools[]?.name' | tr -d '\r'; }
call_ok() { # call_ok <key> <session> <tool>: true when the tool call succeeded
  mcp_rpc "$1" "$2" tools/call "$(T="$3" jq -nc '{name:env.T,arguments:{}}')"
  [ "$CODE" = 200 ] && [ -n "$REPLY" ] && [ "$(printf '%s' "$REPLY" | jq -r '(.error != null) or (.result.isError == true)')" = false ]
}

# ---- wait loop with a deadline ----
LAST=""
wait_until() { # wait_until <check-name> <function>; the function sets LAST and returns 0 when satisfied
  local end=$((SECONDS + WAIT))
  while :; do
    "$2" && return 0
    if [ "$SECONDS" -ge "$end" ]; then fail "$1" "timed out after ${WAIT}s, last: ${LAST:-nothing}"; return 1; fi
    sleep 1
  done
}
W_SLUG=""; W_VAL=""
cond_status() { LAST="$(srv_field "$W_SLUG" status)"; [ "$LAST" = "$W_VAL" ]; }
wait_status() { W_SLUG="$1"; W_VAL="$2"; wait_until "$3" cond_status; }

# ---- cleanup: put back whatever a check changed. Runs on any exit. ----
FX_WAS_ENABLED=true; NOTES_REPLICAS=1; B_ID=""; TOUCHED=false
cleanup() {
  set +e
  if [ "$TOUCHED" = true ]; then
    kubectl -n "$NS" scale deploy/notes-mcp --replicas="$NOTES_REPLICAS" >/dev/null 2>&1
    api "$A_JAR" PATCH /api/servers/fx "{\"enabled\":$FX_WAS_ENABLED}"
    [ -n "$B_ID" ] && api "$A_JAR" PATCH "/api/members/$B_ID" '{"disabled":false}'
    for id in "${KEY_IDS[@]}"; do api "$A_JAR" DELETE "/api/keys/$id"; done
  fi
  api "$A_JAR" POST /api/auth/logout
  api "$B_JAR" POST /api/auth/logout
  rm -f "${TMPFILES[@]}"
}
trap cleanup EXIT

# ================= setup =================
A_EMAIL="$(secret gateway-app admin-email | tr -d '\r')"
A_PASSWORD="$(secret gateway-app admin-password)"
code="$(login "$A_JAR" "$A_EMAIL" "$A_PASSWORD")"
[ "$code" = 200 ] || { echo "admin login failed (HTTP $code); is the cluster up and 'make register' done?" >&2; exit 1; }
api "$A_JAR" GET /api/me
A_ID="$(printf '%s' "$ABODY" | jq -r .id | tr -d '\r')"

for s in woo fx notes; do
  if [ "$(srv_field "$s" enabled)" != true ] || [ "$(srv_field "$s" status)" != connected ]; then
    echo "start state: '$s' must be enabled and connected (run make register)" >&2; exit 1
  fi
done
NOTES_REPLICAS="$(kubectl -n "$NS" get deploy/notes-mcp -o jsonpath='{.spec.replicas}' | tr -d '\r')"
TOUCHED=true

# User B: one fixed member. Secret dod-member holds the password (create if missing, never printed).
if ! kubectl -n "$NS" get secret dod-member >/dev/null 2>&1; then
  kubectl -n "$NS" create secret generic dod-member --from-literal=password="$(openssl rand -hex 16)" >/dev/null
fi
B_PASSWORD="$(secret dod-member password)"
api "$A_JAR" GET /api/members
B_ID="$(printf '%s' "$ABODY" | jq -r --arg e "$B_EMAIL" '.[] | select(.email == $e) | .id' | tr -d '\r')"
if [ -z "$B_ID" ]; then
  api "$A_JAR" POST /api/invites "$(E="$B_EMAIL" jq -nc '{email:env.E,role:"member"}')"
  [ "$ACODE" = 201 ] || { echo "invite failed (HTTP $ACODE)" >&2; exit 1; }
  token="$(printf '%s' "$ABODY" | jq -r .path | tr -d '\r')"; token="${token##*/}"
  P="$B_PASSWORD" jq -n '{password:env.P}' |
    curl -sS --max-time 20 -o /dev/null -c "$B_JAR" -H 'Content-Type: application/json' --data @- "$BASE/api/invites/$token/accept"
  api "$A_JAR" GET /api/members
  B_ID="$(printf '%s' "$ABODY" | jq -r --arg e "$B_EMAIL" '.[] | select(.email == $e) | .id' | tr -d '\r')"
fi
api "$A_JAR" PATCH "/api/members/$B_ID" '{"disabled":false}' # no-op unless B was left disabled
code="$(login "$B_JAR" "$B_EMAIL" "$B_PASSWORD")"
[ "$code" = 200 ] || { echo "login as $B_EMAIL failed (HTTP $code); if Secret dod-member was recreated, the stored password no longer matches the member" >&2; exit 1; }

api "$A_JAR" GET "/api/audit?limit=1"
START_ID="$(printf '%s' "$ABODY" | jq -r '(.[0].id // "0") | tonumber')"
new_key "$A_JAR" "dod-check A"; A_KEY="$KEY"
new_key "$B_JAR" "dod-check B1"; B1_KEY="$KEY"; B1_ID="$KEY_ID"
mcp_open "$A_KEY" && A_SESS="$MCP_SESSION" || { echo "admin key could not open an MCP session (HTTP $CODE)" >&2; exit 1; }
mcp_open "$B1_KEY" && B1_SESS="$MCP_SESSION" || { echo "member key could not open an MCP session (HTTP $CODE)" >&2; exit 1; }

# ================= a. tools-all-enabled =================
mcp_rpc "$B1_KEY" "$B1_SESS" tools/list '{}'
names="$(tool_names)"
enabled="$(servers | jq -r '.[] | select(.enabled) | .slug' | tr -d '\r')"
missing=""
for s in $enabled; do grep -q "^${s}__" <<<"$names" || missing="$missing $s"; done
if [ -z "$missing" ] && [ -n "$enabled" ]; then pass a-tools-all-enabled "B sees tools from: $(echo $enabled)"; else fail a-tools-all-enabled "no tools for:${missing:- (no enabled servers)}"; fi

# ================= b. calls-ok =================
bad=""
for t in woo__list_orders fx__list_rates notes__list_notes; do call_ok "$B1_KEY" "$B1_SESS" "$t" || bad="$bad B:$t"; done
call_ok "$A_KEY" "$A_SESS" woo__list_products || bad="$bad A:woo__list_products"
if [ -z "$bad" ]; then pass b-calls-ok "3 calls as B, 1 as A"; else fail b-calls-ok "failed:$bad (HTTP $CODE)"; fi

# ================= c. audit-per-user =================
AUDIT_FILTER='
  def has($s; $t; $e): any(.[]; .server == $s and (.tool | endswith($t)) and .source == "mcp" and .user == $e and ((.id | tonumber) > $start));'
cond_audit() {
  api "$A_JAR" GET "/api/audit?user=$B_ID&limit=50"; local b="$ABODY"
  api "$A_JAR" GET "/api/audit?user=$A_ID&limit=50"; local a="$ABODY"
  LAST="B rows: $(printf '%s' "$b" | jq -r --argjson start "$START_ID" '[.[] | select((.id|tonumber) > $start)] | length') new"
  printf '%s' "$b" | jq -e --argjson start "$START_ID" --arg e "$B_EMAIL" "$AUDIT_FILTER"'
      has("woo";"list_orders";$e) and has("fx";"list_rates";$e) and has("notes";"list_notes";$e)' >/dev/null &&
  printf '%s' "$a" | jq -e --argjson start "$START_ID" --arg e "$A_EMAIL" "$AUDIT_FILTER"'
      has("woo";"list_products";$e)' >/dev/null &&
  printf '%s' "$b" | jq -e --argjson start "$START_ID" "$AUDIT_FILTER"'
      any(.[]; (.id|tonumber) > $start and (.tool | endswith("list_products"))) | not' >/dev/null
}
if wait_until c-audit-per-user cond_audit; then pass c-audit-per-user "B's 3 calls under $B_EMAIL, A's call under $A_EMAIL, none crossed"; fi

# ================= d. disable-hides-tools =================
api "$A_JAR" PATCH /api/servers/fx '{"enabled":false}'
cond_fx_gone() {
  mcp_rpc "$B1_KEY" "$B1_SESS" tools/list '{}'
  local n; n="$(tool_names)"
  LAST="HTTP $CODE, $(grep -c '^fx__' <<<"$n" || true) fx tools"
  [ "$CODE" = 200 ] && ! grep -q '^fx__' <<<"$n"
}
if wait_until d-disable-hides-tools cond_fx_gone; then
  if call_ok "$B1_KEY" "$B1_SESS" fx__list_rates; then fail d-disable-hides-tools "fx tool was still callable"
  else pass d-disable-hides-tools "no fx__ tools for B, fx__list_rates rejected"; fi
fi

# ================= e. register-keeps-disabled =================
if reg_out="$("$(dirname "$0")/register-upstreams.sh" 2>&1)"; then
  if [ "$(srv_field fx enabled)" = false ] && [ "$(srv_field fx status)" = disabled ]; then pass e-register-keeps-disabled "fx still disabled after register"
  else fail e-register-keeps-disabled "fx is enabled=$(srv_field fx enabled) status=$(srv_field fx status)"; fi
else
  # register exits 1 when an enabled server is down; with fx disabled it should still succeed
  fail e-register-keeps-disabled "register-upstreams.sh failed: $(printf '%s' "$reg_out" | tail -n1)"
fi
api "$A_JAR" PATCH /api/servers/fx '{"enabled":true}'
wait_status fx connected e-fx-back || true

# ================= f. dead-upstream-isolated =================
kubectl -n "$NS" scale deploy/notes-mcp --replicas=0 >/dev/null
if wait_status notes unreachable f-dead-upstream-isolated; then
  mcp_rpc "$B1_KEY" "$B1_SESS" tools/list '{}'
  names="$(tool_names)"
  if grep -q '^woo__' <<<"$names" && grep -q '^fx__' <<<"$names" && call_ok "$B1_KEY" "$B1_SESS" woo__list_orders; then
    pass f-dead-upstream-isolated "notes unreachable; B still lists woo + fx and woo__list_orders works"
  else
    fail f-dead-upstream-isolated "notes is down and B lost woo/fx tools or the woo call failed"
  fi
fi
kubectl -n "$NS" scale deploy/notes-mcp --replicas="$NOTES_REPLICAS" >/dev/null
wait_status notes connected f-notes-back || true

# ================= g. revoke-rejects =================
api "$A_JAR" DELETE "/api/keys/$B1_ID"
mcp_rpc "$B1_KEY" "$B1_SESS" tools/list '{}'; open_code="$CODE"
mcp_open "$B1_KEY" && fresh=ok || fresh="$CODE"
if [ "$open_code" = 401 ] && [ "$fresh" = 401 ]; then pass g-revoke-rejects "open session and new initialize both 401 after revoke"
else fail g-revoke-rejects "open session HTTP $open_code, fresh initialize HTTP $fresh (want 401 and 401)"; fi

# ================= h. user-disable-rejects =================
new_key "$B_JAR" "dod-check B2"; B2_KEY="$KEY"
if mcp_open "$B2_KEY"; then
  B2_SESS="$MCP_SESSION"
  api "$A_JAR" PATCH "/api/members/$B_ID" '{"disabled":true}'
  mcp_rpc "$B2_KEY" "$B2_SESS" tools/list '{}'; open_code="$CODE"
  mcp_open "$B2_KEY" && fresh=ok || fresh="$CODE"
  if [ "$open_code" = 401 ] && [ "$fresh" = 401 ]; then pass h-user-disable-rejects "open session and new initialize both 401 while B is disabled"
  else fail h-user-disable-rejects "open session HTTP $open_code, fresh initialize HTTP $fresh (want 401 and 401)"; fi
  api "$A_JAR" PATCH "/api/members/$B_ID" '{"disabled":false}'
else
  fail h-user-disable-rejects "B's second key could not open a session (HTTP $CODE)"
fi

# ================= summary =================
max=0; for k in "${!PER_KEY[@]}"; do [ "${PER_KEY[$k]}" -gt "$max" ] && max="${PER_KEY[$k]}"; done
echo "mcp requests: $CALLS total, $max on the busiest key (keep the 7c per-key limit above this)"
echo "$PASSES passed, $FAILS failed"
[ "$FAILS" -eq 0 ]
