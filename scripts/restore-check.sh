#!/usr/bin/env bash
# Proves the newest dump on the backup PVC restores (ADR 025). A throwaway pod, labelled like the backup Job
# (so the NetworkPolicy lets it reach Postgres), restores the dump into database restore_check and compares
# the row count of every public table with the live database. The pod drops restore_check on exit, pass or fail.
# First it takes a fresh dump (a Job from the backup CronJob), so writes since the nightly dump cannot cause a false DIFF;
# the pod fails if its newest dump is older than that Job's start. SKIP_BACKUP=1 checks the newest dump as it is.
# Retention is by age (find -mtime), so the extra dump never rotates out a nightly; it only costs disk until it ages out.
# Accepted, no lock: a write between the new dump and the count compare (seconds), and the CronJob firing during the
# check (two dump Jobs at once, each writes its own file).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/kube.sh
NS="${NS:-urumi}"
POD=gateway-restore-check
JOB=gateway-backup-for-check
min_dump=""

image=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].image}')
user=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_USER")].value}')
secret=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_PASSWORD")].valueFrom.secretKeyRef.name}')
db=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_DB")].value}')

kubectl -n "$NS" delete pod "$POD" --ignore-not-found --wait >/dev/null
trap 'kubectl -n "$NS" delete pod "$POD" --ignore-not-found --wait=false >/dev/null; kubectl -n "$NS" delete job "$JOB" --ignore-not-found --wait=false >/dev/null' EXIT

if [ "${SKIP_BACKUP:-}" != 1 ]; then
  kubectl -n "$NS" delete job "$JOB" --ignore-not-found --wait >/dev/null
  kubectl -n "$NS" create job "$JOB" --from=cronjob/gateway-postgres-backup >/dev/null
  echo "taking a fresh backup ($JOB)"
  ok=""
  for _ in $(seq 450); do
    [ "$(kubectl -n "$NS" get job "$JOB" -o jsonpath='{.status.succeeded}')" = 1 ] && { ok=1; break; }
    [ -n "$(kubectl -n "$NS" get job "$JOB" -o jsonpath='{.status.failed}')" ] && break
    read -t 2 <> <(:) || true
  done
  [ -n "$ok" ] || { kubectl -n "$NS" logs "job/$JOB" --tail=20; echo "backup Job did not succeed"; exit 1; }
  # Job start (2026-10-21T11:50:03Z) in dump-name form; the dump is named after the pod start, so it sorts at or after this.
  start=$(kubectl -n "$NS" get job "$JOB" -o jsonpath='{.status.startTime}' | tr -d '\r:-')
  min_dump="gateway-$start.dump"
fi

# The script text is passed as the container args (not through a shell here), $-signs are for the pod's sh.
kubectl -n "$NS" apply -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata:
  name: $POD
  labels:
    app.kubernetes.io/name: gateway-postgres-backup
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  securityContext: {fsGroup: 70, seccompProfile: {type: RuntimeDefault}}
  containers:
    - name: check
      image: $image
      imagePullPolicy: IfNotPresent
      securityContext:
        runAsUser: 70
        runAsGroup: 70
        runAsNonRoot: true
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities: {drop: ["ALL"]}
      env:
        - {name: PGHOST, value: gateway-postgres}
        - {name: PGUSER, value: "$user"}
        - {name: LIVE_DB, value: "$db"}
        - {name: MIN_DUMP, value: "$min_dump"}
        - name: PGPASSWORD
          valueFrom: {secretKeyRef: {name: "$secret", key: password}}
      command:
        - sh
        - -c
        - |
          set -eu
          # restore_check holds a full copy of the data: drop it on any exit, including a failed restore.
          trap 'psql -d "\$LIVE_DB" -qc "DROP DATABASE IF EXISTS restore_check"' EXIT
          # A new pod's IP is refused by the NetworkPolicy for a few seconds, so wait for Postgres.
          for i in \$(seq 30); do pg_isready -q && break; sleep 2; done
          f=\$(ls -t /backups/gateway-*.dump | head -1)
          echo "restoring \$f"
          # File names sort by time. An empty MIN_DUMP (SKIP_BACKUP=1) accepts any dump.
          if [ -n "\$MIN_DUMP" ] && [ "\$(printf '%s\n%s\n' "\$MIN_DUMP" "\$(basename "\$f")" | sort | head -1)" != "\$MIN_DUMP" ]; then
            echo "stale dump: \$f is older than \$MIN_DUMP"; exit 1
          fi
          psql -d "\$LIVE_DB" -qc 'DROP DATABASE IF EXISTS restore_check' -c 'CREATE DATABASE restore_check'
          pg_restore -d restore_check --no-owner "\$f"
          bad=0
          for t in \$(psql -d "\$LIVE_DB" -Atc "select tablename from pg_tables where schemaname='public' order by 1"); do
            a=\$(psql -d "\$LIVE_DB" -Atc "select count(*) from \$t")
            b=\$(psql -d restore_check -Atc "select count(*) from \$t")
            if [ "\$a" = "\$b" ]; then echo "ok   \$t live=\$a restored=\$b"; else echo "DIFF \$t live=\$a restored=\$b"; bad=1; fi
          done
          [ \$bad = 0 ] && echo "RESTORE CHECK: PASS" || { echo "RESTORE CHECK: FAIL"; exit 1; }
      resources:
        requests: {cpu: 10m, memory: 32Mi}
        limits: {cpu: 200m, memory: 256Mi}
      volumeMounts: [{name: backups, mountPath: /backups, readOnly: true}]
  volumes:
    - name: backups
      persistentVolumeClaim: {claimName: gateway-postgres-backups}
YAML

for _ in $(seq 60); do
  phase=$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.status.phase}')
  [ "$phase" = Succeeded ] || [ "$phase" = Failed ] && break
  read -t 2 <> <(:) || true
done
kubectl -n "$NS" logs "$POD" --tail=40
[ "$phase" = Succeeded ]
