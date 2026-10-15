#!/usr/bin/env bash
# Waits for the newest store setup Job. Succeeds when it completes; on failure or timeout prints its last
# 20 log lines and exits 1. `make deploy` runs this, so a failed setup fails the deploy, and a second
# deploy cannot start while the first Job is still running. See ADR 004.
set -euo pipefail

NS="${NS:-urumi}"
TIMEOUT="${TIMEOUT:-10m}"

job="$(kubectl -n "$NS" get jobs -l app.kubernetes.io/name=setup --sort-by=.metadata.creationTimestamp -o name | tail -1)"
[ -n "$job" ] || { echo "wait-setup: no setup job found"; exit 1; }
echo "wait-setup: waiting for $job"

# Wait for "complete" and "failed" at the same time, so a crashing Job fails fast instead of at the timeout.
kubectl -n "$NS" wait --for=condition=complete "$job" --timeout="$TIMEOUT" >/dev/null 2>&1 &
complete_pid=$!
kubectl -n "$NS" wait --for=condition=failed "$job" --timeout="$TIMEOUT" >/dev/null 2>&1 &
failed_pid=$!
wait -n || true
kill "$complete_pid" "$failed_pid" 2>/dev/null || true

if [ "$(kubectl -n "$NS" get "$job" -o jsonpath='{.status.succeeded}')" = "1" ]; then
  echo "wait-setup: $job complete"
else
  echo "wait-setup: $job failed or timed out. Last 20 log lines:"
  kubectl -n "$NS" logs "$job" --tail=20 2>&1 || true
  exit 1
fi
