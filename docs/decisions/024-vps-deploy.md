# 024: Deploying to the VPS

## Context
Phase 8 puts the same charts on a single-node k3s VPS (public hostname `<ip>.sslip.io`, shared domain, so Let's Encrypt rate limits matter). Only `deploy/values-prod.yaml` may differ from local. Two risks: a command aimed at the wrong cluster, and a destructive command that burns certificate rate limits.

## Decisions
1. **Cluster selection.** `ENV=local|prod` in the Makefile picks `KUBE_CONTEXT` (`k3d-urumi` or `urumi-vps`). Only prod sets `KUBECONFIG` (the tunnel kubeconfig), so the default kubeconfig stays k3d. Every `kubectl`/`helm` call passes the context explicitly. `scripts/lib/kube.sh` allows `k3d-*|urumi-vps` and wraps `kubectl`/`helm`. The Claude hook allows k3d, asks before mutating `urumi-vps`, denies any other context. `ENV=prod cluster-up/cluster-down/images` refuse.
2. **Images.** Built locally and side-loaded with `docker save | ssh ... k3s ctr images import -` (`make push-images`, `scripts/push-images.sh`). It skips tags already on the node. **Ash runs `make images` then `ENV=prod make push-images` from a shell with ssh-agent loaded**: the key is passphrase-protected, so the tool shell cannot ssh. No registry, no pull secret. Our tags are git tree hashes; third-party images are digest-pinned (ADR 023).
3. **TLS.** cert-manager is its own Helm release (CRDs must exist before the platform chart renders ClusterIssuers). The platform chart renders `letsencrypt-staging` and `letsencrypt-prod` ClusterIssuers (HTTP-01 via Traefik) only when `certManager.clusterIssuers` is true, because k3d has no such CRD. `global.ingress.clusterIssuer` adds the `cert-manager.io/cluster-issuer` annotation to the **store and gateway** Ingresses. The dashboard Ingress shares host and Secret `gateway-tls` with the gateway, so annotating it too would create two Certificates for one Secret.
4. **Redirect.** `global.ingress.redirectHttps` renders one Traefik `Middleware` (permanent redirect) used by all three Ingresses. The solver Ingress has a longer path, so the ACME challenge is routed before the redirect.
5. **Solver NetworkPolicy.** The namespace denies ingress by default, and the cert-manager solver pod runs in it. A policy lets the Traefik pod reach pods labelled `acme.cert-manager.io/http01-solver` on 8089. Without it issuance hangs.
6. **Application Passwords in production.** WordPress disables them without HTTPS unless the environment type is `local`. woo-mcp and the setup Job use in-cluster HTTP, so production would answer 401. A mu-plugin (ConfigMap, mounted by subPath into WordPress and the setup Job) enables them when `is_ssl()` or when the request has no `X-Forwarded-For`. Traefik adds that header to every public request, so public plain HTTP is still refused; only in-cluster callers (NetworkPolicy: woo-mcp) get through.
7. **Secure cookies.** `make lint` fails unless values-prod renders `COOKIE_SECURE "true"`. `dod-check` asserts `Secure` and `HttpOnly` on the session cookie over https and prints `cookie Secure: skipped (http)` locally.
8. **Rate-limit safety.** Never delete `gateway-tls`, `store-wordpress-tls` or the namespace on the VPS. Staging issuer first; on `rateLimited` stop (fallback: a real domain).

## Proof on k3d (before the VPS)
`make deploy HELM_EXTRA="--set store.wordpress.environmentType=production"`: setup Job completed, Secret `woo-api` has `password`, `make register` connected woo, `make dod` 8/8 including woo calls. The running `wp-config.php` maps `HTTP_X_FORWARDED_PROTO` containing `https` to `$_SERVER['HTTPS'] = 'on'` (line 122, from the official image), so WordPress sees HTTPS behind Traefik. Redeploy with local values: environment type `local`, `make dod` 8/8.

## Consequences
The mu-plugin is also active locally (harmless). The domain is one line in `deploy/values-prod.yaml`; `make` derives `PROD_DOMAIN` from it. cert-manager is pinned to chart **v1.21.2** (`CERT_MANAGER_VERSION` in the Makefile; latest stable on 2026-10-21), installed by `ENV=prod make cert-manager` with `crds.enabled=true` and small requests (pods use about 1m CPU and 15-30Mi each). `ENV=prod make deploy` no longer builds images; it expects them already side-loaded.

## Proof on the VPS (staging issuer)
Both Certificates (`gateway-tls`, `store-wordpress-tls`) became Ready on the first try with issuer `letsencrypt-staging`: the hairpin self-check works, no solver debugging needed. `curl -skI https://shop.20.197.63.44.sslip.io` gives 200; `http://app.…` gives 308 to https. Node requests: cpu 32%, memory 31%.

## Proof on the VPS (production issuer, 2026-10-21)
- `clusterIssuer` flipped to `letsencrypt-prod`; `ENV=prod make deploy`. Both Certificates Ready with issuer `letsencrypt-prod` on the first try (no rate limit, no Certificate deleted). `openssl s_client` shows `O=Let's Encrypt, CN=YR1` for `app.` and `shop.`.
- `ENV=prod make register` then `ENV=prod make dod`: 9 passed, 0 failed, including `PASS cookie Secure: session cookie is Secure and HttpOnly`.
- NetworkPolicy deny probes: an unlabelled pod is blocked to woo-mcp, WordPress, MariaDB, Postgres and fx-mcp; gateway-labelled and setup-labelled control pods reach their allowed targets.
- Manual checks (Ash, all PASS): admin login with a valid Let's Encrypt cert in Chrome; llm-api Secret created and gateway restarted, chat "what orders were placed today" called woo__list_orders and answered correctly; COD order 14 (Coffee Mug + Classic T-Shirt) placed at the shop and found by chat; MCP Inspector 2.11.0 over Streamable HTTP to `/mcp` with a fresh API key connected and listed 10 tools.
- Gotcha: the SSH tunnel dropped once after about 1h idle. Start it with `-o ServerAliveInterval=30`.

## Proof on the VPS (upgrade and rollback rehearsal, 2026-10-21)
- Before: `helm history platform` revisions 1-3, current N=3 (rev 3 = Postgres backup, after the letsencrypt-prod flip). Gateway env `MCP_CALLS_PER_MINUTE=60`.
- The chart has no `podAnnotations`, so the harmless value was `gateway.limits.mcp.callsPerMinute=61` (well above dod-check's 12 calls per key).
- Upgrade: `ENV=prod make deploy HELM_EXTRA="--set gateway.limits.mcp.callsPerMinute=61"` -> revision 4 deployed, new pod `gateway-56d694fcd4-xpgzj` Running with value 61, `curl -sI https://app.20.197.63.44.sslip.io/healthz` 200.
- Rollback: `helm rollback platform 3 -n urumi --wait` -> revision 5 "Rollback to 3", new pod `gateway-64769f79bc-f67r2` Running with value 60, `gateway-tls` and `store-wordpress-tls` Ready on `letsencrypt-prod`, healthz 200, `ENV=prod make dod` 9 passed, 0 failed.
- Rule kept: one revision back only, never at or before the prod-issuer flip or the backup revision; no TLS Secret or namespace deleted.

## `make dod` on the VPS (review fix, 2026-10-21)
- `scripts/dod-check.sh` refuses any context that is not `k3d-*` unless `DOD_ALLOW_PROD=1`. `ENV=prod make dod` sets it, so checking the public hostname stays possible but is a deliberate act.
- By design a user `dod-member@example.com` (role member) and Secret `dod-member` exist on the VPS gateway. The script reuses them on every run; only its API keys are revoked afterwards. notes-mcp replicas and fx enabled state are restored by the EXIT trap.
