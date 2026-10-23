# Urumi MCP Gateway on Kubernetes

WooCommerce store + woo-mcp + team MCP gateway with dashboard and chat agent, all deployed with Helm.

Status: all phases complete, app live on the VPS. Design: `docs/DESIGN.md`. Threat model: `docs/THREAT_MODEL.md`.

## Run locally (k3d)

Needs Docker Desktop, k3d, helm, kubectl and make.

- **Windows:** use Git Bash for every command below (the scripts are bash). Docker Desktop must be running.
- **macOS/Linux:** the same commands work in a normal shell. Not tested there; the dev machine is Windows.
- `*.localtest.me` resolves to 127.0.0.1, so no hosts-file edits. Ports 80 on the host must be free.

1. Create the cluster (k3d cluster `urumi`, Traefik on port 80):

        make cluster-up

2. Deploy. `make deploy` runs `scripts/secrets.sh` first, which creates the Secrets (random passwords, tokens, keys) and never overwrites existing ones. It then builds and imports the images, installs the Helm release and waits for the store setup Job:

        make deploy
        make register    # gives the gateway woo-mcp's token and adds the fx and notes upstreams

   Optional, for the chat: create the LLM Secret before `make deploy`, or chat answers 503. Put the key in `LLM_API_KEY` without echoing it, (base URL and model are under `gateway.llm` in `deploy/values-local.yaml`):

        read -rs LLM_API_KEY; export LLM_API_KEY; scripts/secrets.sh; unset LLM_API_KEY

3. Get the admin password. A fresh cluster generates a new one. The email is `admin@urumi.local`:

        kubectl -n urumi get secret gateway-app -o jsonpath='{.data.admin-password}' | base64 -d; echo

   Log in at http://app.localtest.me.

4. Place an order: open http://shop.localtest.me, add a product to the cart and check out with cash on delivery. The order shows under `woo__list_orders` (dashboard chat or any MCP client).

5. Connect an MCP client. In the dashboard open the Keys page (`/keys`) and create a key (shown once, starts with `umk_`). The gateway URL is `http://app.localtest.me/mcp` (Streamable HTTP) and the key goes in an `Authorization: Bearer` header. Claude Code:

        claude mcp add --transport http urumi http://app.localtest.me/mcp --header "Authorization: Bearer umk_..."

   Claude Desktop (`claude_desktop_config.json`; untested here, it goes through the `mcp-remote` bridge):

        {
          "mcpServers": {
            "urumi": {
              "command": "npx",
              "args": ["mcp-remote", "http://app.localtest.me/mcp", "--allow-http", "--header", "Authorization: Bearer umk_..."]
            }
          }
        }

   The client sees the tools your role allows, named `woo__...`, `fx__...`, `notes__...`. MCP Inspector works the same way (transport Streamable HTTP, URL, Bearer key).

6. Use the chat: dashboard, Chat page. It acts as the logged-in user through the same routing, role and audit path as `/mcp`, so a member cannot do more in chat than with a key. Write tools ask for confirmation first.

7. Check everything end to end (two users, tools, outage, revoke, audit):

        make dod

   Other checks: `make lint`, `make test`. `make cluster-down` deletes the cluster.

### Local gotchas

- **A fresh cluster means a new admin password** (and a new WordPress admin password). Read it again with the command in step 3.
- **Chrome autofill can lock you out.** Chrome may fill the password saved for `app.localtest.me` from a previous cluster. Five bad logins for one email lock that email for 15 minutes (ADR 020). The counters are in gateway memory, so restart the gateway to clear the lock, then log in with the new password:

        kubectl -n urumi rollout restart deploy/gateway

  Delete the stale saved passwords for `app.localtest.me` and `shop.localtest.me`, or use a clean browser profile.
- **`shop.localtest.me` resolves to 127.0.0.1 inside pods too**, which is the pod itself, not the store. Pods must reach the store by service name; the public hostname only works from your machine.
- Image tags are git tree hashes: commit changes under `services/` or `apps/` before `make deploy`, or the running pod keeps the old image.

## Deploy to a VPS

Tested on one Azure B2als_v2 (Ubuntu) running k3s `v1.35.5+k3s1` with `--secrets-encryption`. Public hostname is `<ip>.sslip.io` (`global.domain` in `deploy/values-prod.yaml`).

1. NSG inbound: 22 from my IP only, 80 and 443 from anywhere. **6443 is not public.**
2. Install k3s on the node, then check `sudo k3s secrets-encrypt status` says Enabled.
3. Open the API through an SSH tunnel and keep it open in its own terminal (`ServerAliveInterval` stops it dropping when idle):

        ssh -i ~/.ssh/urumi-vps -o ServerAliveInterval=30 -N -L 16443:127.0.0.1:6443 azureuser@<VPS IP>

   `~/.kube/urumi-vps.yaml` points at `https://127.0.0.1:16443`, context `urumi-vps`.
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

## Stand-out items

Numbered as the optional list in `docs/REQUIREMENTS.md`. What was skipped, and why, is in `docs/DESIGN.md`.

1. **VPS deploy with Let's Encrypt TLS:** one k3s node at `https://app.20.197.63.44.sslip.io`, cert-manager, `deploy/values-prod.yaml`, ADR 024 (sections above).
2. **Tool permissions per role:** admins choose which tools members may see and call, in `tools/list` and on every call; ADR 022, `services/gateway/src/`.
6. **Security hardening:**
   - SSRF: `services/gateway/src/url-guard.ts` rejects private and metadata addresses, and egress NetworkPolicies repeat the same ranges (ADR 019, 009).
   - Default-deny ingress, per-workload egress policies, non-root containers (`charts/*/templates/`).
   - Upstream credentials encrypted with AES-256-GCM, key rotation with `make rotate-key` (ADR 023); k3s Secrets encryption on the VPS.
7. **Rate limits** (the scaling half is not done, ADR 006): login, per-key `/mcp` calls and sessions, daily chat cap (ADR 020).
8. **Observability (PARTIAL):** health/readiness probes and the per-user audit log; no metrics or alerting (`docs/DESIGN.md`).
9. **Upgrade and rollback:** `helm rollback` rehearsed on the VPS, image tag = git tree hash (section above, ADR 024).

Also built:

- **Postgres backups and restore check:** CronJob dump to a PVC, `make backup-pull` copies it off the box, `make restore-check` takes a fresh backup and proves it restores (ADR 025).
- **Tool-result size cap on `/mcp`:** `MAX_TOOL_RESULT_BYTES`, default 1 MB (`services/gateway/src/config.ts`, `docs/THREAT_MODEL.md`).
- **CI:** `.github/workflows/ci.yml` runs `make lint`, `make test` and the hook tests on every push to main and every pull request (no cluster, no secrets).
