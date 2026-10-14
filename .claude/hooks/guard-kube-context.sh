#!/usr/bin/env bash
# PreToolUse (Bash): mutating kubectl/helm commands against anything other than the local
# k3d cluster require explicit approval. Protects the VPS during phase 8.
input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")

if ! grep -Eq '(^|[;&| ])(kubectl[^;&|]*[[:space:]](apply|delete|patch|scale|edit|replace|rollout[[:space:]]+restart|create|drain|cordon)|helm[^;&|]*[[:space:]](install|upgrade|uninstall|rollback))([[:space:]]|$)' <<<"$cmd"; then
  exit 0
fi

ctx=$(kubectl config current-context 2>/dev/null || echo "unknown")
if grep -Eq -- '--context|--kube-context' <<<"$cmd"; then
  reason="Command sets an explicit kube context; confirm it is intended."
elif [[ "$ctx" == k3d-* ]]; then
  exit 0
else
  reason="Current kube context is '$ctx' (not local k3d). Confirm before changing this cluster."
fi
jq -n --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'
exit 0
