# 019: Default-deny ingress, per-workload egress

**Status:** accepted
**Date:** 2026-10-19

## Context
Only woo-mcp, fx-mcp, notes-mcp and gateway-postgres had ingress policies. MariaDB and WordPress accepted any pod, nothing limited egress, and the gateway could reach any address an admin registered as an upstream URL (the gap left open in ADR 009).

## Decision
- **Default-deny ingress** for the whole namespace (`charts/platform/templates/default-deny-ingress.yaml`). Every pod needs an explicit allow.
- **No namespace-wide default-deny egress.** The store setup Job calls the Kubernetes API (fills the `woo-api` Secret) and downloads WooCommerce, and allowing the API server by ipBlock is fragile. The setup Job is the one pod with open egress. Every long-running workload has its own egress policy instead.
- **Selectors for Traefik and CoreDNS** live once in `global.network` (platform values). Namespaces match on `kubernetes.io/metadata.name`.
- **Ports are container ports**, not Service ports: kube-router checks after the Service is translated to the pod. Hard-coded where the Deployment hard-codes them (WordPress 80, MariaDB 3306, Postgres 5432); all upstream charts and the gateway policy read `global.network.upstreamPort`.

| Workload | Ingress from | Egress to |
|---|---|---|
| store-mariadb | wordpress, setup Job (3306) | nothing |
| store-wordpress | Traefik, woo-mcp (80) | DNS, mariadb 3306, public 443 |
| woo-mcp | gateway | DNS, wordpress 80 |
| gateway | Traefik (8080) | DNS, gateway-postgres 5432, woo-mcp/fx-mcp/notes-mcp (3000), public 443 |
| gateway-postgres | gateway (5432) | nothing |
| fx-mcp, notes-mcp | gateway | DNS |
| dashboard | Traefik (8080) | nothing (nginx has no proxy_pass) |

"Public 443" is `0.0.0.0/0` except 10/8, 172.16/12, 192.168/16, 169.254/16 and 100.64/10, the same ranges as `url-guard.ts`.

## Consequences
- url-guard is the first layer (it also rejects bad URLs with a clear error); the NetworkPolicy is defence in depth that holds even against DNS rebinding. A public upstream on any port other than 443 is now blocked by design.
- The gateway can no longer reach the Kubernetes API, WordPress, metadata endpoints or other private addresses.
- **Limitation:** inside the namespace a label is the identity. Any pod created in `urumi` with `app.kubernetes.io/name=setup` reaches MariaDB (the test probe does exactly that). The namespace is the trust boundary, and RBAC on pod create is the real control.
- Probes: kube-router rejects blocked traffic (exit 7 / ECONNREFUSED). Test WordPress with `/wp-json/`, not `/`, which redirects to the public host and fails for an unrelated reason.
- **One shared port (was manual coupling):** the upstream container port is a single value, `global.network.upstreamPort` in `charts/platform/values.yaml`; woo-mcp, fx, notes and the gateway egress policy all read it, so they cannot drift. Registered upstream URLs (`seedWooUrl`, `make register`) still spell the port and must match.
