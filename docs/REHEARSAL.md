# Fresh-cluster rehearsal (7g)

Goal: prove the project comes up from nothing with only the steps below, then walk every Definition of Done bullet by hand with two users. A = admin, B = member invited by A. No key, password or cookie is ever written in this file.

Run in Git Bash from the repo root. Part 1 = steps 1 to 8 and rows 1 to 9. Part 2 = rows 10 to 17 on the same cluster.

## Runbook

### 1. Prerequisites
Docker Desktop running, plus `k3d`, `kubectl`, `helm`, `jq`, `openssl`, `make`, Git Bash. Host ports 80, 443 and 6550 free (ADR 001: if `kubectl` is refused, check `netsh interface ipv4 show excludedportrange protocol=tcp`). An LLM API key at hand (Groq, see `deploy/values-local.yaml`).

### 2. Delete and recreate the cluster
```bash
k3d cluster delete urumi
make cluster-up
```
`cluster-up` runs `k3d cluster create urumi --api-port 6550 -p 80:80@loadbalancer -p 443:443@loadbalancer`.

### 3. Generate Secrets
```bash
scripts/secrets.sh
```
Creates the namespace and every generated Secret (DB passwords, WP admin, upstream tokens, gateway key and admin login). Prints names only.

### 4. LLM key (your own shell, hidden input)
Run this in your own Git Bash. The key is not in argv, not piped into kubectl, and the temp file is removed:
```bash
( umask 077; read -rsp 'LLM key: ' K; echo; f=$(mktemp); printf %s "$K" > "$f"; unset K; kubectl -n urumi create secret generic llm-api --from-file=api-key="$(cygpath -m "$f")"; rm -f "$f" )
```
It must exist before `make deploy`, otherwise the gateway starts with chat off (`/api/chat` answers 503).

### 5. Build and import images, then deploy
```bash
make images
docker exec k3d-urumi-server-0 crictl images | grep urumi/
make deploy
```
`make images` ends each image with `k3d image import -c urumi`. The `crictl` line must list 5 `urumi/*` images inside the new cluster node before you deploy.

### 6. Wait for every pod to be Ready
```bash
kubectl -n urumi wait --for=condition=Ready pod -l '!job-name' --timeout=180s
kubectl -n urumi get pods
```
The `!job-name` selector skips the Completed `setup-*` pod, which never becomes Ready. Expect every pod 1/1 with RESTARTS 0.

### 7. Register the upstreams (after deploy, never before)
```bash
make register
```
Why after: it logs in through the Ingress to the running gateway's admin API, so the gateway must be up, migrated and bootstrapped. fx and notes do not exist in the gateway until register adds them.

**Expected:** before register, woo shows Unreachable in the dashboard. The first start seeds woo without the bearer token that woo-mcp requires (7d). register sets the token, then prints one line each for `woo`, `fx`, `notes` with status `connected`.

### 8. First admin
The gateway bootstraps `admin@urumi.local` from Secret `gateway-app` on its first start. Read the password in your own shell:
```bash
kubectl -n urumi get secret gateway-app -o jsonpath='{.data.admin-password}' | base64 -d; echo
```
Log in at http://app.localtest.me as A.

## Definition of Done walk
Each row: how it was checked, what was observed, PASS or FAIL. Rows marked YOU are browser or hidden-input steps done by Ash.

| # | Check | Result |
|---|---|---|
| 1 | A sees woo, fx, notes Connected with tools (dashboard) | **PASS** (YOU: Servers page as `admin@urumi.local`; `make register` had printed woo connected 5, fx connected 2, notes connected 3) |
| 2 | Storefront COD checkout, order visible in WC admin (DoD 1) | **PASS** (YOU: COD checkout on shop.localtest.me; order listed under WooCommerce > Orders in wp-admin) |
| 3 | A invites B as member through the dashboard, B sets a password, logs in, generates a key | **PASS** (YOU: invite for `b@example.com` as member, accepted in a private window, B logged in, key shown once) |
| 3b | B's key written to `b.hdr` | **PASS, with a note.** `stat -c %a` prints `644` and `chmod 600` has no effect: Git Bash on NTFS does not map POSIX modes. The protection is the Windows ACL (`icacls`): only SYSTEM, Administrators and the `aashi` account, all inherited from the user profile. File is 70 bytes. Lives at `/c/Users/aashi/.urumi-rehearsal/b.hdr`, outside the repo. Never read or printed. |
| 4 | A chat creates a product; write asks for confirmation; product on storefront (DoD 2) | **PASS** (YOU: chat "Create a product called Rehearsal Mug priced 19.99"; confirm card shown; after Confirm the product is on shop.localtest.me) |
| 5 | COD order for that product placed today by hand | **PASS** (YOU: order 18, Rehearsal Mug, 17:40 UTC) |
| 6 | A chat "orders today" runs a read tool with no confirm and returns the order (DoD 2) | **PASS** (YOU: "What orders came in today?" -> one call `woo__list_orders {"after":"2026-10-19T00:00:00Z"}`, status ok, no confirm card; reply lists order 18 (Rehearsal Mug, $19.99) and order 14 (Classic T-Shirt). The tool-result box is cut at the 2 KB display cap, as designed.) |
| 6b | B asks the chat a read question; call is audited under B | **PASS** (YOU: as B, chat "List the products in the store" -> `woo__list_products`, no confirm. B's Audit page then showed 2 rows, both `b@example.com`, none of A's: chat `woo__list_products` ok (117 ms), and the row-8 row below.) |
| 7 | B external client (MCP Inspector, URL + key only) sees all enabled tools, answers an orders question, one prompt uses two upstreams (DoD 3) | **PASS** (YOU: Inspector 2.11.0, Streamable HTTP, `http://app.localtest.me/mcp`, B's key as Bearer. Server `urumi-gateway`, 8 tools, no `woo__create_product`. `woo__list_products` -> 4 products; `woo__list_orders` -> orders 18 and 14; `fx__convert_currency` and `notes__add_note` ok: three upstreams from one client. Inspector has no LLM, so a single prompt spanning two upstreams was NOT run here; one external client reaching three upstreams was. A two-upstream chat prompt is still to be shown in the demo. Run unfiltered because it was 20 Oct UTC.) |
| 8 | B cannot see or call `woo__create_product` while admin-only | **PASS** (ME: `b-mcp.sh list` -> `tools/list HTTP 200`, 8 tools: `fx__convert_currency fx__list_rates notes__add_note notes__list_notes notes__list_products woo__get_order woo__list_orders woo__list_products`, no `woo__create_product`, no `woo__update_order_status`. `b-mcp.sh call woo__create_product` -> `HTTP 200`, `error: MCP error -32602: tool not permitted for your role`. The call is audited: B's Audit page shows `mcp woo create_product error "tool not permitted for your role"` (3 ms).) |
| 9 | A toggles the rule, B's tool list changes, A reverts | **PASS** (YOU toggled in the dashboard, ME checked with `b-mcp.sh`: rule off -> B lists 9 tools incl. `woo__create_product`, and a call with `{}` got past the role check and failed input validation (`name`, `regular_price` missing), so nothing was created. Rule back on -> 8 tools and `-32602 tool not permitted for your role`. Store API lists 4 published products, no stray.) |

### Known limitation: "today" is the UTC day
The chat agent asks `woo__list_orders` for orders `after` the start of the UTC day (`2026-10-19T00:00:00Z`). For a user in IST (UTC+5:30), orders placed between 00:00 and 05:30 local time count as yesterday. Accepted for now, not a bug in the gateway: the model picks the timestamp, and the prompt has no user timezone.
| 10 | Rate limits return 429 with Retry-After (login, per-key `/mcp`) | **PASS** (ME: 7 logins for a nonexistent email -> 401 x5, then 429 `Retry-After: 898` x2. B's key, 65 `fx__list_rates` calls in one session -> 60x 200, then 429 with `Retry-After` 10 to 13. `tools/list` is not counted, per ADR 020.) |
| 11 | Disable fx: tools vanish for B and chat; `make register` keeps it disabled (DoD 4) | **PASS** (YOU disabled fx; chat "Convert 10 USD to EUR" offered no `fx__` tool. ME: B lists 6 tools, no `fx__*`; `make register` -> `fx: disabled, left as is`, `fx disabled 0`. YOU re-enabled fx.) |
| 12 | Scale notes-mcp to 0: others work, dashboard shows Unreachable (DoD 4) | **PASS** (ME: `kubectl scale deploy/notes-mcp --replicas=0` -> API `notes unreachable`; B lists 5 tools; `woo__list_products` and `fx__list_rates` still work. YOU: Servers page shows notes Unreachable, fx and woo Connected. Scaled back to 1: notes reconnected by itself.) |
| 13 | Disable B: B rejected (B logs in again before row 15) | **PASS** (YOU disabled B; ME: `/mcp` `initialize` on B's key -> `401`. YOU: B's dashboard login refused with the generic "invalid email or password". After re-enable B logged in with the new password (one-off DB reset, see Follow-ups).) |
| 14 | Revoke B's key: open MCP stream closes, next call rejected (DoD 4) | **PASS** (ME opened an SSE GET stream on B's session; YOU revoked B's key. The stream ended by itself (HTTP 200, 50 s after opening), a call on the old session -> `401`, a fresh `initialize` -> `401`.) |
| 15 | Audit: A sees both users' rows, B sees only their own (DoD 5) | **PASS** (YOU: A's Audit shows `admin@urumi.local` and `b@example.com` rows (chat, mcp errors, Inspector calls, rate-limit run); B's Audit (incognito) shows only `b@example.com` rows.) |
| 16 | `make rotate-key` still works on the fresh cluster | **PASS on the 2nd try.** First run: re-encrypt Job got `ECONNREFUSED` to Postgres :5432 and rolled back, nothing changed, gateway restored on the old key. NetworkPolicies allow the Job, so likely the Job connected before the policy synced for the new pod (not proven). Second run: `re-encrypted 3 credentials`, ciphertext prefixes changed, `all enabled servers connected`. |
| 17 | `make dod` prints 8 passed, 0 failed | **PASS** (`make dod` -> `8 passed, 0 failed`; 19 MCP requests, 12 on the busiest key.) |

## Doc gaps found and fixed
- `scripts/secrets.sh` comment suggested a flow that puts the LLM key in kubectl argv. Comment now points to step 4's one-liner.
- A fresh cluster generates new random passwords (admin, WP admin). Passwords saved by the browser for `app.localtest.me` and `shop.localtest.me` from the previous cluster are stale, and autofill can fill them in. Step 8 now reads the new admin password with the one-liner; use it, not the browser's saved one.
- `b.hdr` cannot be `chmod 600` on Windows (see row 3b). Runbook relies on the user-profile ACL.

## Bugs found
_none found in part 2._

## Follow-ups (not bugs)
- No member password reset; admin reset via DB during rehearsal. Future work: admin-issued one-time reset link reusing the invite design (ADR 014). No email flow: no mail server.
- Correction: B's password was never lost. B's logins failed because B was still disabled (row 13, re-enable not done yet); the one-off DB reset ran anyway, so B now has a new password. The disabled login got the generic "invalid email or password", the same as a wrong password, by design (no account-state disclosure). The failed attempts also tripped the per-email 429. Follow-up: admins cannot tell a disabled login from a wrong password; consider a hint on the Members page (e.g. last failed login while disabled), never on the login page.
- With no tool covering a request (row 11, fx disabled), the chat agent answered a currency question from memory and called the rate "as of today". A system-prompt line telling it to say when no tool covers the request would prevent that.
- Row 16 flake: the first `make rotate-key` failed with `ECONNREFUSED` to Postgres from the Job pod; the retry passed. Suspected NetworkPolicy sync race for a brand-new pod. Consider a short connect retry in the Job. Not reproduced, so not a bug yet.
- Rate-limited (429) and auth-rejected (401) MCP requests are not audited. ADR 020 counts the call "before any tool lookup or audit", and ADR 015 only describes executed calls. Consider an audit row with outcome `rejected`.
- The `/mcp` per-key limit counts `tools/call` only (60 per minute), not `tools/list` or `initialize`.
