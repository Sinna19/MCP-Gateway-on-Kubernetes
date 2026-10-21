# 024: Deploying to the VPS

## Context
Phase 8 puts the same charts on a single-node k3s VPS (public hostname `<ip>.sslip.io`, shared domain, so Let's Encrypt rate limits matter). Only `deploy/values-prod.yaml` may differ from local. Two risks: a command aimed at the wrong cluster, and a destructive command that burns certificate rate limits.

## Decisions
1. **Cluster selection.** `ENV=local|prod` in the Makefile picks `KUBE_CONTEXT` (`k3d-urumi` or `urumi-vps`). Only prod sets `KUBECONFIG` (the tunnel kubeconfig), so the default kubeconfig stays k3d. Every `kubectl`/`helm` call passes the context explicitly. `scripts/lib/kube.sh` allows `k3d-*|urumi-vps` and wraps `kubectl`/`helm`. The Claude hook allows k3d, asks before mutating `urumi-vps`, denies any other context. `ENV=prod cluster-up/cluster-down/images` refuse.
2. **Images.** Built locally and side-loaded with `docker save | ssh ... k3s ctr images import -` (session 2). No registry, no pull secret. Our tags are git tree hashes; third-party images are digest-pinned (ADR 023).
3. **TLS.** cert-manager is its own Helm release (CRDs must exist before the platform chart renders ClusterIssuers). The platform chart renders `letsencrypt-staging` and `letsencrypt-prod` ClusterIssuers (HTTP-01 via Traefik) only when `certManager.clusterIssuers` is true, because k3d has no such CRD. `global.ingress.clusterIssuer` adds the `cert-manager.io/cluster-issuer` annotation to the **store and gateway** Ingresses. The dashboard Ingress shares host and Secret `gateway-tls` with the gateway, so annotating it too would create two Certificates for one Secret.
4. **Redirect.** `global.ingress.redirectHttps` renders one Traefik `Middleware` (permanent redirect) used by all three Ingresses. The solver Ingress has a longer path, so the ACME challenge is routed before the redirect.
5. **Solver NetworkPolicy.** The namespace denies ingress by default, and the cert-manager solver pod runs in it. A policy lets the Traefik pod reach pods labelled `acme.cert-manager.io/http01-solver` on 8089. Without it issuance hangs.
6. **Application Passwords in production.** WordPress disables them without HTTPS unless the environment type is `local`. woo-mcp and the setup Job use in-cluster HTTP, so production would answer 401. A mu-plugin (ConfigMap, mounted by subPath into WordPress and the setup Job) enables them when `is_ssl()` or when the request has no `X-Forwarded-For`. Traefik adds that header to every public request, so public plain HTTP is still refused; only in-cluster callers (NetworkPolicy: woo-mcp) get through.
7. **Secure cookies.** `make lint` fails unless values-prod renders `COOKIE_SECURE "true"`. `dod-check` asserts `Secure` and `HttpOnly` on the session cookie over https and prints `cookie Secure: skipped (http)` locally.
8. **Rate-limit safety.** Never delete `gateway-tls`, `store-wordpress-tls` or the namespace on the VPS. Staging issuer first; on `rateLimited` stop (fallback: a real domain).

## Proof on k3d (before the VPS)
`make deploy HELM_EXTRA="--set store.wordpress.environmentType=production"`: setup Job completed, Secret `woo-api` has `password`, `make register` connected woo, `make dod` 8/8 including woo calls. The running `wp-config.php` maps `HTTP_X_FORWARDED_PROTO` containing `https` to `$_SERVER['HTTPS'] = 'on'` (line 122, from the official image), so WordPress sees HTTPS behind Traefik. Redeploy with local values: environment type `local`, `make dod` 8/8.

## Consequences
The mu-plugin is also active locally (harmless). The domain is one line in `deploy/values-prod.yaml`; `make` derives `PROD_DOMAIN` from it. cert-manager version is pinned and recorded in session 2.
