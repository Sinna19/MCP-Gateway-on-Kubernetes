# 007: Tool names are `<slug>__<tool>`

**Status:** accepted
**Date:** 2026-10-15

## Context
Several upstreams can expose a tool with the same name (`notes-mcp` will deliberately repeat one from woo-mcp). The gateway must show one flat tool list and route each call back to the right server.

## Decision
- Exposed name = `<server_slug>__<tool_name>`; the router splits on the first `__`.
- A slug matches `^[a-z0-9]+(-[a-z0-9]+)*$`, max 20 characters. It cannot contain `_`, so it can never contain `__`, and the first `__` always ends the slug. The database enforces this with a CHECK constraint, and `isValidSlug` enforces it in code.
- Tool names can contain `__` themselves; only the first one is the separator.
- Clients require names to match `^[a-zA-Z0-9_-]{1,64}$`. An upstream tool whose prefixed name fails that is skipped and logged, not exposed.

## Alternatives considered
- Prefix only on collision: names change when another server is added, which breaks saved prompts.
- Other separators (`.`, `/`, `:`): not allowed by the client name pattern.
- Slug with underscores (first draft): `a__b` as a slug would break the split.

## Consequences
- 20 characters for the slug plus `__` leaves 42 for the tool name; longer upstream names are skipped.
- Names are stable: adding a server never renames existing tools.
- Renaming a slug changes the tool names; the dashboard (Phase 5) should warn about that.
