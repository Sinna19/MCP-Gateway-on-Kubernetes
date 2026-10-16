# 010: fx-mcp, a token-protected upstream with static rates

Status: accepted (Phase 4)

## Context
The assignment needs at least two upstreams besides woo, and one of them should need a credential so the gateway's encrypted upstream-credential path is exercised for real. It also gives the demo a prompt that spans two upstreams ("total today's orders and convert to EUR").

## Decision
- `fx-mcp` has two tools: `convert_currency` and `list_rates`.
- **Rates are a static table** priced against USD, with a fixed `as_of` date in every result. No internet or API key is needed, tests are deterministic, and nothing can fail during the demo. Cross rates go through USD.
- **Rounding**: each currency has a minor-unit count (JPY 0, others 2). The rate is returned unrounded; only `result` is rounded to the target currency's decimals. `amount` is capped at 1e12 so JSON never uses exponent notation.
- **Auth**: `/mcp` needs `Authorization: Bearer <token>`. The scheme is case-insensitive (RFC 6750). Both sides are hashed with SHA-256 and compared with `timingSafeEqual`, so length and timing leak nothing. `/healthz` and `/readyz` are open for the kubelet probes.
- **Startup guard**: `FX_TOKEN` must be at least 32 characters. An empty Secret key stops the pod instead of letting any token through.
- **Token source**: Secret `fx-mcp-token` (key `token`), created by `scripts/secrets.sh`, injected as an env var. Env vars are read once at start, so **rotating the token needs `kubectl rollout restart deploy/fx-mcp`**, the same as woo (ADR 004). The new value must also be updated in the gateway's registration of fx.
- **Deployment**: lives in `charts/upstreams` under an `fx:` block (notes-mcp will sit beside it). ClusterIP, no Ingress, NetworkPolicy lets only `app.kubernetes.io/name=gateway` in. Removing the block (`--set fx=null`) renders nothing.

## Consequences
- The bearer token is a second layer next to the NetworkPolicy, not a replacement for it.
- Rates are fake. That is stated in the tool description's "fixed demo rates" and in the `as_of` field.
- Conversion rounding uses floats because the rates are fake and static; real money would use integer minor units or a decimal library.
