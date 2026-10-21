# Handoff
## Done this session (Phase 9, D: README run-through)
- Ran `make cluster-down`, then README "Run locally (k3d)" top to bottom on a fresh k3d cluster: `make cluster-up`, `make deploy`, `make register`, admin-password command, `make dod`.
- **Fixes to README or scripts: none needed.** Every command worked as written, so nothing was committed.
- `make dod`: `8 passed, 0 failed`.
- Member key check: logged in as the dod-member user, created a key via `POST /api/keys`, `initialize` then `tools/call woo__list_orders` on `http://app.localtest.me/mcp` returned `{"items":[],"total":0,"total_pages":0}`, then revoked the key (204).
- `app.localtest.me` and `shop.localtest.me` both return 200.

## Not covered by this run
- README steps 4, 5 (Keys page UI), 6 are browser-only: placing an order, creating a key in the dashboard, and chat were not clicked through. I made the key through the API instead.
- The optional LLM Secret command (step 2) was not run; chat was not tested.
- Claude Code / Claude Desktop client snippets were not run.

## Next step
`9 D Demo` (demo script against the live VPS, pre-flight checklist, record). Check the first CI run for `7cebe21` in the GitHub Actions tab first (`gh` is not installed).

## Gotchas learned
- A fresh `make cluster-up` + `make deploy` + `make register` takes a few minutes and needs no manual step in between.
- `POST /api/keys` returns `{id, key, name}`; `/mcp` needs `Accept: application/json, text/event-stream` and an `mcp-session-id` from `initialize`.

## Files the next task needs
- docs/PLAN.md (Phase 9 section D), docs/REQUIREMENTS.md (six video sections), docs/REHEARSAL.md if present, README.md

## Recent commits
89ffdc7 chore: handoff
7cebe21 ci: lint and tests on push and PR
e3a18f6 chore: handoff
4c6ef9f docs: readme local setup and stand-out list
