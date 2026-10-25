# Demo script (recorded against the live VPS)

Estimated about 21 minutes total (sections: 6.5 + 2.5 + 5 + 3.5 + 1.5 + 2.5). `docs/ASSIGNMENT.md` sets no video length limit (checked), so this is my own budget. If it must shrink: skip the delete-pod step in 3.2 and the edit in 3.4 (about 1.5 min), and explain rollback from the history only.

- App: https://app.20.197.63.44.sslip.io (dashboard, `/mcp`). Store: https://shop.20.197.63.44.sslip.io.
- **Never** on the VPS: reset or recreate the cluster, delete the namespace, delete `gateway-tls` or `store-wordpress-tls` (Let's Encrypt rate limits, ADR 024), or roll back more than one Helm revision.
- User A = `admin@urumi.local`. User B = a new member (not `dod-member@example.com`, which `make dod` owns).
- No secret is ever on screen: password, API key and LLM key come from the clipboard, off camera.

## Pre-recording checklist (do these before recording; none were run when this file was written)

Everything below touches the live VPS, so it is for me to run, not Claude.

0. **Azure portal:** `urumi-vps-nsg` SSH rule (priority 340), Source = My IP address, Save, wait 30 s (my home IP changes daily). Without this the tunnel in step 2 times out.
1. **Cluster is not reset.** Do not run `cluster-down`, `cluster-up` or anything that deletes TLS Secrets. "Fresh" here means a clean browser profile and fresh credentials, not a fresh cluster.
2. **SSH tunnel up** in its own terminal, with the keepalive (it dropped once after about 1 h idle, ADR 024):

        ssh -i ~/.ssh/urumi-vps -o ServerAliveInterval=30 -N -L 16443:127.0.0.1:6443 azureuser@20.197.63.44

   Local port 16443 matches `server: https://127.0.0.1:16443` in `~/.kube/urumi-vps.yaml`.

3. **kubectl works against the VPS** (Git Bash):

        export KUBECONFIG=~/.kube/urumi-vps.yaml
        kubectl --context urumi-vps -n urumi get pods

   Expect every pod 1/1 Running. `setup-*` Job pods are TTL-deleted after 600s, so they may not be listed; that is expected. Also `helm --kube-context urumi-vps history platform -n urumi` and note the current revision for section 6 (expected 7; read it off the output).
4. **Admin password** (copy, do not print on screen; paste into the login form during the recording):

        kubectl --context urumi-vps -n urumi get secret gateway-app -o jsonpath='{.data.admin-password}' | base64 -d | clip

5. **Clean Chrome profile.** Use a new profile or guest window with autofill and password saving off. Stale saved passwords caused login lockouts before (5 bad logins locks an email for 15 min; clear it with `kubectl --context urumi-vps -n urumi rollout restart deploy/gateway`, which also drops MCP sessions, so do it before recording). Chrome Guest window for user B (not Incognito: incognito windows share cookies).
6. **Seed data.** Storefront has products (WooCommerce sample data from setup). Decide the product name for A to create (default: "Demo Mug", 19.99) and check it does not exist yet (there is no storefront search; the Shop page lists all products). Use a fresh product name per rehearsal so the recording name stays unused. Servers page shows woo, fx, notes all connected with 5, 2, 3 tools. If not, `ENV=prod make register`.
7. **Chat is on.** Secret `llm-api` exists (`kubectl --context urumi-vps -n urumi get secret llm-api -o name`). Otherwise `/api/chat` answers 503.
8. **User B is NOT created beforehand.** The invite and B's first key are done on camera (section 1, step 5). Pick an unused B email for this take. Keep a Chrome Guest window ready (incognito windows share cookies with each other, so B must be in a Guest window while A uses the normal one).
9. **Second key for B, off camera, for Claude Code only.** Once B exists (a rehearsal take, or right after step 5 of the recording), B creates it on My Keys (shown once, starts with `umk_`) and it goes straight into `claude mcp add`. B's first key is the one made on camera and pasted into Inspector. Revoke any older B keys from earlier takes so section 4's revoke is unambiguous.
10. **MCP client config ready** (the key stays out of frame):
    - MCP Inspector (proven in the rehearsal): transport Streamable HTTP, URL `https://app.20.197.63.44.sslip.io/mcp`, header `Authorization: Bearer <B's key>`. Have it open but not connected; B's key is pasted on camera right after it is generated (section 1, step 5), with the key cropped or blurred.
    - Claude Code, for the two-upstream prompt (rehearsed 2026-10-22 as member B on the VPS, REHEARSAL row 7), using B's second key. Off camera, from a scratch folder OUTSIDE the repo (`mkdir -p ~/urumi-demo-scratch && cd ~/urumi-demo-scratch`), default local scope, never `--scope project` (it would write the key into a `.mcp.json`): `claude mcp add --transport http urumi-demo https://app.20.197.63.44.sslip.io/mcp --header "Authorization: Bearer umk_..."`. It is removed in step 14.
11. **Terminal and screen.** Terminal font 18 to 20 pt, window about 100 columns, dark background, browser zoom 125%. Close other tabs, Slack and notifications. Terminals: (T1) tunnel, (T2) kubectl with `KUBECONFIG` exported, (T3) spare, (T4) Inspector server (start before recording, keep minimized: it prints its auth token), (T5) Claude Code in the scratch folder.
    - Before recording: enter B's key in Inspector off camera, disable claude.ai connectors in `/mcp`, turn off recaps in `/config`, apply pending Claude Code updates.
    - Inspector tips: connect Inspector fresh right before section 1 step 6 (sessions are in memory; "Session not found" means disconnect and reconnect). Close the Results panel between calls.
    - Limits: per-user daily chat cap (ADR 020, UTC day, resets 05:30 IST) plus Groq rate limits.
    - Each take: new B email (members can only be disabled, not deleted), a fresh B key, a new product name. Revoke B's key on camera every take (Members page, as A).
12. **Pre-type** the long commands in a scratch file (not in the repo) so the recording is not spent typing.
13. **Rehearse sections 1 and 3 once** with the clock running; they carry the live risk.
13a. **Second key for B, ready for section 1 step 7.** As B (Guest window), generate a second key off camera; from the scratch folder run `claude mcp add` with it, so section 1 step 7 is ready. Remove it in step 14.
13b. **Chat budget per take:** A sends 4 chat prompts, B sends 2 (Claude Code and Inspector don't count). Mock and final takes on different UTC days (resets 05:30 IST), or confirm the daily cap covers both.
14. After recording: revoke B's second key (the Claude Code one) as A on the Members page, and run `claude mcp remove urumi-demo -s local` from the scratch folder. Then confirm `kubectl --context urumi-vps -n urumi get deploy` shows notes-mcp 1/1 and fx enabled on the Servers page.

## Definition-of-done flow, mapped to sections

The DoD runs once, live, in this order, with no reset between steps. It is spread over the sections so each topic is shown when it is explained.

| Order | DoD step | Section |
|---|---|---|
| 1 | COD order in the shop, visible in WC admin | 1 |
| 2 | A chat creates a product, product on the storefront | 1 |
| 3 | A orders it by hand, chat "orders today" returns it | 1 |
| 4 | B (invited and key generated on camera) connects an external client, sees all tools, orders question, two-upstream prompt | 1 |
| 5 | Dead upstream (notes-mcp pod deleted, then scaled to 0), others keep working | 3 |
| 6 | Disable fx, tools vanish for chat and client (both checked live), re-enable | 3 |
| 7 | B cannot call an admin-only tool, then revoke B's key, next call rejected | 4 |
| 8 | Audit shows every call under the right user (A all, B own), walked row by row | 4 |

## 1. System design and the DoD flow (about 6.5 min)

**On screen:** `docs/DESIGN.md` section 1 (architecture diagram), then the browser.

**Say:** "A WooCommerce store, our own woo-mcp server and two small upstreams (fx, notes) run in one namespace. The gateway is an MCP client to each upstream and one MCP server at `/mcp`; the dashboard and the chat agent sit on the same gateway code path. Everything is in the cluster, and only the shop and the gateway are public." (30 s on the diagram, then go live.)

**Live steps:**

1. Dashboard login as A: https://app.20.197.63.44.sslip.io (paste password). Servers page: woo, fx, notes connected with tool counts. Say: "woo was registered first, automatically, by the gateway's bootstrap on its first start (`SEED_WOO_URL`); fx and notes were added later with `make register`." Point out `notes__list_products` next to `woo__list_products` (the collision, explained in section 3).
2. Store: https://shop.20.197.63.44.sslip.io, add a product, check out with cash on delivery. Open `https://shop.20.197.63.44.sslip.io/wp-admin` (user `admin`; password: `kubectl --context urumi-vps -n urumi get secret store-wp-admin -o jsonpath='{.data.password}' | base64 -d | clip`, copy, do not show) and show WooCommerce > Orders. **Expected:** the order is listed.
3. Dashboard Chat as A: "Create a product called Demo Mug priced 19.99". **Expected:** a confirm card (write tool); click Confirm; the product appears on the storefront (refresh the shop).
4. Order Demo Mug on the shop by hand (COD). Chat: "What orders came in today?". **Expected:** one `woo__list_orders` call with no confirm card; the reply lists the new order. (Known limit: "today" is the UTC day, so an order at 00:00 to 05:30 IST counts as yesterday; ask "orders after" the date if the clock is awkward.)
5. **Invite B and B's own key, on camera.** A: Members page, invite the new B email as member, copy the invite link (no email is sent). Chrome Guest window: open the link, set a password, log in as B, My Keys, Generate key, paste it straight into Inspector's header field (key cropped or blurred). Say: "Admins cannot create keys for members (`services/gateway/src/api/keys.ts:34` creates a key only for the logged-in caller). The plaintext key is in that one response and is shown once to its owner; the database keeps only a SHA-256 hash." **Expected:** the key row on B's page shows its prefix only.
6. User B, external client (Inspector, URL + key only): connect. Say: "B's whole configuration is this URL and this key. The upstream credentials live in Kubernetes Secrets and in the gateway's encrypted table; B never sees them and has no field to type them in." **Expected:** server `urumi-gateway`, tools from all three upstreams, no `woo__create_product` (admin-only). Run `woo__list_orders`. **Expected:** the same order. Then `fx__convert_currency` and `notes__add_note` to show three upstreams from one client. Finally call `woo__get_order` with id 99999. **Expected:** an error (not found); this is the error row the audit walk points at in section 4.3.
7. Two-upstream prompt, in Claude Code (auto mode is on; started from the scratch folder, B's second key). Scroll up on camera to show the three tool calls; fx is a fixed-rate demo upstream: "Take the total of all orders and convert it to EUR." **Expected:** calls `woo__list_orders` then `fx__convert_currency` (rehearsed 2026-10-22: 29.49 USD = 27.13 EUR). Then the three-upstream prompt "Total all orders, convert to EUR, and save the result as a note", and the permission-boundary prompt "Create a product called <name> priced at 12 USD" (B has no `woo__create_product`, so it refuses). If the model misbehaves, repeat the same prompt in the dashboard chat as A, which has the same tools. Show B's rows on the Audit page after (section 4.3 reads them out).

## 2. Kubernetes (about 2.5 min)

**On screen:** terminal T2 with `KUBECONFIG` exported. Use `-o name`/`wide` output, keep it short.

    kubectl --context urumi-vps get ns
    kubectl --context urumi-vps -n urumi get pods,svc -o wide
    kubectl --context urumi-vps -n urumi get pvc
    kubectl --context urumi-vps -n urumi get secret                      # names only, never -o yaml
    kubectl --context urumi-vps -n urumi get ingress
    kubectl --context urumi-vps -n urumi describe deploy gateway | grep -E "Limits|Requests|cpu|memory|Liveness|Readiness|Startup"
    kubectl --context urumi-vps -n urumi get netpol
    kubectl --context urumi-vps -n urumi describe netpol | grep -A6 -E "^Name:.*(woo-mcp|default-deny)"

**Say:** "Namespaces: `urumi` for the app, `cert-manager` for certificates, `kube-system` for k3s and Traefik. Secrets are created by a script, never committed, and k3s encrypts them at rest. MariaDB, WordPress content and Postgres sit on `local-path` PVCs. Only two hostnames are public: the shop, and the app host that serves the dashboard and the gateway's /mcp; woo-mcp, fx, notes, MariaDB and Postgres are ClusterIP behind NetworkPolicies: default-deny for ingress, one allow per path, plus egress policies on the upstreams and Postgres. woo-mcp accepts only the gateway and also requires its own bearer token."

**Expected result:** `urumi` pods Running and Ready with RESTARTS low (point at the `gateway-postgres-backup` pods, Completed: that is the backup CronJob); PVCs Bound; Ingress list shows only shop and app hosts and no woo-mcp; `describe` shows two containers with resources. The small one (50m CPU / 32Mi limits) is the `wait-for-db` init container (Postgres image, loops on `pg_isready` so the first start does not crashloop); the main container is 500m CPU / 256Mi, with startup, liveness and readiness probes. NetworkPolicies: default-deny for ingress, one allow per path, plus egress policies on the upstreams and Postgres.

**Optional deny probe (only if time; ADR 024 already records it):** `kubectl --context urumi-vps -n urumi run probe --rm -it --restart=Never --image=<an image already on the node> -- wget -qO- -T3 http://woo-mcp:<port>/` times out because an unlabelled pod is blocked. Check the pod is gone afterward. Skip if unsure which image is on the node.

## 3. MCP internals (about 5 min)

**On screen:** `docs/DESIGN.md` sections 2 and 4, `services/gateway/src/tool-names.ts`, then the terminal and Servers page.

**Say:** "The gateway keeps one MCP client per enabled upstream and merges their tool lists. Every tool is exposed as `slug__tool`, split at the first `__`, so two servers with the same tool name never collide: `woo__list_products` and `notes__list_products`. A call is checked against the caller's role and rules, routed by slug, and the credential is added by the gateway; the caller's key never goes upstream. The whole path: client -> gateway `/mcp` (key hash checked, role and rules checked) -> the gateway's MCP client for that upstream -> woo-mcp, which calls the WooCommerce REST API v3 with the WordPress Application Password it holds -> the JSON comes back along the same path -> an audit row is written. For fx and notes the middle hop is their own code instead of WooCommerce. Calls time out after 15 s and a health ping every 5 s drops a dead server without touching the rest."

**Live steps:**

1. Collision: Servers page (or Inspector tool list) showing both `list_products` tools. Call both from Inspector as B: different results (store products vs notes-mcp's own).
2. Dead upstream, in two moves (both reversible, one Deployment):

        kubectl --context urumi-vps -n urumi delete pod -l app.kubernetes.io/name=notes-mcp --wait=false && kubectl --context urumi-vps -n urumi get pods -l app.kubernetes.io/name=notes-mcp -w

   **Expected:** the new pod goes Pending -> ContainerCreating -> Running 1/1 in about 12 s; the old pod shows Completed (graceful exit). Ctrl+C after. The Servers page may blink unreachable, then connected.

   Say: "A deleted pod is recreated by the Deployment within seconds, so killing it only shows self-healing. To show a dead upstream that stays dead, I scale the Deployment to 0." Then:

        kubectl --context urumi-vps -n urumi scale deploy/notes-mcp --replicas=0
        # Servers page: notes goes unreachable within about 5 s; woo and fx stay connected
        # Inspector: List Tools again, the notes tools disappear; call woo__list_products and fx__list_rates, both still work

   Say: "The dead server's tools are simply gone from `tools/list`, so there is nothing to call and no error row; the other upstreams are untouched."

   **Restore right after:**

        kubectl --context urumi-vps -n urumi scale deploy/notes-mcp --replicas=1
        kubectl --context urumi-vps -n urumi rollout status deploy/notes-mcp

   **Expected:** notes reconnects by itself (no gateway restart) and its tools return. (Notes live in memory and are lost on restart; that is fine.)
3. Disable an upstream (DoD), checked in BOTH the chat and the external client:
   1. Before: Chat as A, "Convert 10 USD to EUR". **Expected:** one `fx__convert_currency` call and the converted amount. Inspector (B): List Tools shows the `fx__*` tools.
   2. Servers page: Disable fx. **Expected:** fx shows disabled.
   3. After, chat: the same prompt "Convert 10 USD to EUR". **Expected:** no `fx__` tool-call card. With no tool covering it the model may answer from memory, so judge by the absence of a call card and by the Audit page (no new `fx` row), and say so.
   4. After, client: in Inspector press List Tools again (the `list_changed` notification may already have refreshed it). **Expected:** the `fx__*` tools are gone.
   5. Enable fx again before moving on.
4. **Add, edit and remove a server by URL + credential (admin story 3).** Servers page, as A:
   1. Add server: slug `demo-dummy`, URL `http://dummy-mcp:3000/mcp`, auth bearer with the made-up token `not-a-real-token`. This URL passes the registration check in `services/gateway/src/api/servers.ts` (`urlBodyFor`): http or https, no username or password, and not `localhost`, a loopback or a link-local address. A hostname that does not exist is accepted at registration (DNS is only checked at connect), so the server is saved and shows **unreachable**. Say which rule it passed.
   2. Edit it. The slug (the name) cannot be changed: it is the tool prefix and part of the credential encryption, and the PATCH body has no slug field; say that. Change the URL to `http://dummy-mcp-2:3000/mcp`. **Expected:** the form forces a new credential, because the API answers 400 "changing url requires re-entering the credential" otherwise, so a stored credential never follows a URL change to a new host (section 4, question 1). Enter the dummy token again and Save. The page shows only "has credential", never the value.
   3. Delete it (confirm dialog). **Expected:** it disappears from the list; audit rows keep the slug as text, so history survives.
5. Timeout, shown as code and a test (it cannot be shown live because no upstream has a slow tool, see "cannot show yet"):
   1. `services/gateway/src/upstreams.ts` lines 79-82: the defaults (call 15 s, connect 5 s, ping 3 s). Line 168: the timeout is passed to `callTool`. Lines 171-172: the error `server '<slug>' timed out after 15s`.
   2. `services/gateway/test/upstreams.test.ts` line 30: the test uses 300 ms. Lines 95-97: a fake `slow` server, and the test expects `server 'slow' timed out after 0.3s`.

## 4. Security posture (about 3.5 min)

**On screen:** `docs/THREAT_MODEL.md`. Point at the rows, do not improvise.

**Say, per row:**

- "The four required questions" 1: upstream credentials are AES-256-GCM encrypted (`credential_enc`), the API returns only `hasCredential`, and changing a server URL forces re-entering the credential. Show `docs/THREAT_MODEL.md` question 1.
- Question 2: keys are stored as sha256 hashes, shown once; the caller's `Authorization` is never forwarded, so a malicious upstream cannot collect keys.
- Question 3 (malicious server): tool descriptions are sanitised and size-capped in chat, writes need a confirm that the server stored, the URL guard and egress NetworkPolicy block internal targets, listing capped at 20 pages and 500 tools, 15 s timeout, one-click disable. Say the accepted gap out loud: `/mcp` clients see raw upstream text (row in question 3).
- Question 4 (member vs member): cannot see others' keys, sessions or audit rows; can read shared notes (stored prompt injection, accepted).
- Known-risks table: one sentence on "Tool rules default-open" and "Wide 443 egress", the honest accepted ones.

**Live steps (the DoD control steps):**

1. As B in Inspector: call `woo__create_product` (or note it is absent from `tools/list`). **Expected:** `tool not permitted for your role`. Dashboard as A, Servers page: the "Admins only" checkbox on woo's write tools.
2. Revoke B's first key (the one in Inspector): as A on the Members page (admins revoke member keys there; My Keys lists only your own). In Inspector's Tools tab, without reconnecting, call `woo__list_orders` again. Inspector shows "Unexpected token '<', <!doctype ... is not valid JSON". Say: "Inspector tries OAuth discovery on a 401; this gateway uses API keys, so the key is simply rejected." Then show the real response in Inspector's Network tab: `POST /mcp` 401 Unauthorized (expand it for the body). **Expected:** rejected (401, `invalid or missing API key`).
3. Audit, walked by name. A's Audit page (columns: who, server, tool, when, duration, outcome). Point at each row:
   - A (`admin@urumi.local`), source chat: `woo__create_product` (ok, after Confirm), `woo__list_orders` (ok), and the `fx__convert_currency` call from the disable-fx "before" step.
   - B, source mcp, Inspector: `woo__list_orders`, `fx__convert_currency`, `notes__add_note`, `woo__list_products`, `notes__list_products`, and the `error` row for `woo__get_order` id 99999 (not found).
   - B, source mcp, Claude Code: `woo__list_orders` then `fx__convert_currency` (two-upstream prompt); the three-upstream prompt adds `notes__add_note`. The permission-boundary prompt writes no row: the tool is not in B's list, so the model never calls it. A direct `woo__create_product` from Inspector would show as an `error` row ("tool not permitted for your role").
   - Say: "The revoked-key call has no row: the 401 is raised before there is an authenticated user to attribute it to. That is a known gap; rejections and 429s are not audited." And: "The chat after disabling fx made no call, so it has no row either."
   - B's own Audit page (before the revoke, or log in again) shows only B's rows. **Expected:** every authenticated call is attributed to the right user.

## 5. Chat agent (about 1.5 min)

**On screen:** `docs/explain/chat-agent.md` or `services/gateway/src/chat/agent.ts` (the loop, ADR 017; one screen), then the Chat page.

**Say:** "The chat is a loop in the gateway: it sends the user's messages and the tools their role allows to an OpenAI-compatible LLM, runs the tool calls it asks for, and feeds the results back until it answers. Each call goes through the same `Gateway.callTool(user, ...)` as `/mcp`, so the role check, routing, timeout and audit row are identical and attributed to the logged-in user. Read tools run on their own; every other tool needs a Confirm that the server remembers, so the model cannot approve itself."

**Live steps:** as B in the Guest window dashboard, Chat: "List the products in the store". **Expected:** a `woo__list_products` call, no confirm. Then "Create a product called X priced 5": **Expected:** it cannot (the tool is not in B's list), the model says so. Switch to A's Audit page: B's chat call appears under B's email. Point at B's chat row (source chat, B's email) on A's Audit page.

## 6. Local-to-VPS production story (about 2.5 min)

**On screen:** `deploy/values-local.yaml` vs `deploy/values-prod.yaml` (use `diff deploy/values-local.yaml deploy/values-prod.yaml`), then README "What differs from local".

**Say:** "Same charts, only the values file changes: the domain (`localtest.me` to `20.197.63.44.sslip.io`), TLS on with cert-manager and `letsencrypt-prod`, HTTPS redirect, `COOKIE_SECURE`, WordPress environment type, and `local-path` storage. Ingress is Traefik in both. Secrets come from one script, never from values files; on the VPS k3s encrypts them at rest. Images are side-loaded over SSH instead of imported into k3d. The API is reached only through an SSH tunnel."

**Live steps:**

1. Terminal: `diff deploy/values-local.yaml deploy/values-prod.yaml | head -40`.
2. Browser: padlock on https://app.20.197.63.44.sslip.io (Let's Encrypt), and `curl -sI http://app.20.197.63.44.sslip.io | head -1` shows `308`.
3. Helm history: `helm --kube-context urumi-vps history platform -n urumi`. The current revision is 7. Point at the real `Rollback to 3` row (revision 5, the VPS rehearsal on 2026-10-21, ADR 024) as proof that a rollback ran.
4. **Upgrade and rollback, explained, not executed live (no rollback on the prod VPS during the recording).** Show the commands from README "Upgrade and rollback", with N = 7 (the current revision from step 3):

        ENV=prod make deploy HELM_EXTRA="--set gateway.limits.mcp.callsPerMinute=61"        # upgrade, new revision N+1
        helm --kube-context urumi-vps rollback platform N -n urumi --wait                    # back to the revision before the upgrade

   Say: "A rollback goes to the revision just before the upgrade, one step back, and never at or before the Let's Encrypt prod switch or the backup change; an older one would bring the staging issuer back. It does not touch PVC data or the TLS and app Secrets. We did it for real on 2026-10-21 (history row `Rollback to 3`, ADR 024: the gateway pod went back to 60 calls per minute, both certificates stayed Ready, `make dod` passed)."

## Demo points the repo cannot show yet (or only partly)

- **Two-upstream single prompt through an external LLM client.** Done: Claude Code as member B on the VPS, 2026-10-22, `woo__list_orders` then `fx__convert_currency` (REHEARSAL row 7). It is in section 1, step 7. Fallback is the dashboard chat. The three-upstream prompt has not been rehearsed yet.
- **Live timeout.** No upstream has a slow or hanging tool, and I should not break the real ones. The 15 s timeout is shown as code and a unit test. A fake `slow` tool in notes-mcp would fix this but is a code change, not part of this task.
- **Claude Desktop connect snippet** in the README was never run. Claude Code and the Inspector are proven (REHEARSAL row 7); Claude Desktop stays untested.
- **README steps 4 to 6 as a browser click-through** (order, Keys page, chat) were only checked on the local rehearsal and the VPS manual checks, not re-clicked after the last code changes.
- **Disable-fx effect on chat is hard to show cleanly.** With no covering tool the model may answer from memory (REHEARSAL row 11 and follow-ups); the proof is the audit page and the tool list, not the reply text.
- **NetworkPolicy deny probe** needs a throwaway pod on the VPS; the proof exists in ADR 024. Live, only the policies themselves can be shown unless I run the optional probe.
- **Rate limits (429) and 401/429 rejections are not audited** (REHEARSAL follow-ups), so they cannot be shown in the Audit page; show the 401 on the revoked key in Inspector's Network tab instead.
- **No member password reset and no email**: invites are copied links. Mention it only if asked.
- **Backups, key rotation and `make dod` on the VPS** exist but are left out of the 15 minutes. `ENV=prod make dod` would also scale notes to 0 and disable fx by itself, so do not run it during the recording.
