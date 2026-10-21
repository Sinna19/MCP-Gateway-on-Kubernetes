#!/usr/bin/env bash
# Off-box copy of the gateway database (ADR 025): pg_dump -Fc through kubectl exec into backups/ (gitignored).
# The dump holds password hashes and encrypted upstream credentials: keep it off shared drives.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/kube.sh
NS="${NS:-urumi}"

umask 077
mkdir -p backups
user=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_USER")].value}')
db=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_DB")].value}')
out="backups/gateway-${KUBE_CONTEXT}-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'rm -f "$out.tmp"' EXIT
# PGPASSWORD is not needed: inside the pod, the local socket trusts the postgres user.
kubectl -n "$NS" exec gateway-postgres-0 -c postgres -- pg_dump -Fc -U "$user" -d "$db" > "$out.tmp"
mv "$out.tmp" "$out"
echo "wrote $out ($(wc -c < "$out") bytes)"
ls -t backups/gateway-"${KUBE_CONTEXT}"-*.dump | tail -n +8 | xargs -r rm -f
