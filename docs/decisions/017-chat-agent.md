# 017: Chat agent backend

**Status:** accepted
**Date:** 2026-10-17

## Context
Members and admins need a chat in the dashboard that calls tools as themselves. The call must go through the same route, timeout and audit path as `/mcp`, and the LLM key must not be in source.

## Decision
- **Where**: `services/gateway/src/chat/`. `ChatAgent.run` loops: LLM call, run the tool calls through `Gateway.callTool(user, name, args, "chat")`, repeat until the model answers without tool calls. Audit rows get `source=chat` from that one path.
- **Provider**: any OpenAI-compatible `/chat/completions`, called with plain `fetch` (`chat/llm.ts`, no SDK). `LLM_BASE_URL` and `LLM_MODEL` come from values, with no default model in code. `LLM_API_KEY` comes from Secret `llm-api` (made by `scripts/secrets.sh`, referenced `optional`). If any of the three is missing, the chart still deploys and `/api/chat` answers 503 "chat not configured". `parallel_tool_calls: false` is sent. The error text of a failed LLM call carries the status only.
- **History**: the client sends the conversation each turn. The server keeps the last 20 messages, rebuilds each one field by field, accepts only `user`, `assistant` and `tool` roles (it adds its own system prompt), and never runs `tool_calls` found in history. Only `tool_calls` the LLM returns in this request run. Nothing is stored except audit rows.
- **No streaming**: one JSON answer `{ reply, messages, toolCalls, pendingToolCall? }`. `messages` is this turn's new messages for the client to append; it is empty while a confirm is pending, so the client never holds a half-answered tool call. `toolCalls` lists the calls made during that request.
- **Limits**: 8 LLM steps per turn, 20 s per LLM call, 55 s per request. At the limit the user gets a plain reply, not a 500. One in-flight request per user (in memory): a second one gets 429 "chat busy", so a stuck tab cannot keep spending credits. Real rate limiting stays in phase 7.
- **Timeout hop check** (2026-10-17): `/api` goes browser, Traefik, gateway; nginx in the dashboard pod serves only `/`. The gateway's `requestTimeout` (15 s) limits reading the request body, not the answer. `kubectl -n kube-system get deploy traefik -o yaml | grep -i timeout` shows no response timeout set (only probe timeouts), so Traefik's built-in defaults apply, and I have not verified what they are. The 55 s budget is a deliberately conservative guess that stays under common 60 s proxy limits. To be re-checked with a real slow turn in 6b.

## Alternatives considered
- Provider SDK: ties us to one vendor and adds a dependency to explain; the OpenAI wire format is about 40 lines of fetch.
- History in Postgres: survives a refresh but needs a table, retention and access rules. Not needed for the requirements.
- SSE streaming: more moving parts (proxy buffering, aborts, tests). The per-call list already shows the tool calls.

## Consequences
- The server is stateless apart from pending confirms (ADR 018) and the in-flight set, both in memory. That fits the 1-replica gateway; scaling out would need them shared.
- The client sends the history, so a user can fake the earlier turns of their own conversation. That gives them nothing new: every call runs as that user, and a write still needs a server-issued pending id.
- A history cut at 20 messages could split a tool exchange; leading non-user messages are dropped so the provider never sees an orphan tool message.
- Interview line: "chat is just another caller of `callTool`, so routing, timeouts, roles and audit are the same as for an external client."
