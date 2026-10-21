# Phase 8 VPS deploy: how to explain it

Covers: cluster selection + hook, cert-manager HTTP-01 + Let's Encrypt limits, image side-load, the app-passwords mu-plugin, backups/restore, upgrade + rollback.
ADRs: 024, 025. (File name is a slug because the requested title has `:` and `/`, which Windows paths refuse.)

## 1. What it does and why

Phase 8 puts the same charts on a single-node k3s VPS at `<ip>.sslip.io` with real Let's Encrypt certificates, and wraps that in guards so a command meant for k3d can never hit the VPS (or burn certificate limits) by accident. Only `deploy/values-prod.yaml` differs from local; everything else (side-loaded images, cert-manager release, mu-plugin, backup CronJob) exists to make the identical charts work on a real, shared-domain, single-disk server.

## 2. Request flow

**Public HTTPS request** (`https://shop.20.197.63.44.sslip.io/`)
1. Browser resolves sslip.io (DNS returns the VPS IP) and connects to port 443 on the node. k3s ships Traefik as a LoadBalancer, so it listens on 80/443 on the host.
2. Traefik terminates TLS using Secret `store-wordpress-tls` (`charts/store/templates/wordpress-ingress.yaml:22-23`), adds `X-Forwarded-For`/`X-Forwarded-Proto`, routes by host to Service `store-wordpress` (port name `http`), then to the WordPress pod over plain HTTP.
3. WordPress reads `X-Forwarded-Proto: https` and sets `$_SERVER['HTTPS']='on'` (official image's `wp-config.php`, ADR 024 line 17), so it believes it is on HTTPS.
4. WordPress queries MariaDB 3306 (the MariaDB NetworkPolicy allows only WordPress and the setup Job).

**Plain HTTP request** (`http://app...`): Traefik matches the Ingress, its annotation `router.middlewares: urumi-redirect-https@kubernetescrd` (`charts/gateway/templates/ingress.yaml:15`) runs the `redirect-https` Middleware (`charts/platform/templates/redirect-middleware.yaml:47-54`) and answers `308` to the https URL.

**Certificate issuance (HTTP-01)**, happens once per hostname, then renews itself
1. `ENV=prod make deploy` applies an Ingress with `cert-manager.io/cluster-issuer: letsencrypt-prod` (`ingress.yaml:17-19`) and a `tls:` block naming Secret `gateway-tls` (`:23-27`).
2. cert-manager's ingress-shim sees the annotation and creates a `Certificate`, then an `Order`/`Challenge` with the ACME server named in the ClusterIssuer (`charts/platform/templates/cluster-issuers.yaml:4-18`).
3. It creates a temporary solver pod (label `acme.cert-manager.io/http01-solver`, port 8089) and a temporary solver Ingress for `/.well-known/acme-challenge/<token>` on the same host.
4. Let's Encrypt (outside the cluster) does `GET http://<host>/.well-known/acme-challenge/<token>` on port 80. Traefik prefers the solver Ingress because its path is longer than `/`, so the redirect middleware on the main Ingress does not catch it. The request reaches the solver pod only because of the NetworkPolicy `allow-acme-http01-solver` (`cluster-issuers.yaml:23-42`).
5. Let's Encrypt validates, cert-manager stores the cert in the named Secret, Traefik hot-loads it. cert-manager renews at 2/3 of the certificate's lifetime (about day 60 of 90) by repeating this.

**Operator command** (`ENV=prod make deploy`)
1. Makefile (`Makefile:6-21`) sets `KUBE_CONTEXT=urumi-vps` and `KUBECONFIG=~/.kube/urumi-vps.yaml`, which points at `https://127.0.0.1:6443`.
2. That is the far end of an SSH tunnel I open by hand (README step 3); 6443 is not public. kubectl/helm talk Kubernetes API over TLS through the tunnel.
3. Every call carries `--context`/`--kube-context` explicitly (`Makefile:20-21`, `scripts/lib/kube.sh:17-18`).

**Image side-load** (`ENV=prod make push-images`): `docker save` (local) -> gzip -> ssh stdin -> `gunzip | sudo k3s ctr -n k8s.io images import -` on the node (`scripts/push-images.sh:27`). Pods then start with `imagePullPolicy: IfNotPresent` and find the image already in containerd.

**Backup** (nightly, in cluster): CronJob creates a Job pod (label `gateway-postgres-backup`) -> DNS lookup of `gateway-postgres` -> TCP 5432 -> `pg_dump -Fc` writes `/backups/x.dump.tmp` on its PVC -> rename (`backup-cronjob.yaml:49-53`).
**Off-box copy** (`make backup-pull`): `kubectl exec` into `gateway-postgres-0`, `pg_dump -Fc` streamed over the tunnel to `backups/` on my laptop (`scripts/backup-pull.sh:16`).

## 3. Kubernetes objects and the fields that matter

| Object | Field | Why it matters |
| --- | --- | --- |
| `ClusterIssuer` x2 (`cluster-issuers.yaml:6-18`) | `acme.server` | staging URL gives untrusted certs with generous limits; prod URL gives real certs with strict limits |
| | `privateKeySecretRef` | the ACME account key; cert-manager creates it. Losing it only means a new account |
| | `solvers.http01.ingress.ingressClassName: traefik` | the solver Ingress must be served by Traefik, or the challenge never gets a route |
| NetworkPolicy `allow-acme-http01-solver` | `podSelector` on the solver label, `from` Traefik pod, port 8089 | the namespace is default-deny (`default-deny-ingress.yaml`); without it the challenge hangs |
| Ingress (store, gateway) | `cert-manager.io/cluster-issuer` | triggers a Certificate. Only store + gateway have it; dashboard shares `gateway-tls` so two annotated Ingresses would fight over one Secret (`ingress.yaml:2-3`) |
| | `tls[].secretName` | where the cert lands and what Traefik serves |
| Middleware `redirect-https` | `permanent: true` | 308 not 302, so clients cache it |
| ConfigMap `store-mu-plugin` | mounted with `subPath` at `wp-content/mu-plugins/app-passwords.php` (`wordpress-deployment.yaml:90-92`) | a single file over the PVC-backed `wp-content`, without hiding the rest |
| WordPress Deployment | annotation `checksum/mu-plugin` (`:19`) | ConfigMap changes with `subPath` do not reach a running pod; a changed checksum forces a rollout. The setup Job has the same annotation |
| Backup CronJob | `schedule` 02:17 UTC, `concurrencyPolicy: Forbid`, `startingDeadlineSeconds: 3600`, `activeDeadlineSeconds: 900`, `backoffLimit: 1` | no overlapping runs; a hung pg_dump is killed after 15 min so it cannot block every later night |
| | `runAsNonRoot`, `readOnlyRootFilesystem`, `drop: ALL`, `seccomp RuntimeDefault`, `automountServiceAccountToken: false` | the dump pod has no reason to be powerful |
| | `umask 077` (`:46`) | dump files are mode 600 |
| | `resources` 10m/32Mi requests, 200m/128Mi limits | small, bounded; a runaway dump cannot starve the 2-core node |
| PVC `gateway-postgres-backups` | RWO 1Gi `local-path` | separate from the data PVC so a full backup volume cannot stop Postgres |
| NetworkPolicy `gateway-postgres-backup` | `ingress: []`, egress DNS + 5432 only | nobody can reach it; it can reach only DNS and Postgres. Postgres side admits the backup label (`postgres-networkpolicy.yaml:26`) |
| Secret `gateway-db` | `PGPASSWORD` via `secretKeyRef` | password never in the chart or the Job spec |
| k3s `--secrets-encryption` | node-level | Secrets are AES-CBC encrypted in the datastore (checked by me with `k3s secrets-encrypt status`) |

## 4. Failure modes and how each is handled

| Failure | What happens | Handled by |
| --- | --- | --- |
| Command aimed at the wrong cluster | Refused, or asks me | `scripts/lib/kube.sh:8-15` (only `k3d-*`/`urumi-vps`, context must exist); Makefile refuses `cluster-up/down/images` on prod; hook `guard-kube-context.sh` denies other contexts and asks for VPS (a guardrail for Claude, not for me typing) |
| Challenge hangs | Certificate stays not Ready | the solver NetworkPolicy; diagnose with `kubectl describe certificate/order/challenge` |
| Let's Encrypt rate limit | `rateLimited` error on the Order | staging first (README order), never delete `gateway-tls`/`store-wordpress-tls`/namespace (ADR 024 item 8); fallback is a real domain |
| Port 80 blocked / NSG wrong | HTTP-01 fails | README step 1 opens 80 and 443 |
| Image not on node | `ErrImagePull`/`ImagePullBackOff` (no registry to pull from) | `push-images.sh` before deploy; it refuses if `services/` or `apps/` are uncommitted since tags are git tree hashes (`Makefile:89`) |
| SSH drops mid-push | `pipefail` makes the script fail | rerun: it skips tags already present (`push-images.sh:13-15`) |
| Tunnel idles out | kubectl hangs/refused | `ServerAliveInterval=30` (seen once after ~1h) |
| Backup hangs | killed at 900s | `activeDeadlineSeconds`; `.tmp` file removed by the EXIT trap (`:50`) so a half dump never looks valid |
| Postgres pod just restarted | new pod IP refused by kube-router for a few seconds | `pg_isready` loop before dumping (`:48`) |
| Backup volume fills | only backups stop, DB keeps running | separate PVC; 7-day retention (`find -mtime`) |
| Node/disk lost | PVC backups die with the node | `make backup-pull` copy on my laptop (7 newest kept, `backup-pull.sh:19`) |
| A restore is corrupt | found only if someone tries | `make restore-check` restores the newest dump into `restore_check`, compares row counts per table, drops it on any exit |
| Bad upgrade | new gateway pod crashes | `helm rollback platform <N> --wait` (one revision back only; see section 7) |
| App Passwords answer 401 in prod | woo-mcp/setup Job break | the mu-plugin (next section) |

## 5. Security: trust and credentials

- **Trusted**: Traefik (it is the only thing that adds `X-Forwarded-For` on public traffic), my laptop's kubeconfig, the node, the pinned images.
- **Not trusted**: the Internet, any pod without a matching NetworkPolicy label, anything in `backups/` that someone else could read.
- **mu-plugin trust rule** (`mu-plugin-configmap.yaml:15-17`): Application Passwords are enabled if `is_ssl()` OR the request has no `X-Forwarded-For`. A public plain-HTTP request always has the header, so it stays refused; an in-cluster call from woo-mcp has none, so it works. The NetworkPolicy (only woo-mcp reaches WordPress) is the second lock.
- **Credentials**:
  - Created on the server by `scripts/secrets.sh` (create-if-missing, never printed, never committed). The Woo app password is generated by the setup Job into Secret `woo-api`.
  - Postgres password: Secret `gateway-db` -> env `PGPASSWORD` in the backup pod.
  - TLS private keys and the ACME account key: Secrets created by cert-manager, encrypted at rest by k3s.
  - SSH key `~/.ssh/urumi-vps` is passphrase-protected, so only I can push images (the tool shell cannot). The k8s API is reachable only through the SSH tunnel.
  - `backups/*.dump` on my laptop hold password hashes and already-encrypted upstream credentials; mode 600, gitignored, **not encrypted**.
- **Cookie**: `make lint` fails unless values-prod renders `COOKIE_SECURE "true"`; `dod-check` asserts `Secure` + `HttpOnly` over https.

## 6. Ten likely interview questions

1. **Why HTTP-01 and not DNS-01?** HTTP-01 needs only port 80 reaching Traefik and no DNS API credentials. DNS-01 is required for wildcards or when port 80 is closed, and needs a DNS provider token stored in the cluster. We need neither.
2. **Why sslip.io?** It gives a hostname that resolves to my IP with no DNS setup, and Let's Encrypt will issue for it. Downside: it is a shared domain, so rate limits are shared with strangers, which is why staging comes first. A real domain is a one-line change (`global.domain`).
3. **What are the Let's Encrypt limits that matter here?** (Verified 2026-10-21.) 50 certificates per registered domain per 7 days, 5 duplicate certificates (same name set) per 7 days, and 5 failed validations per hostname per account per hour. Certificate lifetime is 90 days now, 64 days from 2027-02-10 and 45 days from 2028-02-16; cert-manager renews at 2/3 of the lifetime, so renewal gets more frequent over time. This is why I never delete the TLS Secrets (a re-issue counts toward the duplicate limit) and why staging runs first.
4. **Why not bake the cert-manager chart into the platform chart as a subchart?** CRDs must exist before the platform chart renders `ClusterIssuer`s, and Helm installs CRDs from subcharts too late for templates in the same release. So it is its own release, version pinned (v1.21.2).
5. **Why not push images to a registry?** One node, one developer: a registry means credentials, a pull Secret and another thing to secure. `docker save | ssh | ctr import` has no extra moving parts. It would not survive going multi-node (README says so).
6. **How does the image tag work and why does `push-images` refuse a dirty tree?** Tags are git tree hashes of the service folder. A dirty tree would build an image whose tag does not match any committed code, so the tag would lie.
7. **Why a mu-plugin and not just keep `WP_ENVIRONMENT_TYPE=local`?** `local` would work but would also tell WordPress it is a dev site (debug-ish behaviour) in production. The mu-plugin changes one filter and nothing else. A mu-plugin is also loaded before regular plugins and cannot be disabled from wp-admin.
8. **Is the `X-Forwarded-For` check secure?** It relies on Traefik always adding the header on public traffic and on the NetworkPolicy limiting who reaches WordPress directly. If someone got a pod past the policy they could skip the header. Honest answer: it is defence in depth, not a cryptographic check.
9. **Why back up with `pg_dump -Fc` instead of a PVC/VolumeSnapshot or WAL archiving?** local-path has no snapshot support; pg_dump is portable and restorable into any Postgres. Cost: up to 24 h of data loss. WAL archiving would fix that but needs more moving parts than a 2-week project warrants.
10. **How do you know the backup works?** `make restore-check` actually restores the newest dump into a scratch database and compares row counts with the live one (PASS on k3d and VPS). A dump you never restored is not a backup.

Bonus "why not X": *Why not ArgoCD/Flux for deploys?* One cluster, one operator; `helm upgrade` plus `helm history` is enough and I can explain it. *Why not Let's Encrypt via k3s/Traefik's built-in ACME?* cert-manager makes certificates Kubernetes objects (`kubectl get certificate`), and renewals/diagnosis are visible; Traefik ACME stores state in a file.

## 7. Weak spots to be ready to defend

- **Backups live on the same disk** as the data. Only `make backup-pull` (manual, from my laptop) protects against losing the VPS. Nothing schedules it.
- **Dumps are unencrypted** on the laptop, and there is no WAL (RPO up to a day). Said openly in ADR 025.
- **restore-check compares row counts only**, not content, and it creates a database on the live server while running.
- **No email on the ACME account** (`cluster-issuers.yaml:3`) loses nothing: Let's Encrypt ended expiry notification emails in June 2025, so an email would not warn me anyway. The real fix for "renewal silently broke" is alerting on the cert-manager metric `certmanager_certificate_expiration_timestamp_seconds`. I have no alert on it yet; today I rely on cert-manager renewing by itself and on `kubectl get certificate`.
- **The hook is a regex**, not a security boundary: it guards Claude's commands, and an obfuscated command could slip through. The real guard for scripts is `lib/kube.sh`. Nothing stops me typing `kubectl` with no context in a shell whose default context is wrong, except that the default kubeconfig stays k3d.
- **Rollback is narrow**: only one revision back, never to or before the prod-issuer flip or the backup change, or I would reintroduce the staging issuer or lose the CronJob. Rollback does not revert PVC data or Secrets, and `helm rollback` creates a new revision (N+2), it does not rewind history.
- **The rehearsal changed a harmless value** (`callsPerMinute` 60 -> 61) because the chart has no `podAnnotations`. That shows the rollback mechanism, not a risky schema change; a migration that already ran in Postgres would not be undone.
- **Single node, single replica**: gateway `Recreate` strategy means a short outage on every upgrade; WordPress and the setup Job share an RWO PVC only because they are on the same node.
- **A standing `dod-member` user** exists on the VPS gateway because `make dod` reuses it (ADR 024 last section). Be ready to say why it is acceptable (role member, only its keys are revoked each run).
- **mu-plugin is active locally too** (harmless), and the X-Forwarded-For rule should appear in the THREAT_MODEL (phase 9).
- **Let's Encrypt numbers** (limits, lifetimes, 2/3 renewal, email shutdown) were verified on 2026-10-21; recheck if the demo is much later, since the lifetime schedule changes in 2027.

## 8. Commands that prove it

    ENV=prod make ping
    kubectl --context urumi-vps -n urumi get certificate        # both READY=True
    curl -sI http://app.20.197.63.44.sslip.io | head -3          # 308 to https
    helm --kube-context urumi-vps history platform -n urumi
    ENV=prod make dod                                            # 9 passed
    ENV=prod make restore-check                                  # RESTORE CHECK: PASS
