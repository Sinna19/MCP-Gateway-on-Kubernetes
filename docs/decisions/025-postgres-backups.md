# 025: Gateway Postgres backups

Status: accepted, 2026-10-21

## Context
The gateway database holds users, API key hashes, audit log and encrypted upstream credentials. One node, one PVC: losing the node or the PVC loses it all.

## Decision
- **CronJob `gateway-postgres-backup`** (chart `gateway`, `backup.*` values): nightly 02:17 UTC, `pg_dump -Fc` (custom format) with the same digest-pinned postgres image, non-root, read-only root filesystem, all capabilities dropped. Writes to `x.dump.tmp`, renames when done, deletes files older than 7 days. `concurrencyPolicy: Forbid`.
- **Dedicated 1Gi local-path PVC** `gateway-postgres-backups`, separate from the data PVC, so a full backup volume cannot stop the database.
- **NetworkPolicy**: backup pod egress to DNS and Postgres only, no ingress. Postgres ingress allows label `gateway-postgres-backup`.
- **Waits for Postgres**: a new pod's IP is refused by kube-router for a few seconds, so the script loops on `pg_isready` first.
- **Off-box copy**: `make backup-pull` runs `pg_dump -Fc` through `kubectl exec` into `backups/` (gitignored, keeps the newest 7 per cluster). The PVC lives on the same disk as the data, so only this copy survives losing the VPS.
- **Restore proof**: `make restore-check` first takes a fresh dump (Job from the CronJob; `SKIP_BACKUP=1` skips it; the pod fails if its newest dump is older than that Job), then starts a throwaway pod (backup label, PVC mounted read-only), restores the newest dump into database `restore_check`, compares the row count of every public table with the live database, drops it. Prints `RESTORE CHECK: PASS` or `FAIL`.
- Manual run: `kubectl -n urumi create job --from=cronjob/gateway-postgres-backup bk1`.

## Restore for real
Dump file to a running Postgres: `kubectl -n urumi exec -i gateway-postgres-0 -- pg_restore -U gateway -d gateway --clean --if-exists < backups/<file>.dump` with the gateway scaled to 0 first.

## Not done
No encryption of the dump (it holds credential hashes and already-encrypted upstream credentials; keep `backups/` off shared drives). No WAL archiving: up to a day of data can be lost.

## Evidence
k3d and VPS (2026-10-21): job from the CronJob completed, `make restore-check` PASS (all 9 tables equal), `make backup-pull` wrote a dump.

## Secrets at rest
k3s `--secrets-encryption`: Ash ran `sudo k3s secrets-encrypt status` on the node on 2026-10-20: Encryption Status Enabled, AES-CBC.
