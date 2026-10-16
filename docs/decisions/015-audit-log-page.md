# 015: Audit log page

Status: accepted. One small gateway change (`source` filter), the rest is dashboard.

## Decisions
- **Keyset pagination, not offset.** `GET /api/audit?before=<last id>&limit=<1..200, default 50>`, newest first. A page costs one indexed walk on the primary key; there is no `COUNT(*)` and no skipped or repeated rows when new calls arrive while someone pages. The page fetches 50 rows at a time and "Load older" appends the next page; it hides itself when a page comes back short. The browser never holds the whole table, and the API refuses `limit` above 200.
- **Filters:** server, outcome, source and (admin only) user, all server-side. `source` is a zod enum (`mcp` | `chat`); anything else is 400 and the value is a bound SQL parameter either way. Tool and date-range filters are possible later additions, not built: newest-first already answers "what happened recently".
- **Member scope is enforced by the API, in SQL.** For a member the `user_id` condition is their own id whatever `?user=` says; the dashboard just hides the User filter. Checked live with a member cookie: `?user=<admin id>` returns only the member's own rows.
- **Plain text only.** Server slug, tool name and error text come from upstreams and callers, so they are untrusted. Every value is a React text child: no `dangerouslySetInnerHTML`, no markdown. A test renders `<img src=x onerror=...>` and checks no element is created. Tool arguments and results are not stored in the audit table at all, so they cannot reach this page.
- **`source` is a column now** (`mcp` or `chat`), so phase 6 adds chat rows without a UI change.
- **Stale responses are dropped.** Each fetch takes a counter value and only the newest may write state. Without it a slow answer for old filters, or an old "Load older", could land last and overwrite the list. Two tests cover both cases.
- **No new index.** The ORDER BY walks the primary key, and filters only narrow the rows read. Fine at this scale; revisit if a filter on a large table gets slow.

## History survives a server delete
`audit_log.server_slug` is plain text with no foreign key, so deleting a server keeps its rows (verified live: call a tool on a throwaway server, delete it, rows still show for the admin and for the member who made the calls). A deleted user shows as "(deleted)" because `user_id` is set to NULL.

**Slug reuse:** if a deleted slug is registered again, old rows look like they belong to the new server. This ambiguity is accepted.
