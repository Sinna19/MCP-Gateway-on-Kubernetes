#!/usr/bin/env bash
# Fixture tests for guard-kube-context.sh: feeds hook JSON, compares allow|ask|deny. Prints failures and a summary.
hook="$(dirname "${BASH_SOURCE[0]}")/guard-kube-context.sh"
fails=0

check() { # check <want> <current-context> <command>
  local out got
  out=$(jq -n --arg c "$3" '{tool_input:{command:$c}}' | GUARD_CURRENT_CONTEXT="$2" bash "$hook")
  got=$(jq -r '.hookSpecificOutput.permissionDecision // "allow"' <<<"${out:-{\}}")
  if [ "$got" != "$1" ]; then fails=$((fails + 1)); echo "FAIL want=$1 got=$got ctx=$2 cmd=$3"; fi
}

check allow k3d-urumi 'kubectl -n urumi delete pod x'
check allow k3d-urumi 'kubectl --context k3d-urumi apply -f x.yaml'
check allow k3d-urumi 'helm --kube-context k3d-urumi upgrade --install platform charts/platform'
check allow k3d-urumi 'make deploy'
check allow k3d-urumi 'git status'
check allow urumi-vps 'kubectl --context urumi-vps get pods -A'
check allow urumi-vps 'kubectl --context urumi-vps describe certificate x'
check allow urumi-vps 'kubectl --context urumi-vps logs deploy/gateway --tail=50'
check allow urumi-vps 'helm --kube-context urumi-vps history platform -n urumi'
check ask  k3d-urumi 'kubectl --context urumi-vps apply -f x.yaml'
check ask  k3d-urumi 'kubectl --context=urumi-vps delete certificate x'
check ask  k3d-urumi 'helm --kube-context urumi-vps rollback platform 1'
check ask  k3d-urumi 'make deploy ENV=prod'
check ask  k3d-urumi 'ENV=prod make secrets'
check ask  k3d-urumi 'KUBECONFIG=~/.kube/urumi-vps.yaml kubectl scale deploy/gateway --replicas=0'
check ask  k3d-urumi 'ssh azureuser@20.197.63.44 sudo k3s ctr images import -'
check deny k3d-urumi 'kubectl --context foo delete ns x'
check deny k3d-urumi 'helm --kube-context prod-eks upgrade x y'
check deny k3d-urumi 'kubectl --context k3d-urumi apply -f x && kubectl --context foo delete ns x'
check deny docker-desktop 'kubectl delete pod x'
check deny urumi-vps 'helm upgrade --install platform charts/platform'

if [ "$fails" = 0 ]; then echo "hook tests: ok"; else echo "hook tests: $fails FAILED"; exit 1; fi
