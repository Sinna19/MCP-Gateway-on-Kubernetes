---
description: Run the acceptance checks of the current phase, or the full Definition of Done with "dod"
argument-hint: [phase number | dod]
---
Verify: $ARGUMENTS

- If the argument is a phase number, run every **Accept** check for that phase in docs/PLAN.md against the live k3d cluster.
- If the argument is `dod`, walk through every bullet of "Definition of done" in docs/REQUIREMENTS.md. Use `make dod` for what is scripted, then list the bullets that need a manual step and give me the exact commands or clicks.

For each check, report: PASS / FAIL / MANUAL, the command you ran, and a one-line excerpt of the evidence. Do not fix anything in this command; list failures with the likely cause and the file to look at.
