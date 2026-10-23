# Demo script (recorded against the live VPS)

Target about 15 minutes total. `docs/ASSIGNMENT.md` sets no video length limit (checked), so this is my own budget.

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

   Expect every pod 1/1 Running. `setup-*` Job pods are TTL-deleted after 600s, so they may not be listed; that is expected. Also `helm --kube-context urumi-vps history platform -n urumi` and check the current revision is 7 (a one-step rollback would target 6) and use that in section 6.
4. **Admin password** (copy, do not print on screen; paste into the login form during the recording):

        kubectl --context urumi-vps -n urumi get secret gateway-app -o jsonpath='{.data.admin-password}' | base64 -d | clip

5. **Clean Chrome profile.** Use a new profile or guest window with autofill and password saving off. Stale saved passwords caused login lockouts before (5 bad logins locks an email for 15 min; clear it with `kubectl --context urumi-vps -n urumi rollout restart deploy/gateway`, which also drops MCP sessions, so do it before recording). Second window (Incognito) for user B.
6. **Seed data.** Storefront has products (WooCommerce sample data from setup). Decide the product name for A to create (default: "Demo Mug", 19.99) and check it does not exist yet (there is no storefront search; the Shop page lists all products). Use a fresh product name per rehearsal so the recording name stays unused. Servers page shows woo, fx, notes all Connected with 5, 2, 3 tools. If not, `ENV=prod make register`.
7. **Chat is on.** Secret `llm-api` exists (`kubectl --context urumi-vps -n urumi get secret llm-api -o name`). Otherwise `/api/chat` answers 503.
8. **User B ready.** As A: Members page, invite `b-demo@example.com` as member, copy the invite link (no email is sent), open it in the Incognito window, set a password, log in. If B already exists from an earlier session, reuse it.
9. **Fresh API key for B**, created by B on the Keys page (shown once, starts with `umk_`). Revoke any older B keys so Section 4's revoke is unambiguous. Keep it in the clipboard or a file outside the repo (`~/.urumi-demo/b.hdr`, containing `Authorization: Bearer umk_...`).
10. **MCP client config ready** (the key stays out of frame):
    - MCP Inspector (proven in the rehearsal): transport Streamable HTTP, URL `https://app.20.197.63.44.sslip.io/mcp`, header `Authorization: Bearer <B's key>`. Have it open and connected, then disconnect so the connect is shown live.
    - Claude Code, for the two-upstream prompt (untested, rehearse once). Off camera, from a scratch folder OUTSIDE the repo (`mkdir -p ~/urumi-demo-scratch && cd ~/urumi-demo-scratch`), default local scope, never `--scope project` (it would write the key into a `.mcp.json`): `claude mcp add --transport http urumi-demo https://app.20.197.63.44.sslip.io/mcp --header "Authorization: Bearer umk_..."`. Run `claude mcp remove urumi-demo` right after section 1.
11. **Terminal and screen.** Terminal font 18 to 20 pt, window about 100 columns, dark background, browser zoom 125%. Close other tabs, Slack and notifications. Terminals: (T1) tunnel, (T2) kubectl with `KUBECONFIG` exported, (T3) spare, (T4) Inspector server (start before recording, keep minimized: it prints its auth token), (T5) Claude Code in the scratch folder.
    - Before recording: enter B's key in Inspector off camera, disable claude.ai connectors in `/mcp`, turn off recaps in `/config`, apply pending Claude Code updates.
    - Limits: per-user daily chat cap (ADR 020, UTC day, resets 05:30 IST) plus Groq rate limits.
    - Each take: new B email (members can only be disabled, not deleted), a fresh B key, a new product name. Revoke B's key on camera every take.
12. **Pre-type** the long commands in a scratch file (not in the repo) so the recording is not spent typing.
13. **Rehearse sections 1 and 3 once** with the clock running; they carry the live risk.
14. After recording: confirm `kubectl --context urumi-vps -n urumi get deploy` shows notes-mcp 1/1 and fx enabled on the Servers page.

## Definition-of-done flow, mapped to sections

The DoD runs once, live, in this order, with no reset between steps. It is spread over the sections so each topic is shown when it is explained.

| Order | DoD step | Section |
|---|---|---|
| 1 | COD order in the shop, visible in WC admin | 1 |
| 2 | A chat creates a product, product on the storefront | 1 |
| 3 | A orders it by hand, chat "orders today" returns it | 1 |
| 4 | B connects an external client, sees all tools, orders question, two-upstream prompt | 1 |
| 5 | Dead upstream (notes-mcp scaled to 0), others keep working | 3 |
| 6 | Disable fx, tools vanish for chat and client, re-enable | 3 |
| 7 | B cannot call an admin-only tool, then revoke B's key, next call rejected | 4 |
| 8 | Audit shows every call under the right user (A all, B own) | 4 |

## 1. System design and the DoD flow (about 4.5 min)

**On screen:** `docs/DESIGN.md` section 1 (architecture diagram), then the browser.

**Say:** "A WooCommerce store, our own woo-mcp server and two small upstreams (fx, notes) run in one namespace. The gateway is an MCP client to each upstream and one MCP server at `/mcp`; the dashboard and the chat agent sit on the same gateway code path. Everything is in the cluster, and only the shop and the gateway are public." (30 s on the diagram, then go live.)

**Live steps:**

1. Dashboard login as A: https://app.20.197.63.44.sslip.io (paste password). Servers page: woo, fx, notes Connected with tool counts. Point out `notes__list_products` next to `woo__list_products` (the collision, explained in section 3).
2. Store: https://shop.20.197.63.44.sslip.io, add a product, check out with cash on delivery. Open `https://shop.20.197.63.44.sslip.io/wp-admin` (user `admin`; password: `kubectl --context urumi-vps -n urumi get secret store-wp-admin -o jsonpath='{.data.password}' | base64 -d | clip`, copy, do not show) and show WooCommerce > Orders. **Expected:** the order is listed.
3. Dashboard Chat as A: "Create a product called Demo Mug priced 19.99". **Expected:** a confirm card (write tool); click Confirm; the product appears on the storefront (refresh the shop).
4. Order Demo Mug on the shop by hand (COD). Chat: "What orders came in today?". **Expected:** one `woo__list_orders` call with no confirm card; the reply lists the new order. (Known limit: "today" is the UTC day, so an order at 00:00 to 05:30 IST counts as yesterday; ask "orders after" the date if the clock is awkward.)
5. User B, external client (Inspector, URL + key only): connect. **Expected:** server `urumi-gateway`, tools from all three upstreams, no `woo__create_product` (admin-only). Run `woo__list_orders`. **Expected:** the same order. Then `fx__convert_currency` and `notes__add_note` to show three upstreams from one client.
6. Two-upstream prompt, in Claude Code (started from the scratch folder) connected as B: "Take the total of all orders and convert it to EUR." **Expected:** calls `woo__list_orders` then `fx__convert_currency`. Then, still as B, the three-upstream prompt: "Total all orders, convert to EUR, and save the result as a note." And the permission-boundary prompt: "Create a product called <name> priced at 12 USD" (B has no `woo__create_product`, so it refuses). Show B's rows on the Audit page after. If the model misbehaves, repeat the same prompt in the dashboard chat as A, which has the same tools (see "cannot show yet").

## 2. Kubernetes (about 2.5 min)

**On screen:** terminal T2 with `KUBECONFIG` exported. Use `-o name`/`wide` output, keep it short.

    kubectl --context urumi-vps get ns
    kubectl --context urumi-vps -n urumi get pods,svc,pvc -o wide
    kubectl --context urumi-vps -n urumi get secret                      # names only, never -o yaml
    kubectl --context urumi-vps -n urumi get ingress
    kubectl --context urumi-vps -n urumi describe deploy gateway | grep -E "Limits|Requests|cpu|memory|Liveness|Readiness|Startup"
    kubectl --context urumi-vps -n urumi get netpol
    kubectl --context urumi-vps -n urumi describe netpol | grep -A6 -E "^Name:.*(woo-mcp|default-deny)"

**Say:** "Namespaces: `urumi` for the app, `cert-manager` for certificates, `kube-system` for k3s and Traefik. Secrets are created by a script, never committed, and k3s encrypts them at rest. MariaDB, WordPress content and Postgres sit on `local-path` PVCs. Only three Ingresses are public (shop, dashboard and gateway on one host); woo-mcp, fx, notes, MariaDB and Postgres are ClusterIP behind a default-deny NetworkPolicy, and woo-mcp accepts only the gateway and also requires its own bearer token."

**Expected result:** `urumi` pods Running and Ready with RESTARTS low; PVCs Bound; Ingress list shows only shop and app hosts and no woo-mcp; gateway has requests/limits (limit cpu 500m, memory 256Mi) and startup, liveness and readiness probes; NetworkPolicies listed including default-deny and the per-service ones.

**Optional deny probe (only if time; ADR 024 already records it):** `kubectl --context urumi-vps -n urumi run probe --rm -it --restart=Never --image=<an image already on the node> -- wget -qO- -T3 http://woo-mcp:<port>/` times out because an unlabelled pod is blocked. Check the pod is gone afterward. Skip if unsure which image is on the node.

## 3. MCP internals (about 3 min)

**On screen:** `docs/DESIGN.md` sections 2 and 4, `services/gateway/src/tool-names.ts`, then the terminal and Servers page.

**Say:** "The gateway keeps one MCP client per enabled upstream and merges their tool lists. Every tool is exposed as `slug__tool`, split at the first `__`, so two servers with the same tool name never collide: `woo__list_products` and `notes__list_products`. A call is checked against the caller's role and rules, routed by slug, and the credential is added by the gateway; the caller's key never goes upstream. Calls time out after 15 s and a health ping every 5 s drops a dead server without touching the rest."

**Live steps:**

1. Collision: Servers page (or Inspector tool list) showing both `list_products` tools. Call both from Inspector as B: different results (store products vs notes-mcp's own).
2. Dead upstream, safest live method (reversible, one Deployment):

        kubectl --context urumi-vps -n urumi scale deploy/notes-mcp --replicas=0
        # Servers page: notes goes Unreachable within about 5 s; woo and fx stay Connected
        # Inspector: tools/list no longer has notes__*; call woo__list_products and fx__list_rates, both still work
        # A call to notes__list_notes is refused fast with an error naming the server

   **Restore right after:**

        kubectl --context urumi-vps -n urumi scale deploy/notes-mcp --replicas=1
        kubectl --context urumi-vps -n urumi rollout status deploy/notes-mcp

   **Expected:** notes reconnects by itself (no gateway restart) and its tools return.
3. Disable an upstream (DoD): Servers page, disable fx. **Expected:** Inspector (B) receives `list_changed` and fx tools vanish; in Chat as A, ask what currency tools it has or "convert 10 USD to EUR": no `fx__` call is made. Caveat from the rehearsal: with no tool for a request the model may answer from memory, so judge by the Audit page (no `fx` row) and say so. Then enable fx again before moving on.
4. Timeout: show the 15 s timeout in `services/gateway/src/upstreams.ts` and the unit test (`make test` runs it locally); it cannot be shown live because no upstream has a slow tool (see "cannot show yet").

## 4. Security posture (about 2.5 min)

**On screen:** `docs/THREAT_MODEL.md`. Point at the rows, do not improvise.

**Say, per row:**

- "The four required questions" 1: upstream credentials are AES-256-GCM encrypted (`credential_enc`), the API returns only `hasCredential`, and changing a server URL forces re-entering the credential. Show `docs/THREAT_MODEL.md` question 1.
- Question 2: keys are stored as sha256 hashes, shown once; the caller's `Authorization` is never forwarded, so a malicious upstream cannot collect keys.
- Question 3 (malicious server): tool descriptions are sanitised and size-capped in chat, writes need a confirm that the server stored, the URL guard and egress NetworkPolicy block internal targets, listing capped at 20 pages and 500 tools, 15 s timeout, one-click disable. Say the accepted gap out loud: `/mcp` clients see raw upstream text (row in question 3).
- Question 4 (member vs member): cannot see others' keys, sessions or audit rows; can read shared notes (stored prompt injection, accepted).
- Known-risks table: one sentence on "Tool rules default-open" and "Wide 443 egress", the honest accepted ones.

**Live steps (the DoD control steps):**

1. As B in Inspector: call `woo__create_product` (or note it is absent from `tools/list`). **Expected:** `tool not permitted for your role`. Dashboard as A, Servers page: the "Admins only" checkbox on woo's write tools.
2. Revoke B's key: Incognito window (B) Keys page, or A's Keys page, revoke it. In Inspector call `woo__list_orders` again. **Expected:** rejected (401, `invalid or missing API key`); the open stream closes.
3. Audit: A's Audit page shows rows for `admin@urumi.local` and `b-demo@example.com` (chat, MCP calls, the denied `create_product`, the dead-upstream error). B's Audit page (before the revoke, or log in again) shows only B's rows. **Expected:** attribution is right.

## 5. Chat agent (about 1.5 min)

**On screen:** `docs/explain/chat-agent.md` or `services/gateway/src/chat/agent.ts` (the loop, ADR 017; one screen), then the Chat page.

**Say:** "The chat is a loop in the gateway: it sends the user's messages and the tools their role allows to an OpenAI-compatible LLM, runs the tool calls it asks for, and feeds the results back until it answers. Each call goes through the same `Gateway.callTool(user, ...)` as `/mcp`, so the role check, routing, timeout and audit row are identical and attributed to the logged-in user. Read tools run on their own; every other tool needs a Confirm that the server remembers, so the model cannot approve itself."

**Live steps:** as B in the Incognito dashboard, Chat: "List the products in the store". **Expected:** a `woo__list_products` call, no confirm. Then "Create a product called X priced 5": **Expected:** it cannot (the tool is not in B's list), the model says so. Switch to A's Audit page: B's chat call appears under B's email.

## 6. Local-to-VPS production story (about 2.5 min)

**On screen:** `deploy/values-local.yaml` vs `deploy/values-prod.yaml` (use `diff deploy/values-local.yaml deploy/values-prod.yaml`), then README "What differs from local".

**Say:** "Same charts, only the values file changes: the domain (`localtest.me` to `20.197.63.44.sslip.io`), TLS on with cert-manager and `letsencrypt-prod`, HTTPS redirect, `COOKIE_SECURE`, WordPress environment type, and `local-path` storage. Ingress is Traefik in both. Secrets come from one script, never from values files; on the VPS k3s encrypts them at rest. Images are side-loaded over SSH instead of imported into k3d. The API is reached only through an SSH tunnel."

**Live steps:**

1. Terminal: `diff deploy/values-local.yaml deploy/values-prod.yaml | head -40`.
2. Browser: padlock on https://app.20.197.63.44.sslip.io (Let's Encrypt), and `curl -sI http://app.20.197.63.44.sslip.io | head -1` shows `308`.
3. Helm history: `helm --kube-context urumi-vps history platform -n urumi`.
4. **Upgrade and rollback, explained, not executed live** (rehearsed on 2026-10-21, ADR 024). Show the commands from README "Upgrade and rollback":

        ENV=prod make deploy HELM_EXTRA="--set gateway.limits.mcp.callsPerMinute=61"        # upgrade, new revision
        helm --kube-context urumi-vps rollback platform 6 -n urumi --wait                    # from current 7: exactly one revision back

   Say: "Rollback goes to the revision just before the upgrade, only one step back, and never at or before the Let's Encrypt prod switch or the backup change; an older one would bring the staging issuer back. Rollback does not touch PVC data or the TLS and app Secrets." Current revision is 7, so a one-step rollback targets 6 (explained, not executed; the 2026-10-21 rehearsal went 4 to 3 in ADR 024).

## Demo points the repo cannot show yet (or only partly)

- **Two-upstream single prompt through an external LLM client.** The rehearsal ran the Inspector (no LLM): one client reached three upstreams, but "one prompt needing two upstreams" was never run through Claude Code or the chat. It is in section 1, step 6; rehearse it once. Fallback is the dashboard chat.
- **Live timeout.** No upstream has a slow or hanging tool, and I should not break the real ones. The 15 s timeout is shown as code and a unit test. A fake `slow` tool in notes-mcp would fix this but is a code change, not part of this task.
- **Claude Code and Claude Desktop connect snippets** in the README were never run (HANDOFF). Claude Desktop stays untested; only the Inspector is proven.
- **README steps 4 to 6 as a browser click-through** (order, Keys page, chat) were only checked on the local rehearsal and the VPS manual checks, not re-clicked after the last code changes.
- **Disable-fx effect on chat is hard to show cleanly.** With no covering tool the model may answer from memory (REHEARSAL row 11 and follow-ups); the proof is the audit page and the tool list, not the reply text.
- **NetworkPolicy deny probe** needs a throwaway pod on the VPS; the proof exists in ADR 024. Live, only the policies themselves can be shown unless I run the optional probe.
- **Rate limits (429) and 401/429 rejections are not audited** (REHEARSAL follow-ups), so they cannot be shown in the Audit page; show the 401 on the revoked key in Inspector instead.
- **No member password reset and no email**: invites are copied links. Mention it only if asked.
- **Backups, key rotation and `make dod` on the VPS** exist but are left out of the 15 minutes. `ENV=prod make dod` would also scale notes to 0 and disable fx by itself, so do not run it during the recording.
