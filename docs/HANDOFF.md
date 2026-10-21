# Handoff
## Done this session (Phase 9, C: CI)
- `7cebe21` ci: `.github/workflows/ci.yml` (push to main + PR, `contents: read`, concurrency per ref with cancel, ubuntu-latest, Node 24, npm cache over the 5 lockfiles, helm v4.3.0 via setup-helm, `npm ci` in each TS project, then `make lint`, `make test`, `bash .claude/hooks/test-guard-kube-context.sh`).
- Actions pinned to full SHAs fetched with `git ls-remote`: checkout v7.0.1, setup-node v7.1.0, setup-helm v5.0.1 (tag in a comment).
- README "CI" stand-out line now points to the workflow; PLAN box ticked. `make lint` ok locally.

## In progress
- **The first CI run is unchecked.** `gh` is not installed, so I could not watch it. Look at the Actions tab of the GitHub repo for commit `7cebe21`. If it fails, fix the root cause in `.github/workflows/ci.yml` (never skip tests) and push again.

## Next step
`9 D Demo` (demo script against the live VPS, pre-flight checklist, record). Check the CI result first.

## Gotchas learned
- No Makefile change was needed: `make lint` and `make test` need no cluster. `deps` uses `file://` chart dependencies, and the `--kube-context` flag is not contacted by `helm dependency update`.
- Gateway tests start their own Postgres with `docker run postgres:17.6-alpine` (`services/gateway/test/global-setup.ts`), so CI has no Postgres service container. It relies on Docker being on the runner.
- Makefile image tags use `git rev-parse HEAD:<dir>`, so CI needs a git checkout (the default one is enough).
- No `.nvmrc` and no root package.json; Node comes from `engines` (>=24) and is set in the workflow.
- Untested before push: the hook test script in CI (it was written for Git Bash; ubuntu bash should be fine).

## Files the next task needs
- docs/PLAN.md (Phase 9 section D), docs/REQUIREMENTS.md (six video sections), docs/REHEARSAL.md if present, README.md
