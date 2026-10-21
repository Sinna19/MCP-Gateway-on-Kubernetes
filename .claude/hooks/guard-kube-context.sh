#!/usr/bin/env bash
# PreToolUse (Bash): guards commands that change a cluster. Only k3d-* and urumi-vps are allowed contexts (ADR 024).
#   read-only kubectl/helm      -> allowed without a check (get, describe, logs, top, history, status)
#   explicit k3d-* context      -> allow
#   anything touching urumi-vps -> ask (explicit context, ENV=prod, KUBE_CONTEXT=urumi-vps, KUBECONFIG=, push-images, k3s ctr)
#   any other explicit context  -> deny
#   no context named            -> allow if the current context is k3d-*, else deny
# GUARD_CURRENT_CONTEXT replaces `kubectl config current-context`; the fixture tests use it.
input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")

mutating='(^|[;&| ])(kubectl[^;&|]*[[:space:]](apply|delete|patch|scale|edit|replace|rollout[[:space:]]+restart|create|drain|cordon|uncordon|taint|exec|cp|label|annotate|set|run|rollout[[:space:]]+undo)|helm[^;&|]*[[:space:]](install|upgrade|uninstall|rollback))([[:space:]]|$)'
# Commands that act on the VPS without a kubectl/helm verb in them. A read-only kubectl on urumi-vps is not one.
vps_action='ENV=prod|KUBE_CONTEXT=urumi-vps|push-images\.sh|k3s[[:space:]]+(ctr|kubectl)|ssh[^;&|]*azureuser@'
prod_marker="$vps_action|KUBECONFIG=|urumi-vps"
if ! grep -Eq -- "$mutating|$vps_action" <<<"$cmd"; then
  exit 0
fi

decision=allow
reason=""
raise() { # raise <ask|deny> <reason>: keep the strictest decision
  if [ "$1" = deny ] || [ "$decision" = allow ]; then decision="$1"; reason="$2"; fi
}

named=$(grep -Eo -- '--(kube-)?context[= ]+[^[:space:];&|]+' <<<"$cmd" | sed -E 's/^--(kube-)?context[= ]+//' | tr -d "\"'")
for c in $named; do
  case "$c" in
    k3d-*) ;;
    urumi-vps) raise ask "Command targets the VPS (--context urumi-vps); confirm it is intended." ;;
    *) raise deny "Kube context '$c' is not allowed: only k3d-* and urumi-vps." ;;
  esac
done

if [ "$decision" = allow ] && grep -Eq -- "$prod_marker" <<<"$cmd"; then
  raise ask "Command touches the VPS (ENV=prod, urumi-vps, KUBECONFIG, push-images or k3s ctr); confirm it is intended."
fi

if [ "$decision" = allow ] && [ -z "$named" ]; then
  ctx=${GUARD_CURRENT_CONTEXT:-$(kubectl config current-context 2>/dev/null | tr -d '\r' || echo unknown)}
  case "$ctx" in
    k3d-*) ;;
    *) raise deny "Current kube context is '${ctx:-unknown}', not k3d-*. The default context must stay local k3d." ;;
  esac
fi

[ "$decision" = allow ] && exit 0
jq -n --arg d "$decision" --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
exit 0
