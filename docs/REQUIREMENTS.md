# Requirements checklist (compact)

Read this instead of docs/ASSIGNMENT.md. Open ASSIGNMENT.md only to check exact wording.

**Layers:** WooCommerce store; our own woo MCP server; gateway (MCP client to all upstreams + one MCP server endpoint) with React dashboard; chat agent in dashboard. Only the gateway talks to upstreams.

**K8s/Helm:** local k8s + same Helm charts on k3s VPS, differences only in values files; Helm only (no Kustomize); everything in-cluster (store, DB, woo-mcp, gateway, dashboard); persistent DB + wp-content; Ingress with stable URLs for storefront and dashboard, local domain approach documented; readiness + liveness + requests/limits on every workload; no secrets in source, use K8s Secrets.

**woo-mcp:** written by us; Streamable HTTP; tools list products, create product, list orders, get order, update order status; not reachable from outside cluster; document how it talks to the store and why.

**Gateway:** admin add/edit/disable/remove upstreams (Streamable HTTP, optional static header or bearer credential); one MCP endpoint aggregating enabled servers' tools and routing calls; documented collision scheme; slow/dead upstream doesn't break others, timeouts with clear errors; upstream credentials never reach browser or MCP clients; at least 3 upstreams (woo + 2 others).

**Team:** roles admin and member; per-user API keys, revocable, stored hashed; audit log of every tool call (user, server, tool, timestamp, duration, outcome) visible in dashboard.

**Chat agent:** LLM tool loop through the gateway, shows tools called, acts as logged-in user (audited under them), any model/provider, LLM key is a Secret.

**Admin stories:** see servers with status Connected/Unreachable/Disabled + tools; woo pre-registered; add/edit/disable/remove server; invite members, issue/revoke keys; audit log.
**Member stories:** generate own key; one URL + key in Claude Code/Cursor shows all enabled tools; chat agent; never sees upstream credentials.

**Definition of done (two users, live):**
1. Storefront: add to cart, checkout (COD), order visible in WC admin.
2. User A chat: create product (name, price), appears on storefront; manual order, "orders today" returns it.
3. User B external client (Claude Code/Cursor/Inspector) with only URL + key: sees all enabled tools, asks orders question, one prompt using tools from two upstreams.
4. Revoke B's key, next call rejected. Disable one upstream, its tools vanish from chat and external client. Kill one upstream pod, others work, dashboard shows it Unreachable.
5. Every call above in audit log under the right user.

**Deliverables:** README (local setup, VPS setup, place order, connect MCP client, use chat); source; Helm charts + values-local/values-prod; DESIGN note (architecture, aggregation/routing/failure handling, prod changes: DNS, ingress, storage class, secrets); THREAT_MODEL note (shared upstream creds, why client tokens aren't passed upstream, malicious tool descriptions, member-vs-member); list of bonus/stand-out items attempted.

**Demo video sections:** system design + live DoD with two users; K8s (namespaces, Secrets, volumes, Ingress, limits, probes, public vs internal); MCP internals (upstream connections, call path, collisions, timeouts, dead upstream); security (key + credential storage, member limits, malicious upstream); chat agent tool loop + acting as user; local-to-VPS story (values diff, ingress/domains/storage/secrets, Helm upgrade + rollback).

**Optional (only after core works):** multi-store bonus; stand-outs: VPS deploy, tool permissions, OAuth, many-tools search, hosted MCP servers, security hardening (SSRF, RBAC, deny-all NetworkPolicies, non-root, encrypted creds), scaling + rate limits, observability, upgrades/rollback.
