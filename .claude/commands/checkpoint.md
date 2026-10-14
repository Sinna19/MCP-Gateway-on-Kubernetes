---
description: Commit a green checkpoint and keep PLAN, rules and ADRs in sync with reality
---
1. Run `make lint` and `make test`. If either fails, stop and report the failures only.
2. Check `git status` and `git diff --stat`. Make sure no secrets, .env files, or generated files are staged.
3. Tick finished checkboxes in docs/PLAN.md.
4. If a decision was made, add an ADR in docs/decisions/. If a new command or gotcha appeared, add it to CLAUDE.md "Commands" or the right `.claude/rules/*.md` (one line each).
5. Commit with a conventional message. Do not push.
6. Reply in two lines: what's done, what's next.
