#!/usr/bin/env bash
# Fixture tests for guard-kube-context.sh: feeds hook JSON, compares allow|ask|deny. Prints failures and a summary.
# Process start is slow on Windows (~2s per hook call), so checks run 6 at a time; each writes its own result file.
hook="$(dirname "${BASH_SOURCE[0]}")/guard-kube-context.sh"
results=$(mktemp -d)
trap 'rm -rf "$results"' EXIT
n=0

check() { # check <want> <current-context> <command>
  n=$((n + 1))
  (
    json=${3//\\/\\\\}; json=${json//\"/\\\"} # escape backslash and double quote for JSON; no jq, process start is slow
    out=$(GUARD_CURRENT_CONTEXT="$2" bash "$hook" <<<"{\"tool_input\":{\"command\":\"$json\"}}")
    case "$out" in
      *'"permissionDecision": "ask"'*) got=ask ;;
      *'"permissionDecision": "deny"'*) got=deny ;;
      *) got=allow ;;
    esac
    if [ "$got" != "$1" ]; then echo "FAIL want=$1 got=$got ctx=$2 cmd=$3" >"$results/$n"; fi
  ) &
  if [ $((n % 6)) = 0 ]; then wait; fi
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
check ask  k3d-urumi 'ssh -i k azureuser@20.197.63.44 sudo k3s kubectl get pods'
check ask  k3d-urumi 'ssh azureuser@20.197.63.44 uptime'
check ask  k3d-urumi 'kubectl --context urumi-vps exec -n urumi gateway-postgres-0 -- ls'
check allow k3d-urumi 'kubectl exec -n urumi gateway-postgres-0 -- ls'
check allow k3d-urumi 'kubectl --context k3d-urumi label pod x a=b'
check allow k3d-urumi 'kubectl -n urumi get pods -l app=run'
for v in 'exec p -- ls' 'cp p:/a /tmp/a' 'label pod x a=b' 'annotate pod x a=b' 'set image deploy/x c=i' 'run x --image=i' 'taint node n k=v:NoSchedule' 'uncordon n' 'rollout undo deploy/x'; do
  check deny docker-desktop "kubectl $v"
done
check deny k3d-urumi 'kubectl --context foo delete ns x'
check deny k3d-urumi 'helm --kube-context prod-eks upgrade x y'
check deny k3d-urumi 'kubectl --context k3d-urumi apply -f x && kubectl --context foo delete ns x'
check deny docker-desktop 'kubectl delete pod x'
check deny urumi-vps 'helm upgrade --install platform charts/platform'

# Trailing backtick: the context must still be read as urumi-vps (ask), not as "urumi-vps`" (deny).
check ask   k3d-urumi 'git commit -m "run `kubectl --context urumi-vps apply -f x`"'
check allow k3d-urumi 'echo `kubectl --context k3d-urumi delete pod x`'
check ask   k3d-urumi 'x=`kubectl apply -f y --context urumi-vps`'
check ask   k3d-urumi 'echo $(kubectl delete pod x --context urumi-vps)'
check deny  k3d-urumi 'echo `kubectl delete pod x --context other-ctx`'
check ask   k3d-urumi $'kubectl --context "\'`urumi-vps`\'" apply -f x' # tr -d must strip all three of " ' `
# Read-only commands that only mention prod names as text must not prompt.
check allow k3d-urumi 'grep -n ENV=prod Makefile'
check allow k3d-urumi 'cat scripts/push-images.sh'
check allow k3d-urumi 'git log --oneline -- scripts/push-images.sh'
check allow k3d-urumi 'git diff Makefile | grep ENV=prod'
check allow k3d-urumi 'ls scripts/push-images.sh'
check allow k3d-urumi 'git log --grep urumi-vps'
# ...but never when something executes inside them, or after them, or when git has options before the subcommand.
check ask   k3d-urumi 'grep x $(ENV=prod make deploy)'
check ask   k3d-urumi 'cat <(ssh azureuser@20.197.63.44 uptime)'
check ask   k3d-urumi 'ls `ENV=prod make deploy`'
check ask   k3d-urumi 'git -C dir log --grep push-images.sh'
# Real prod commands still prompt (or deny), alone or chained after a read-only one.
check ask   k3d-urumi 'ENV=prod make deploy'
check ask   k3d-urumi 'ENV=prod make dod'
check ask   k3d-urumi 'ENV=prod make restore-check'
check ask   k3d-urumi 'grep x f && ENV=prod make deploy'
check ask   k3d-urumi 'cat x.yaml | KUBECONFIG=~/.kube/urumi-vps.yaml kubectl apply -f -'
check ask   k3d-urumi 'ls; ssh azureuser@20.197.63.44 uptime'
check deny  k3d-urumi 'cat x | kubectl --context foo delete ns x'

wait
fails=$(find "$results" -type f | wc -l)
cat "$results"/* 2>/dev/null
if [ "$fails" = 0 ]; then echo "hook tests: ok ($n checks)"; else echo "hook tests: $fails FAILED"; exit 1; fi
