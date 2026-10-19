# 022: Tool permissions per role

**Status:** accepted
**Date:** 2026-10-19

## Context
Any member could list and call every tool, including woo's `create_product` and `update_order_status`. We want members to read orders but not change them, and an admin to decide that per tool, without a role editor (there are two roles: `admin` and `member`).

## Decision
- **Table `tool_rules(server_id, tool, admin_only)`**, primary key `(server_id, tool)`, `ON DELETE CASCADE` from `upstream_servers`. `tool` is the upstream's own name (no `<slug>__` prefix). No row means everyone may use the tool.
- **Enforced in one place: `Gateway`.** `restrictedFor(user)` reads the user's role from `users` on every request (an admin gets an empty set, a disabled or missing user counts as a member), then the admin-only names as `slug__tool`. `listTools(user)` filters with it. `callTool` checks it before routing. `/mcp` (`tools/list`, `tools/call`) and the chat agent both go through these two methods, so there is no second copy of the rule. The role is never cached on the MCP session or taken from the `AuthUser` the caller holds, so a role change applies to open sessions on their next request.
- **Direct call to a restricted tool** throws `McpError(InvalidParams, "tool not permitted for your role")`. `/mcp` sends it as a JSON-RPC error (the SDK prefixes the message with `MCP error -32602:`). The `finally` block still writes the audit row, with outcome `error` and the plain message, and nothing is sent upstream. Everything else that goes wrong stays an `isError` result as before.
- **Chat.** The model is only offered the tools its user may use. If it names a restricted one anyway, the same `callTool` refuses it; the agent turns that into a tool message, so it is never held for a confirm and never runs. The chat confirm step (`CHAT_READ_ONLY_TOOLS`) stays: it asks the user whether to run a write they are allowed to run. Permission decides who may, the confirm decides when.
- **Changing a rule:** `PATCH /api/servers/:slug/tools/:tool` with `{adminOnly: boolean}` (admin only, JSON body, so the existing CSRF guard applies). It upserts the row and calls the existing `notifyToolsChanged`, so open `/mcp` sessions get `notifications/tools/list_changed`. An admin can pre-mark a tool the server does not list right now; the answer says `listed: false`. Setting `false` keeps a row, which is how register tells "an admin chose open" from "never set".
- **Views.** `serverView` gives admins each tool with `adminOnly` plus all stored rules (`toolRules`); members get the list without restricted tools and no sign that rules exist. The Servers page shows an "Admins only" checkbox per tool when `adminOnly` is present.
- **Defaults.** woo's write tools (`create_product`, `update_order_status`; the reads are `list_products`, `list_orders`, `get_order`) are admin-only in three places: migration 006 (existing cluster), `bootstrap` (fresh database, where woo does not exist yet when migrations run), and `scripts/register-upstreams.sh` (a woo that was deleted and re-added lost its rules through the cascade). Register only inserts where no rule exists, so an admin's choice, even "open", is never overwritten.

## Rules are default-open
A tool with no rule is usable by members. So a new server's tools, or a tool renamed upstream, are available to members until an admin marks them. We accept that: only admins add servers or see the Servers page where the toggle sits, and the seeded woo rules cover the one place with writes today. The hardening step is default-closed (a new tool is admin-only until opened); it needs a "new tool, unreviewed" state in the UI, so it is left out of round 1.

## Consequences
- Every `tools/list` and `tools/call` costs one or two small queries (role, then rules for members). Fine at this scale; one replica.
- A member can still see a restricted tool's name by guessing it, but gets the same error either way, and the attempt is audited.
- `make dod` uses read tools only, so it is unaffected.
- Interview line: members can read orders but not change them.
