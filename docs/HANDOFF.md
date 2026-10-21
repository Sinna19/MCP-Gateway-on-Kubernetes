# Handoff
## Done this session (Phase 9, B: result size cap + threat model follow-ups)
- `2facf8a` fix(gateway): tool results over `MAX_TOOL_RESULT_BYTES` (1 MB default) become an error result + audit row, SSE and JSON upstreams. Tests first (`mcp-endpoint`, `config`); `FakeUpstream` got a `jsonResponse` option. Chat now errors on >1 MB results instead of cutting to 8000 chars.
- `7152f86` docs: threat model follow-ups: cap row mitigated with the memory exposure (256Mi limit), `/mcp` passthrough accepted, Q2/Q3 wording matches the code (no IP pinning, port not restricted), two new rows (LLM provider PII, Postgres dumps), ADR 018 audit note, image row pointer clarified, PLAN box added.
- Row count was 18, not 19: a miscount in the old handoff, nothing dropped.
- `make lint`, `make test` ok; `make deploy` + `make dod`: 8 passed, 0 failed.

## In progress
- Nothing half-finished.

## Next step
`9 B Future-work section`: PLAN.md "Future-work section" box (already lists the byte-counting cap in `limitedFetch`): admin one-time password reset link, disabled-login hint, agent system-prompt line, audit rejected 429/401 /mcp requests; skipped bonuses with one-line reasons.

## Gotchas learned
- ADR 023 does contain "Images by digest"; 024 only covers side-loading. The earlier "wrong pointer" suspicion was wrong.
- The cap is checked after the body is buffered, so it does not bound gateway memory (rules/gateway.md has the line).

## Files the next task needs
- docs/PLAN.md (Future-work box, line ~150), docs/THREAT_MODEL.md (where the section goes), docs/REQUIREMENTS.md (bonus list only)
