# Handoff
## Done this session (Phase 9, B: DESIGN.md + future work)
- `65ddbb2` docs: new `docs/DESIGN.md` with six sections: architecture (mermaid + ownership table), aggregation/routing, auth/roles, failure handling, local vs prod (from `deploy/values-prod.yaml`), future work + skipped bonuses. Future work is its last section; both PLAN boxes ticked. `make lint` ok.
- Claims were checked against code/ADRs by grep. Judgement calls Ash should confirm before the demo: the "skipped bonuses" reasons, and that observability and upgrades/rollback are listed as not attempted.

## In progress
- Nothing half-finished.

## Next step
Rest of Phase 9 (see PLAN.md Phase 9 unchecked boxes): README (README has no stand-out list yet; DESIGN's last line says "Attempted instead", so the README list should match it), demo video.

## Gotchas learned
- README currently has no stand-out section; PLAN lists it as a Phase 9 item.
- No admin password-reset exists and a disabled login returns the generic 401 (`api/auth.ts`); both are in Future work.

## Files the next task needs
- docs/PLAN.md (Phase 9 section), docs/REQUIREMENTS.md, README.md

## Recent commits
65ddbb2 docs: design and future work
22d0e81 chore: handoff
7152f86 docs: threat model follow-ups
2facf8a fix(gateway): cap tool-result size on /mcp
