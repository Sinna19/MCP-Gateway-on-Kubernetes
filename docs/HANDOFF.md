# Handoff
## Done this session (Phase 9 D: demo script)
- Wrote `docs/DEMO_SCRIPT.md` (a0e604c): pre-recording checklist, DoD flow mapped across the six video sections (about 15 min), live-VPS commands, THREAT_MODEL rows to point at, Helm upgrade and 1-revision rollback explained (not executed).
- Ticked the Demo box in `docs/PLAN.md` line 160, with a note that recording is not done.
- `make lint`: ok. No command was run against the VPS (no ENV=prod, no urumi-vps context, no users or keys created).

## In progress
- Nothing half-finished. The recording itself is still to do (Ash).

## Next step
`9 D record`: Ash works through the checklist in `docs/DEMO_SCRIPT.md`, rehearses sections 1 and 3 once, then records. After that, only the submission form remains (https://forms.gle/nftwgyNeenSDmiRb6).

## Gotchas learned
- ASSIGNMENT.md sets no video length limit; 15 min is my own budget.
- `ENV=prod make dod` scales notes-mcp to 0 and disables fx itself: do not run it during the recording.
- Disabling fx: the chat model may answer a currency question from memory. Prove it with the Audit page and the tool list (REHEARSAL row 11).
- Cannot show live: a timeout (no slow tool), the two-upstream single prompt through an LLM client (never run), Claude Code/Desktop snippets (untested). Full list at the end of DEMO_SCRIPT.md.
- Never delete TLS Secrets or the namespace on the VPS; roll back one Helm revision at most.

## Files the next task needs
- docs/DEMO_SCRIPT.md (checklist and sections), docs/REHEARSAL.md only if a step fails

## Recent commits
a0e604c docs: demo script
32605a9 chore: handoff
89ffdc7 chore: handoff
