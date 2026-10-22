#!/usr/bin/env bash
# PreToolUse (Bash): guards commands that change a cluster. Only k3d-* and urumi-vps are allowed contexts (ADR 024).
#   read-only kubectl/helm      -> allowed without a check (get, describe, logs, top, history, status)
#   explicit k3d-* context      -> allow
#   anything touching urumi-vps -> ask (explicit context, ENV=prod, KUBE_CONTEXT=urumi-vps, KUBECONFIG=, push-images, k3s ctr)
#   any other explicit context  -> deny
#   no context named            -> allow if the current context is k3d-*, else deny
#   segments of read-only commands (grep, cat, ls, git log...) are ignored unless they run something: a prod name as text is fine
# GUARD_CURRENT_CONTEXT replaces `kubectl config current-context`; the fixture tests use it.
input=$(</dev/stdin) # no `cat`: process start is slow on Windows
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")

# Read-only commands (grep, cat, ls, head, tail, less, wc, rg; git log|diff|show|status|grep|blame) only show text, so a prod
# name inside them is not an action. Their segments are dropped before matching, unless they run something ($( ` <( >( ) or carry a flag that runs or writes (--pre, --ext-diff, --output, -O).
# git is matched only as `git <sub>`: `git -C dir log` stays scanned (stricter is fine). bash builtins only, no extra spawns.
scan=""
t=$cmd
for sep in '&&' '||' ';' '&' '|'; do t=${t//"$sep"/$'\n'}; done
while IFS= read -r seg; do
  read -r w1 w2 _ <<<"$seg"
  readonly_cmd=0
  case "$w1" in
    grep | rg | cat | head | tail | less | ls | wc) readonly_cmd=1 ;;
    git) case "$w2" in log | diff | show | status | grep | blame) readonly_cmd=1 ;; esac ;;
  esac
  case "$seg" in *'$('* | *'`'* | *'<('* | *'>('*) readonly_cmd=0 ;; esac
  # Flags that make a read-only command run a program or write a file (rg --pre, git diff --ext-diff, git grep -O, --output).
  case "$seg" in *--pre* | *--ext-diff* | *--output* | *' -O'* | *--open-files-in-pager*) readonly_cmd=0 ;; esac
  [ "$readonly_cmd" = 0 ] && scan+="$seg"$'\n'
done <<<"$t"

# The patterns run with [[ =~ ]] (same ERE as grep -E, no process to start). $scan has one segment per line, so a newline
# counts as a separator, like ; & |. A backtick, ( or quote before the command also counts (rg --pre 'kubectl ...' runs it): `kubectl ...` and $(kubectl ...) run it.
nl=$'\n'
mutating="(^|[;&| $nl\`('\"])(kubectl[^;&|$nl]*[[:space:]](apply|delete|patch|scale|edit|replace|rollout[[:space:]]+restart|create|drain|cordon|uncordon|taint|exec|cp|label|annotate|set|run|rollout[[:space:]]+undo)|helm[^;&|$nl]*[[:space:]](install|upgrade|uninstall|rollback))([[:space:]]|\$)"
# Commands that act on the VPS without a kubectl/helm verb in them. A read-only kubectl on urumi-vps is not one.
vps_action="ENV=prod|KUBE_CONTEXT=urumi-vps|push-images\.sh|k3s[[:space:]]+(ctr|kubectl)|ssh[^;&|$nl]*azureuser@"
prod_marker="$vps_action|KUBECONFIG=|urumi-vps"
if ! [[ $scan =~ $mutating || $scan =~ $vps_action ]]; then
  exit 0
fi

decision=allow
reason=""
raise() { # raise <ask|deny> <reason>: keep the strictest decision
  if [ "$1" = deny ] || [ "$decision" = allow ]; then decision="$1"; reason="$2"; fi
}

named=""
rest=$scan
context_re='--(kube-)?context[= ]+([^[:space:];&|)]+)'
while [[ $rest =~ $context_re ]]; do
  c=${BASH_REMATCH[2]}
  named+="${named:+ }${c//[\"\'\`]/}" # strip the three quote characters " ' `
  rest=${rest#*"${BASH_REMATCH[0]}"}
done
for c in $named; do
  case "$c" in
    k3d-*) ;;
    urumi-vps) raise ask "Command targets the VPS (--context urumi-vps); confirm it is intended." ;;
    *) raise deny "Kube context '$c' is not allowed: only k3d-* and urumi-vps." ;;
  esac
done

if [ "$decision" = allow ] && [[ $scan =~ $prod_marker ]]; then
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
