# Urumi MCP Gateway on Kubernetes

WooCommerce store + woo-mcp + team MCP gateway with dashboard and chat agent, all deployed with Helm.

Status: all phases built; docs and demo in Phase 9.

## Quick start (local)

Needs Docker Desktop, k3d, helm, kubectl, make (Git Bash on Windows).

    make cluster-up
    make deploy
    make register   # gives the gateway woo-mcp's token; until then woo shows Unreachable

## Deploy to a VPS

Tested on one Azure B2als_v2 (Ubuntu) running k3s `v1.35.5+k3s1` with `--secrets-encryption`. Public hostname is `<ip>.sslip.io` (`global.domain` in `deploy/values-prod.yaml`).

1. NSG inbound: 22 from my IP only, 80 and 443 from anywhere. **6443 is not public.**
2. Install k3s on the node, then check `sudo k3s secrets-encrypt status` says Enabled.
3. Open the API through an SSH tunnel and keep it open in its own terminal (`ServerAliveInterval` stops it dropping when idle):

        ssh -o ServerAliveInterval=30 -N -L 6443:127.0.0.1:6443 <user>@<vps-ip>

   `~/.kube/urumi-vps.yaml` points at `https://127.0.0.1:6443`, context `urumi-vps`.
4. Run the targets in this order, each with `ENV=prod`:

        ENV=prod make ping            # tunnel and kubeconfig work
        ENV=prod make cert-manager    # Helm release, pinned chart version
        make images                   # build locally
        ENV=prod make push-images     # side-load into k3s; needs ssh-agent, so run it from your own shell
        # secrets are created by scripts/secrets.sh, run by make deploy; they are never committed
        ENV=prod make deploy HELM_EXTRA="--set global.ingress.clusterIssuer=letsencrypt-staging"   # staging certs first
        ENV=prod make deploy          # then letsencrypt-prod from values-prod.yaml
        ENV=prod make register        # gives the gateway the fx and notes upstreams
        ENV=prod make dod             # 9/9 over https
        ENV=prod make backup-pull     # off-box Postgres dump into backups/

Never delete the TLS Secrets (`gateway-tls`, `store-wordpress-tls`) or the namespace: the hostname is shared and Let's Encrypt rate limits are real (ADR 024).

## What differs from local

Only `deploy/values-prod.yaml` differs from `deploy/values-local.yaml`:

| Setting | Local (k3d) | VPS |
| --- | --- | --- |
| `global.domain` | `localtest.me` | `20.197.63.44.sslip.io` |
| `global.ingress.tls` | `false` (http, cookie not Secure) | `true` (https, `COOKIE_SECURE=true`) |
| `global.ingress.clusterIssuer` | unset | `letsencrypt-prod` |
| `global.ingress.redirectHttps` | off | on |
| `certManager.clusterIssuers` | off | on |
| `store.wordpress.environmentType` | default | `production` |

Outside the values files:

- **cert-manager** is a separate Helm release installed by `ENV=prod make cert-manager`. k3d has none.
- **Images are side-loaded** (`docker save | ssh ... k3s ctr images import`), not `k3d image import`. `ENV=prod make deploy` does not build.
- **The API is reached through an SSH tunnel**, not a public 6443.
- **k3s runs with `--secrets-encryption`**, so Secrets are encrypted at rest in the node's datastore.

## Upgrade and rollback

Rehearsed on the VPS (ADR 024). `helm history platform -n urumi` shows revisions; `ENV=prod make deploy` is the upgrade.

    ENV=prod make deploy HELM_EXTRA="--set gateway.limits.mcp.callsPerMinute=61"   # revision N+1, new gateway pod
    helm --kube-context urumi-vps rollback platform <N> -n urumi --wait             # explicit number, revision N+2

Rule: roll back by exactly **one** revision, and never to a revision at or before the Let's Encrypt prod switch or the backup change. An older revision would bring back the staging issuer or drop the backup CronJob. Rollback does not touch PVC data or Secrets created by `scripts/secrets.sh`.

## Single-node limits

The VPS is deliberately one node:

- PVCs use `local-path`, which is ReadWriteOnce and tied to the node. WordPress and the setup Job share the `wp-content` PVC, which works only because they run on the same node.
- The gateway uses the `Recreate` strategy with one replica, because `/mcp` sessions live in its memory (ADR 006).
- Going multi-node would need: a registry instead of side-loaded images, RWX storage or `podAffinity` for the shared PVC, and sticky sessions or Redis for `/mcp` sessions and rate limits.
