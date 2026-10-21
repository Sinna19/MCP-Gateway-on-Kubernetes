#!/usr/bin/env bash
# Proves the newest dump on the backup PVC restores (ADR 025). A throwaway pod, labelled like the backup Job
# (so the NetworkPolicy lets it reach Postgres), restores the dump into database restore_check and compares
# the row count of every public table with the live database. The pod drops restore_check on exit, pass or fail.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/kube.sh
NS="${NS:-urumi}"
POD=gateway-restore-check

image=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].image}')
user=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_USER")].value}')
secret=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_PASSWORD")].valueFrom.secretKeyRef.name}')
db=$(kubectl -n "$NS" get statefulset gateway-postgres -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_DB")].value}')

kubectl -n "$NS" delete pod "$POD" --ignore-not-found --wait >/dev/null
trap 'kubectl -n "$NS" delete pod "$POD" --ignore-not-found --wait=false >/dev/null' EXIT

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
