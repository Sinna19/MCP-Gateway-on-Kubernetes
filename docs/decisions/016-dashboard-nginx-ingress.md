# 016: Dashboard on nginx, two Ingress objects

**Status:** accepted
**Date:** 2026-10-16

## Context
The dashboard so far ran only through `vite dev`. It must be served in-cluster at `app.localtest.me/`, next to the gateway's `/api` and `/mcp` on the same host. Invite links (`/invite/<token>`) and pages like `/servers` are client routes, so a reload must not 404. The invite token is in the URL, so it must not leak through the Referer header.

## Decision
- New `charts/dashboard`: a Deployment running `nginxinc/nginx-unprivileged:1.31.7-alpine` (port 8080, UID 101), a ClusterIP Service and its own Ingress for `/`. The image is multi-stage (node build, then nginx) and the nginx config is baked in, so config and app version together.
- The gateway chart keeps its Ingress for `/api` and `/mcp`. Both Ingresses take host and paths from values (`ingress.host`, `ingress.paths`); no path stripping, so the gateway still sees `/api` and `/mcp`.
- Same host in two Ingress objects works because Traefik ranks routers by rule length: the longer `/api` and `/mcp` prefixes win over `/`.
- nginx: `try_files $uri /index.html` for the SPA fallback; `/assets/` uses `try_files $uri =404` so a missing chunk is a real 404, not HTML with status 200; `index.html` is `no-cache`, hashed assets get `max-age=1y, immutable` (only on successful responses); gzip for css, js, json, svg; `server_tokens off`.
- Headers on every response, from one included file: `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and a CSP with `default-src 'self'` plus `img-src 'self' data:`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. The favicon is an inline `data:,` link, so no request and no 404.
- Pod: non-root, read-only root filesystem with an `emptyDir` on `/tmp`, all capabilities dropped, no privilege escalation, probes on `/healthz`.
- `/mcp` never passes through nginx (Traefik goes straight to the gateway), so SSE buffering is unchanged.

## Alternatives considered
- One Ingress with the dashboard in the gateway chart: fewer objects, but the gateway chart would own a second app. Separate charts keep one owner per route.
- nginx as the single entry point proxying `/api` and `/mcp`: adds a hop and buffering risk on SSE for no gain.
- Official `nginx:alpine`: runs as root by default; making it non-root needs extra config.
- Mounting nginx.conf from a ConfigMap: changes without an image rebuild, but the image tag would no longer describe what runs.

## Consequences
- `make deploy` builds the dashboard image tagged with the git tree hash of `apps/dashboard`; commit before building.
- Dashboard changes need an image rebuild (no hot reload); `vite dev` stays the fast loop.
- The strict CSP forbids inline scripts and styles. If a library needs them, fix the library use rather than loosen the policy.
- Interview line: "Same host, two Ingresses, Traefik picks the longest prefix; the SPA fallback is nginx's job and assets 404 properly."
