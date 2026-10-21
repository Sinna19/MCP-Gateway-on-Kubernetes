#!/usr/bin/env bash
# Rotates CREDENTIALS_KEY (ADR 023): re-encrypts every stored upstream credential under a new key.
#   scripts/rotate-credentials-key.sh          full rotation (make rotate-key)
#   scripts/rotate-credentials-key.sh finish   only copy Secret gateway-key-new into gateway-app (recovery, see below)
#   scripts/rotate-credentials-key.sh prefixes print the stored ciphertext prefixes (recovery: did the Job commit?)
# The gateway is DOWN from step 3 until it is back (about 30s). Rotation is rare, so that is accepted.
# Keys live only in Secrets and in one private temp dir (removed on exit). Never in argv, stdin or output.
set -euo pipefail

NS="${NS:-urumi}"
BASE="${GATEWAY_URL:-http://app.localtest.me}"
WAIT="${ROTATE_WAIT:-90}"
JOB=gateway-rotate-key

# ---- guards (before any change: this script scales the gateway) ----
# shellcheck source=lib/kube.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/kube.sh"
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

umask 077
TMP="$(mktemp -d)"
# Windows kubectl cannot open /tmp/... paths from Git Bash: hand it C:/... paths.
winpath() { cygpath -m "$1" 2>/dev/null || printf '%s' "$1"; }
k() { kubectl -n "$NS" "$@"; }
secret() { k get secret "$1" -o jsonpath="{.data.$2}" | base64 -d; }
# Prefix of each stored ciphertext = the random IV (12 bytes). Not secret; it changes when the row is re-encrypted.
prefixes() { k exec gateway-postgres-0 -- sh -c 'psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}" -Atc "select concat_ws(chr(32), slug, left(credential_enc, 16)) from upstream_servers where credential_enc is not null order by slug"' | tr -d '\r'; }

# Copies gateway-key-new into gateway-app. The key goes through a patch file, not argv.
swap_key() {
  k get secret gateway-key-new -o json | jq '{data: {"credentials-key": .data["credentials-key"]}}' > "$TMP/patch.json"
  k patch secret gateway-app --type merge --patch-file "$(winpath "$TMP/patch.json")" >/dev/null
}

if [ "${1:-}" = prefixes ]; then
  prefixes
  rm -rf "$TMP"
  exit 0
fi

if [ "${1:-}" = finish ]; then
  swap_key
  echo "gateway-app now holds the new key. Next: kubectl -n $NS scale deploy/gateway --replicas=1"
  rm -rf "$TMP"
  exit 0
fi

# Preflight: a leftover key Secret means an earlier run did not finish.
for s in gateway-key-old gateway-key-new; do
  if k get secret "$s" >/dev/null 2>&1; then
    echo "Secret $s exists: an earlier rotation did not finish." >&2
    echo "If the gateway runs and all servers are connected: kubectl -n $NS delete secret gateway-key-old gateway-key-new" >&2
    echo "If the database already uses the new key: scripts/rotate-credentials-key.sh finish" >&2
    rm -rf "$TMP"; exit 1
  fi
done

# ---- state read by the EXIT trap ----
scaled_down=0 committed=0 swapped=0 done_ok=0 unknown=0
cleanup() {
  local rc=$?
  trap - EXIT
  if [ "$unknown" = 1 ]; then
    # The Job timed out: we do not know if it committed. Do NOT scale up on the old key and do NOT delete the backups.
    cat >&2 <<MSG
The re-encrypt Job timed out and was deleted. It may or may not have committed, so the gateway is kept at 0 replicas
and Secrets gateway-key-old and gateway-key-new are kept. Find out which key the database uses:
  scripts/rotate-credentials-key.sh prefixes     compare with the 'before' list printed above
  - prefixes changed  -> the database is on the NEW key: scripts/rotate-credentials-key.sh finish
  - prefixes the same -> the database is still on the OLD key (gateway-app is unchanged)
Then: kubectl -n $NS scale deploy/gateway --replicas=1, check that the servers are connected
(kubectl -n $NS logs deploy/gateway --tail=30), and delete the backups: kubectl -n $NS delete secret gateway-key-old gateway-key-new
MSG
    rm -rf "$TMP"
    exit "$rc"
  fi
  if [ "$committed" = 1 ] && [ "$swapped" = 0 ]; then
    echo "swap of gateway-app failed, retrying once" >&2
    if swap_key; then
      swapped=1
    else
      echo "DB uses the new key (Secret gateway-key-new). Run: scripts/rotate-credentials-key.sh finish, then scale gateway to 1 (kubectl -n $NS scale deploy/gateway --replicas=1)" >&2
      rm -rf "$TMP"
      exit "$rc"
    fi
  fi
  if [ "$scaled_down" = 1 ]; then
    k scale deploy/gateway --replicas=1 >/dev/null || echo "could not scale the gateway: kubectl -n $NS scale deploy/gateway --replicas=1" >&2
  fi
  if [ "$done_ok" = 1 ]; then
    k delete secret gateway-key-old gateway-key-new --ignore-not-found >/dev/null || true
    k delete job "$JOB" --ignore-not-found >/dev/null || true
  elif [ "$committed" = 0 ]; then
    k delete secret gateway-key-old gateway-key-new --ignore-not-found >/dev/null || true
    [ "$rc" = 0 ] || echo "rotation failed before anything was committed: the database and gateway-app are unchanged, the gateway runs on the old key." >&2
  else
    echo "database and gateway-app hold the NEW key. The old key is kept in Secret gateway-key-old, the new in gateway-key-new." >&2
    echo "Check: kubectl -n $NS logs deploy/gateway --tail=30. Once the servers are connected: kubectl -n $NS delete secret gateway-key-old gateway-key-new" >&2
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT

echo "stored ciphertext prefixes before:"; prefixes

# 2. old key (from gateway-app) and new key (random) go to files, then to Secrets.
secret gateway-app credentials-key > "$TMP/old.key"
openssl rand -base64 32 | tr -d '\n' > "$TMP/new.key"
k create secret generic gateway-key-old --from-file=credentials-key="$(winpath "$TMP/old.key")" >/dev/null
k create secret generic gateway-key-new --from-file=credentials-key="$(winpath "$TMP/new.key")" >/dev/null

# 3. Stop the gateway: an old-key gateway must not save a credential between the commit and the swap.
scaled_down=1
k scale deploy/gateway --replicas=0 >/dev/null
k wait --for=delete pod -l app.kubernetes.io/name=gateway --timeout=60s >/dev/null 2>&1 || true

# 4. The Job runs the gateway image that is deployed right now, with both keys mounted as files.
IMAGE="$(k get deploy gateway -o jsonpath='{.spec.template.spec.containers[0].image}' | tr -d '\r')"
DBURL="$(k get deploy gateway -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="DATABASE_URL")].value}' | tr -d '\r')"
k delete job "$JOB" --ignore-not-found >/dev/null
# Quote the two values as JSON strings (valid YAML), so odd characters cannot break the manifest.
IMAGE_Q="$(printf '%s' "$IMAGE" | jq -Rs .)"
DBURL_Q="$(printf '%s' "$DBURL" | jq -Rs .)"
cat > "$TMP/job.yaml" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: gateway-rotate-key
  labels:
    app.kubernetes.io/name: gateway-rotate-key
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app.kubernetes.io/name: gateway-rotate-key
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: rotate
          image: $IMAGE_Q
          imagePullPolicy: IfNotPresent
          command: ["node", "dist/rotate-main.js"]
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: gateway-db
                  key: password
            - name: DATABASE_URL
              value: $DBURL_Q
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests:
              cpu: 20m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
          volumeMounts:
            - name: old-key
              mountPath: /keys/old
              readOnly: true
            - name: new-key
              mountPath: /keys/new
              readOnly: true
      volumes:
        - name: old-key
          secret:
            secretName: gateway-key-old
            defaultMode: 0440
        - name: new-key
          secret:
            secretName: gateway-key-new
            defaultMode: 0440
EOF
k apply -f "$(winpath "$TMP/job.yaml")" >/dev/null

echo "running the re-encrypt Job..."
for _ in $(seq 1 "$WAIT"); do
  ok="$(k get job "$JOB" -o jsonpath='{.status.succeeded}' | tr -d '\r')"
  bad="$(k get job "$JOB" -o jsonpath='{.status.failed}' | tr -d '\r')"
  { [ "$ok" = 1 ] || [ -n "$bad" ]; } && break
  read -t 1 <> <(:) || true
done
k logs "job/$JOB" --tail=5 || true
if [ "$ok" != 1 ] && [ -z "$bad" ]; then
  # Timeout: the Job is neither done nor failed. Remove it and wait until its pod is really gone, so it cannot commit later.
  unknown=1
  k delete job "$JOB" --ignore-not-found >/dev/null || true
  k wait --for=delete pod -l app.kubernetes.io/name=gateway-rotate-key --timeout=60s >/dev/null 2>&1 || true
  echo "the Job did not finish within ${WAIT}s" >&2
  exit 1
fi
[ "$ok" = 1 ] || { echo "the Job did not succeed (transaction rolled back, nothing changed)" >&2; exit 1; }
committed=1

# 5. Swap the gateway's key Secret to the new value (the old one is still in gateway-key-old).
swap_key
swapped=1

# 6. Start the gateway on the new key and wait until every enabled server is connected.
k scale deploy/gateway --replicas=1 >/dev/null
scaled_down=0
k rollout status deploy/gateway --timeout=120s >/dev/null
ADMIN_EMAIL="$(secret gateway-app admin-email)"
ADMIN_PASSWORD="$(secret gateway-app admin-password)"
E="$ADMIN_EMAIL" P="$ADMIN_PASSWORD" jq -n '{email:env.E,password:env.P}' |
  curl -fsS -o /dev/null -c "$TMP/jar" -H 'Content-Type: application/json' --data @- "$BASE/api/auth/login"
connected=0
for _ in $(seq 1 "$WAIT"); do
  if curl -fsS -b "$TMP/jar" "$BASE/api/servers" | jq -e '[.[] | select(.enabled and .status != "connected")] | length == 0' >/dev/null; then
    connected=1; break
  fi
  read -t 1 <> <(:) || true
done
curl -s -o /dev/null -b "$TMP/jar" -X POST -H 'Content-Type: application/json' --data '{}' "$BASE/api/auth/logout" || true
[ "$connected" = 1 ] || { echo "not every enabled server became connected within ${WAIT}s" >&2; exit 1; }

echo "stored ciphertext prefixes after:"; prefixes
# 7. Only now are the backup Secrets and the Job deleted (the trap does it).
done_ok=1
echo "rotation done: all enabled servers connected, backup Secrets removed"
