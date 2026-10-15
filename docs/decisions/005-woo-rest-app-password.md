# 005: woo-mcp talks to WooCommerce over REST with an Application Password

**Status:** accepted
**Date:** 2026-10-15

## Context
woo-mcp must list and create products and read and update orders in a WooCommerce store running in the
same cluster. There are three ways in: the Woo REST API, WP-CLI inside the WordPress pod, or the MariaDB
database directly.

## Decision
woo-mcp calls the WooCommerce REST API v3 (`http://store-wordpress/wp-json/wc/v3/...`) with HTTP Basic
auth, using a WordPress Application Password. The setup Job creates the password and stores it in the
`woo-api` Secret (ADR 004); woo-mcp reads it through `secretKeyRef`.

## Alternatives considered
- **WP-CLI (`kubectl exec` into WordPress):** woo-mcp would need RBAC for `pods/exec`, which is close to
  cluster-admin over the store pod. Output is text to parse, and every call pays a PHP start-up.
- **Direct database access:** bypasses WooCommerce's own logic (stock, order status hooks and emails,
  lookup tables, HPOS storage). The schema is internal and changes between versions, and the DB
  credential can read everything, including customer data.

## Consequences
- The REST API enforces Woo's validation and fires its hooks, so an order status change behaves exactly
  as if an admin made it. Errors come back as JSON that woo-mcp turns into MCP tool errors.
- The credential is one revocable Application Password for one app. It can be rotated by deleting it in
  WordPress without touching the DB password.
- Application Passwords refuse plain HTTP unless `WP_ENVIRONMENT_TYPE=local` (set from values), and
  in-cluster traffic is HTTP. The password is only sent inside the cluster.
- Plain permalinks break `/wp-json/`, so the setup Job sets `/%postname%/`. If it ever breaks, WordPress
  answers 200 with HTML. woo-client reports that as "unexpected non-JSON response".
- The Application Password carries the permissions of the WordPress user it was created for, so a leaked
  woo-mcp pod can do whatever that user can in the store.
  That is why the NetworkPolicy only lets gateway pods in and the pod runs non-root with a read-only
  filesystem.

## Verified behaviour of the NetworkPolicy on k3s
- Kubelet probes (`/healthz`, `/readyz`) keep passing with the policy applied: the pod went `1/1 Running`
  with the NetworkPolicy in place, so no extra rule is needed on k3s.
- A pod without the gateway label is blocked, but k3s's policy engine (kube-router) **rejects** instead of
  dropping, so curl gets "Connection refused" (exit 7) at once, not a timeout (exit 28). To prove the block
  is the policy and not DNS or a wrong namespace, a test must also show that a pod labelled
  `app.kubernetes.io/name=gateway` reaches the same URL.
- kube-router syncs policy for a new pod IP after a short delay. A pod that curls in its first second can
  be refused even with the right label. Tests wait for the pod to be Ready plus a few seconds.
- Egress from woo-mcp is not restricted (it only needs `store-wordpress`). Left out of scope for now.
