# Handoff
## Done this session (Phase 9, B: README)
- `4c6ef9f` docs: README "Run locally (k3d)" section (prereqs, cluster-up, deploy, register, admin password, order, MCP client config, chat, `make dod`, gotchas) and "Stand-out items" list (#1, #2, #6, #7, #9 plus backups and result size cap; CI is a TODO line).
- Same commit: DESIGN.md now lists upgrades/rollback as done, observability as partial (healthz/readyz, audit, plain-text logs; no metrics or alerting), horizontal scaling skipped (ADR 006). "Attempted instead" replaced by a pointer to the README list.
- PLAN boxes for README local section and stand-out list ticked. `make lint` ok.

## In progress
- Nothing half-finished.

## Next step
`9 C CI workflow` (then remove the TODO CI line in README "Stand-out items" and add the workflow pointer).

## Gotchas learned
- Commands in the README were checked against the Makefile/scripts/REHEARSAL.md, but NOT run this session. The Claude Desktop `mcp-remote` snippet is untested (marked so).
- The Chrome-lockout fix (`rollout restart deploy/gateway`) relies on login buckets being in memory (ADR 020); confirm during the demo pre-flight.
- Gateway logs are plain `console.log`, not structured JSON; the README/DESIGN say so.
- README stand-out numbers follow the optional list order in REQUIREMENTS.md (1 VPS, 2 permissions, 6 hardening, 7 scaling+rate limits, 9 upgrades).

## Files the next task needs
- docs/PLAN.md (Phase 9 section C), Makefile (lint/test targets), README.md (stand-out CI line)
