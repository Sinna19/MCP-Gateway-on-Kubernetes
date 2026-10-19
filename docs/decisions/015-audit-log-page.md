# 015: Audit log page

Status: accepted. One small gateway change (`source` filter), the rest is dashboard. Args and declined rows added in 7d (below).

## Decisions
- **Keyset pagination, not offset.** `GET /api/audit?before=<last id>&limit=<1..200, default 50>`, newest first. A page costs one indexed walk on the primary key; there is no `COUNT(*)` and no skipped or repeated rows when new calls arrive while someone pages. The page fetches 50 rows at a time and "Load older" appends the next page; it hides itself when a page comes back short. The browser never holds the whole table, and the API refuses `limit` above 200.
- **Filters:** server, outcome, source and (admin only) user, all server-side. `source` is a zod enum (`mcp` | `chat`); anything else is 400 and the value is a bound SQL parameter either way. Tool and date-range filters are possible later additions, not built: newest-first already answers "what happened recently".
- **Member scope is enforced by the API, in SQL.** For a member the `user_id` condition is their own id whatever `?user=` says; the dashboard just hides the User filter. Checked live with a member cookie: `?user=<admin id>` returns only the member's own rows.
- **Plain text only.** Server slug, tool name and error text come from upstreams and callers, so they are untrusted. Every value is a React text child: no `dangerouslySetInnerHTML`, no markdown. A test renders `<img src=x onerror=...>` and checks no element is created. Results are not stored in the audit table. Arguments are (see "Args" below); they are shown as plain text too.
- **`source` is a column now** (`mcp` or `chat`), so phase 6 adds chat rows without a UI change.
- **Stale responses are dropped.** Each fetch takes a counter value and only the newest may write state. Without it a slow answer for old filters, or an old "Load older", could land last and overwrite the list. Two tests cover both cases.
- **No new index.** The ORDER BY walks the primary key, and filters only narrow the rows read. Fine at this scale; revisit if a filter on a large table gets slow.

## Args and declined confirms (added in phase 7d)
Until now the log said *that* a write happened, not *what* it did, and a declined chat confirm left no trace.
- **`args jsonb`, nullable** (migration 005). Old rows stay null. Stored as sent to the upstream, after `src/audit-args.ts` redacts them: any key matching `/pass|secret|token|key|auth|cookie/i`, at any depth and inside arrays, gets the value `"[redacted]"`. The match is on the key only, so it also hits `author`, `keyword` and `order_key`. Kept on purpose: over-redacting is the safe direction, and a missing value in the audit view costs less than a leaked one. A secret placed in a value under an innocent key (`{"note": "my pw is ..."}`) is not caught; that is the limit of key-based redaction.
- **2 KB cap on the serialized size** (bytes, after redaction). Over it we store `{"_truncated": true, "bytes": N}` instead of cutting JSON mid-string, so the column is always valid JSON and a row cannot grow without bound.
- **One writer.** `Gateway.audit` is the only code that inserts rows. `/mcp` and chat both reach it through `callTool`, and a declined chat confirm through `recordDeclined`, so the redaction and the cap exist in one place (`audit-args.ts`, unit-tested).
- **Declined confirms are rows**: outcome `declined`, source `chat`, duration 0, with the args the server held for the pending confirm (never the ones the client sent back). Nothing is sent upstream. The `outcome` check constraint and the API/dashboard filter accept `declined`.
- **Args can hold customer data.** Calls to woo-mcp carry names, emails, addresses and order notes (`create_product`, `update_order_status`, order lookups), and redaction does not remove them. Who can read them: admins see every row and its args; a member sees only their own rows, including the args they sent themselves (the same `user_id` rule as before, enforced in SQL). Nobody else can read the table, and it has no export route.
- **Dashboard:** an Args column with a `<details>` that is closed by default and a `<pre>` holding `JSON.stringify` as a text child, so no HTML or markdown is rendered. Rows without args show nothing there.

## History survives a server delete
`audit_log.server_slug` is plain text with no foreign key, so deleting a server keeps its rows (verified live: call a tool on a throwaway server, delete it, rows still show for the admin and for the member who made the calls). A deleted user shows as "(deleted)" because `user_id` is set to NULL.

**Slug reuse:** if a deleted slug is registered again, old rows look like they belong to the new server. This ambiguity is accepted.
