#!/usr/bin/env bash
# Waits for the store setup Job of the current release revision (setup-<revision>), never a leftover older
# one. Succeeds when it completes; on failure or timeout prints its last 20 log lines and exits 1.
# `make deploy` runs this, so a failed setup fails the deploy. See ADR 004.
set -euo pipefail

NS="${NS:-urumi}"
RELEASE="${RELEASE:-platform}"
TIMEOUT="${TIMEOUT:-10m}"

revision="$(helm status "$RELEASE" -n "$NS" -o json | jq -r .version | tr -d '\r')"
job="job/setup-$revision"
kubectl -n "$NS" get "$job" -o name >/dev/null 2>&1 || { echo "wait-setup: $job not found"; exit 1; }
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
