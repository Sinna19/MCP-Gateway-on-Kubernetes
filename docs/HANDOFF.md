# Handoff
## Done this session (Phase 9, B1: threat model)
- `291b4cf` docs: `docs/THREAT_MODEL.md`: the four required questions (shared credentials, no token passthrough, untrusted upstreams, member vs member) and a 19-row Known risks table (8 PLAN lines incl. mu-plugin X-Forwarded-For, plus the known weak spots). PLAN box ticked. `make lint` ok.
- Every mitigation was grepped in code first. Two honest "not mitigated" entries came out of it: `/mcp` passes upstream tool descriptions and results to external clients unchanged (only chat sanitises), and the gateway does not cap raw tool-result size on `/mcp`.

## In progress
- Nothing half-finished. Working tree clean after this commit.

## Next step
`9 B Future-work section` (next unchecked B box: admin one-time password reset link, disabled-login hint, agent system-prompt line, audit rejected 429/401 /mcp requests; skipped bonuses with one-line reasons). Likely appended to THREAT_MODEL.md or DESIGN.md; check PLAN wording.

## Gotchas learned
- ADR 018 says audit records no args, but that is outdated: `src/audit-args.ts` now stores redacted args (<= 2 KB) and `declined` rows exist (ADR 015). The threat model follows the code.
- Some ADR files (024) contain non-UTF-8 bytes; Read shows U+FFFD and Edit/Write will refuse them. Grep or use shell for those.
- Bash `cd` into a subfolder persists; use absolute paths or `cd` back.

## Files the next task needs
- docs/PLAN.md (Phase 9 B boxes), docs/THREAT_MODEL.md, docs/REQUIREMENTS.md (bonus list only)
