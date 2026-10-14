---
description: Work on one task of a build phase (plan, tests first, build, verify) with minimal context
argument-hint: <phase number> [task, e.g. "3 upstream manager"]
allowed-tools: Bash(cat docs/HANDOFF.md), Bash(git log --oneline -8)
---
## Last handoff
!`cat docs/HANDOFF.md`

## Recent commits
!`git log --oneline -8`

## Your task
Phase and task: $ARGUMENTS.

1. Read only the matching `## Phase N:` section of docs/PLAN.md: find its line with Grep, then Read just that range. If no task was named, pick the first unchecked checkbox group in it and tell me which.
2. Use only that section, `docs/REQUIREMENTS.md`, and the files the task needs. Don't explore the repo.
3. Give a short plan: files to touch, K8s objects, request flow, open questions. Ask me to decide anything architectural before coding. For big tasks, suggest I switch to plan mode.
4. For logic, write the failing tests first, then the code. Run `make lint` and `make test` at each green point and commit.
5. Run the phase's **Accept** checks that this task affects, against the real cluster, and report PASS/FAIL with the command and one line of output each.
6. Tick the checkboxes in docs/PLAN.md, then run the steps of `/handoff`. Don't start the next task.
