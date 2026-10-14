---
description: Save session state to docs/HANDOFF.md so the next session can start fresh after /clear
---
Overwrite docs/HANDOFF.md with at most 25 lines:

- **Done this session:** bullets, with commit hashes.
- **In progress:** what is half-finished and the exact file:line to resume at.
- **Next step:** the single next task, phrased as the argument for `/phase` (e.g. `3 audit log`).
- **Gotchas learned:** anything that cost time and would cost it again. If it's durable, also add it to the right `.claude/rules/*.md` file or ADR instead of leaving it only here.
- **Files the next task needs:** a short list, so the next session reads only those.

Then commit it (`chore: handoff`) and tell me in one line: "Ready to /clear. Next: /phase <args>".
