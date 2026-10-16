# 012: Dashboard stack and dev loop

## Decision
- Vite + React 19 + TypeScript, `react-router-dom` for pages, plain `fetch` wrapper (`src/api.ts`), plain CSS. No UI kit, no react-query.
- Auth state lives in one `AuthProvider` (`status: loading | ready`, `user`). On load it calls `GET /api/me`.
- Node `^20.19 || >=22.12` (Vite 8 requirement, set in `engines`). Installed here: v24.20.0.
- `make lint` runs `tsc --noEmit` and eslint for the dashboard, because Vite does not typecheck.

## Why
- Each piece is one sentence: Vite builds, React renders, the router maps URL to page, `api()` sends JSON with the cookie. Nothing hides behaviour.
- A UI kit or query cache is a big dependency to defend for four small pages.

## Role checks
`RequireUser` and `RequireAdmin` only decide what the UI shows. The boundary is the gateway: every admin route uses `requireAdmin`, so a member who types `/servers` or calls `/api/servers` directly still gets 403. Both guards render "Loading…" while `/me` is pending, so a reload never bounces a logged-in user to `/login`.

## Expired sessions
`api()` calls an `onUnauthorized` callback on any 401 except `/auth/*` and `/me`. `AuthProvider` sets it to clear the user, so `RequireUser` sends them to `/login` and remembers the page (`location.state.from`).

## Dev loop (before the nginx task)
`npm run dev` serves on `localhost:5173`; Vite proxies `/api` to `http://app.localtest.me` (the gateway in k3d).
1. `changeOrigin: true` is required: Traefik routes by Host header.
2. The session cookie has no `Domain`, so it is host-only and the browser keeps it for `localhost`. `COOKIE_SECURE` is unset locally.
3. The gateway checks no `Origin`/`Referer`; CSRF defence is JSON-only bodies (415 otherwise) plus `SameSite=Strict`, and the proxy makes the dev calls same-origin. If an Origin check is added later (Phase 7), have the proxy rewrite `Origin` in dev. Never add a dev origin to a gateway allowlist.

## Later
In-cluster the dashboard is static files behind nginx and Ingress sends `/api` and `/mcp` to the gateway (Phase 5, checkboxes 5 and 6). Ingress paths move into chart values there.
