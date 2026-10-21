# Threat model

Scope: the gateway (`services/gateway`), its upstreams (woo-mcp, fx-mcp, notes-mcp), the store, and the chat agent. Trust boundary: the `urumi` namespace plus Traefik. Admins are trusted; members and upstream servers are not. Every pointer below was checked against the code on 2026-10-21; where nothing is done, the row says so.

## The four required questions

### 1. Shared upstream credentials: what can a member do with a credential they never see?
- **Never see it.** Upstream credentials are encrypted with AES-256-GCM (slug as AAD) in `upstream_servers.credential_enc` (`src/crypto.ts`). The API returns only `hasCredential` (`src/api/servers.ts`). Changing a server's URL requires re-entering the credential, so a stored one cannot be redirected to a new host (`api/servers.ts`, "would otherwise be sent to the new host"). Key rotation: ADR 023.
- **What they can do with it.** Everything the credential allows, *through the tools an admin left open to members*. The gateway adds the credential to upstream requests (`src/upstreams.ts`); the member never holds it, but a tool call is the credential's authority acting for them. Limits: admin-only tools (woo's `create_product`, `update_order_status`, ADR 022), 60 calls/min per key (ADR 020), and an audit row per call with the user, tool and redacted args (ADR 015).
- **Not mitigated.** The upstream sees only the shared credential, not the member. notes-mcp therefore cannot tell members apart (ADR 011). Rules are default-open (see risks).

### 2. Why client tokens are not passed through to upstreams
- A member's API key authenticates *to the gateway* only: it is hashed (sha256, `src/api-keys.ts`) and checked in `src/mcp-endpoint.ts`. Upstream clients are built from the stored upstream credential (`src/upstreams.ts`); the caller's `Authorization` header is never forwarded.
- Reasons: an upstream must not be able to replay a member's key against the gateway (a malicious upstream would otherwise collect keys); revoking a key must not depend on an upstream; and upstreams get one identity the admin controls. Credential headers cannot be `Authorization`-spoofed or CRLF-injected on registration (`FORBIDDEN_HEADERS`, `VISIBLE_ASCII` in `api/servers.ts`).
- woo-mcp adds a second layer: its own required bearer token (ADR 021) on top of NetworkPolicy (ADR 019).

### 3. Untrusted upstreams: tool descriptions written to manipulate the model
- **Chat agent (mitigated, ADR 018).** Descriptions and schemas are control-char-stripped, truncated and size-capped; results are cut and wrapped in `<tool_output>` with the wrapper escaped. The real defence is the gateway, not the wrapping: only tools on a gateway-side read-only allowlist run unasked, every other call needs a user confirm on a call the server stored itself, calls per turn are capped (5 per step, 55 s), and the chat UI renders plain text only (no markdown/image exfiltration).
- **External MCP clients on `/mcp` (not mitigated).** `src/gateway.ts` / `src/mcp-endpoint.ts` pass upstream descriptions and results through unchanged, so a third-party client's model sees raw upstream text. The protection there is the client's own, plus admin-only vetting of who can add an upstream (an admin adds servers; members cannot).
- **Compromised or malicious server.** A malicious upstream can lie in results, return huge or endless tool lists (capped: 20 pages / 500 tools, `MAX_LIST_PAGES`/`MAX_LIST_TOOLS` in `src/upstreams.ts`), hang (15 s call timeout, ADR 006) or point the gateway inward: URL guard at registration and connect time (`src/url-guard.ts`), gateway egress NetworkPolicy to public 443 only (ADR 019), redirects never followed (`limitedFetch`). It receives only its own credential. Its tools can be disabled instantly by an admin; sessions are told via `list_changed`.

### 4. What one member can do to another
- **Cannot:** read others' keys or sessions (keys hashed, a session is bound to the key that opened it, ADR 006); see others' audit rows (`api/audit.ts` scopes to own `user_id` for members); change roles, servers or rules (admin-only API); spend another's chat cap (per-user, ADR 020).
- **Can:** read and add every note in notes-mcp, because it is shared (ADR 011), so a member can plant text that another member's LLM later reads (stored prompt injection; limited by the chat confirm gate and the victim's role). Can lock out a known email for 15 minutes by failing logins (see risks).
- Chat history comes from the client; a user can invent their own earlier turns, but every call still runs as them (ADR 018).

## Known risks

| Risk | Impact | Mitigation, or accepted and why | Pointer |
|---|---|---|---|
| Invite token in the URL path | Anyone who reads gateway/Traefik access logs or browser history before the invitee accepts could accept first | Token stored hashed, single-use, expiring; `no-referrer` stops leaks to other sites. Accepted: link-based invites need the token in the URL | ADR 014, `api/invites.ts` |
| notes-mcp cross-user injection | One member's note steers another member's chat/LLM | Confirm gate, role limits, plain-text UI. Accepted: a steered *read* tool can still show its output to the asker | ADR 011, 018 |
| Own images pinned by tag, not digest | Tags are git tree hashes of the source, but nothing at runtime proves the node's image matches (side-loaded, no registry, no signing) | Third-party images and every Dockerfile `FROM` are pinned by digest; own images are content-addressed tags. Accepted: no image signing | ADR 023, 024 |
| Audit redaction never blocks the row write | A redaction failure drops the args, not the row; args keyed `pass/secret/token/key/auth/cookie` are masked, others (customer names, addresses) are stored up to 2 KB | Over-redaction by key name; a failure stores `_unauditable`. Accepted: values are not scanned | ADR 015, `src/audit-args.ts` |
| Upstream pagination and size caps | A hostile upstream floods tool lists or bodies | 20 pages / 500 tools, 15 s call timeout, result cut to 8000 chars in chat; woo-mcp body cap 1 MB. Not mitigated: raw tool-result size over `/mcp` is not capped by the gateway | `src/upstreams.ts`, ADR 018 |
| Irreversible order status changes | A wrong or injected `update_order_status` (e.g. cancelled, refunded) cannot be undone by us | Admin-only tool (ADR 022); chat needs a confirm; audit row. Accepted: no undo, no dry run | ADR 018, 022 |
| Prompt injection via Woo text (product names, customer notes) | Store text enters the model's context | Same data-wrapping and confirm gate as upstream text. Residual risk accepted, as for any LLM reading customer text | ADR 018 |
| mu-plugin trusts a missing `X-Forwarded-For` | Application Passwords are enabled for any request without that header, i.e. unauthenticated-looking plain HTTP | Safe only while the store NetworkPolicy lets just woo-mcp and the setup Job reach WordPress directly; Traefik adds the header to all public traffic. Breaks if that policy is loosened or an unprivileged pod gets the `setup` label | ADR 024, 019; `charts/store/templates/mu-plugin-configmap.yaml` |
| Wide 443 egress | Gateway/WordPress can reach any public host on 443 (exfiltration path if compromised) | Private, link-local and CGNAT ranges excluded; needed for upstream URLs, WooCommerce download and the LLM API. Accepted | ADR 019 |
| Setup Job has no egress policy | The one pod with open egress; also holds Kubernetes API access to write `woo-api` | Short-lived, our own image, no inbound. Accepted: API-server ipBlock is fragile | ADR 019 |
| Namespace label is the identity | Any pod created in `urumi` with the right labels passes NetworkPolicy | RBAC on pod create is the real control. Accepted: namespace is the trust boundary | ADR 019 |
| Per-process limits, single replica | Rate limits, session map and caps reset on restart and would multiply with replicas | One replica by design (strategy Recreate). Scaling out needs shared counters and sticky sessions | ADR 006, 009, 020 |
| Per-email login lockout is a DoS | Anyone can lock a known email out for 15 min with 5 bad logins | Expires by itself; IP bucket never reset by success. Accepted: no CAPTCHA in scope | ADR 020 |
| Best-effort audit | A tool call can run with no audit row if Postgres is down at that moment | Failure is logged, `/readyz` fails so the pod leaves the Service. Accepted: no "started" row | ADR 009 |
| Session-cap race | Parallel `initialize` calls can overshoot 10 sessions per key by a few | Accepted: the cap guards runaway clients, not an exact quota | ADR 020 |
| Tool rules default-open | A new server's tools (or a renamed tool) are usable by members until an admin marks them | Only admins add servers; woo's writes are seeded admin-only. Not mitigated: default-closed is future work | ADR 022 |
| Secret rotation ~30 s downtime | `CREDENTIALS_KEY` rotation stops the gateway (cuts sessions and chat turns) | Single transaction, verified before commit, rollback on failure. Accepted: rare, no dual-key code path | ADR 023 |
| notes-mcp key and woo-mcp token rotate by restart | Env-var secrets only change on pod restart | Documented rotation steps. Accepted | ADR 011, 021 |
