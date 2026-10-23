# Phase 9: CI and hardening (explain)

Scope: the engineering-quality work of phase 9 (PLAN.md "Phase 9" A and C). The docs and demo script are not covered here.
- Flaky test fix (`2416646`, plus `cecfa5b` and `7699549`).
- Kube-context guard hook polish (`f9a4426`, review fix in `70a0d0c`).
- `restore-check` takes a fresh backup first (`8406b61`).
- GitHub Actions CI (`7cebe21`).
- The `/mcp` tool-result cap (`2facf8a`) is the one runtime hardening change.

## 1. What it does and why

Phase 9 makes the repo trustworthy to someone who did not watch it being built. Tests that fail one run in five are removed, the guard hook that protects the VPS stops crying wolf, the backup proof stops giving false DIFFs, and CI runs `make lint` and `make test` on every push and PR. Without these, "it works on my machine" is the only evidence.

## 2. "Request flow" for this phase

There is no user request path here. There are three flows you should be able to narrate.

**A. CI run** (`.github/workflows/ci.yml`)
1. `git push` to `main`, or a PR, triggers the workflow (lines 3-6). A newer push on the same ref cancels the old run (lines 11-13).
2. GitHub starts an `ubuntu-latest` runner with a 15 min cap (17-18) and a read-only token (8-9).
3. `actions/checkout`, `setup-node` (Node 24, npm cache keyed on the 5 lockfiles, lines 22-28) and `setup-helm` v4.3.0 (31-33). All three actions are pinned by commit SHA, with the version in a comment.
4. `npm ci` in each of the 5 projects (37-39).
5. `make lint` (Makefile:118-131) runs these steps and prints failures only:
   - `helm lint` on every chart.
   - `helm template` for local and prod values.
   - A check that prod renders `COOKIE_SECURE "true"`.
   - A check that the prod domain is a single word.
   - `tsc --noEmit && eslint` per TS project.
6. `make test` (134-139) runs vitest per project. The gateway's `global-setup.ts:34-45` runs `docker run postgres:17.6-alpine` on a random localhost port with a random password. It waits until the DB is ready, shares it across test files, and `docker stop`s it afterwards.
7. The hook fixture tests run (`ci.yml:46`).

**B. Guard hook** (PreToolUse on Bash, `.claude/settings.json`)
1. Claude proposes a Bash command. The harness pipes `{tool_input:{command}}` into `guard-kube-context.sh`.
2. Lines 16-30: split the command on `&& || ; & |`. Drop segments whose first word is a read-only command (grep, cat, ls, git log...), unless they contain `$(`, a backtick, `<(`, or a flag that executes or writes (`--pre`, `--ext-diff`, `--output`, ` -O`).
3. Lines 35-41: if the remaining text has no mutating kubectl/helm verb and no VPS marker, exit 0 (allow).
4. Lines 49-63: read every `--context` value. `k3d-*` is ok, `urumi-vps` raises *ask*, anything else raises *deny*.
5. Lines 65-67: `ENV=prod`, `KUBECONFIG=` and similar markers raise *ask*.
6. Lines 69-75: with no context named, the current kubectl context must be `k3d-*`, else *deny*.
7. Line 78: emit the JSON decision.

**C. restore-check** (`scripts/restore-check.sh`)
1. Create Job `gateway-backup-for-check` from the nightly CronJob (28). Poll until the Job's `Complete` or `Failed` condition is True (31-36).
2. Record the Job `startTime` as `gateway-YYYYMMDDTHHMMSSZ.dump` (40-41).
3. Apply a throwaway pod labelled like the backup pod, so the NetworkPolicy lets it reach Postgres (45-105).
4. In the pod, pick the newest dump by name (83) and fail if it is older than `MIN_DUMP` (86-88).
5. `pg_restore` into `restore_check` (89-90), compare per-table row counts with the live DB (92-96), print PASS or FAIL.
6. Traps drop the DB, the pod and the Job on exit (24, 80).

## 3. Kubernetes objects involved

Only `restore-check` and the CronJob touch the cluster in this phase.
- **Pod `gateway-restore-check`** (`restore-check.sh:45-105`):
  - `restartPolicy: Never`: a failed check is reported once, not retried.
  - `automountServiceAccountToken: false`: the pod has no API access.
  - `runAsNonRoot` with uid 70 (postgres), `readOnlyRootFilesystem`, `drop ALL` capabilities, `seccomp RuntimeDefault`.
  - `fsGroup: 70` matches the backup PVC ownership.
  - Resources requests 10m/32Mi, limits 200m/256Mi.
  - The password comes via `secretKeyRef` env, not argv.
  - The backups PVC is mounted `readOnly: true` (101-104): the check cannot damage the dumps.
- **Label `app.kubernetes.io/name: gateway-postgres-backup`** (51): this is the whole trick. The Postgres NetworkPolicy allows ingress from pods with this label, so a pod that borrows it can connect. The comment at line 81 says new pod IPs are refused for a few seconds, hence the `pg_isready` loop.
- **Job `gateway-backup-for-check`**: created with `kubectl create job --from=cronjob/...`, so it uses the same image, PVC, resources and policy label as the real nightly.
- **CronJob** (`charts/gateway/templates/backup-cronjob.yaml:64-75`):
  - `umask 077`, so dumps are owner-only.
  - Writes to `$f.tmp` and then `mv`s, so a half-written dump never has the real name. The trap removes the tmp file.
  - Retention is `find -mtime` (age-based).
  - The dump name at line 68 is the contract `restore-check` depends on.

## 4. Failure modes and how they are handled

| Failure | Handling |
|---|---|
| Flaky `mcp-endpoint` test | Root cause fixed (below). No retries and no `skip`. |
| Backup Job fails | Terminal-condition poll, tail of the logs, `exit 1` (`restore-check.sh:37`). |
| Backup pod fails once, retry succeeds | Old code counted `.status.failed` as failure. Now only the `Failed` condition counts (31-34). |
| Stale dump restored, false pass | `MIN_DUMP` compare (86-88) fails the check if the newest dump is older than the Job. |
| Writes between dump and count | Accepted, documented at lines 8-9. Seconds-wide window. |
| Restore leaves a copy of data behind | The EXIT trap drops `restore_check` even on failure (80). |
| `docker` missing in CI | `execFileSync` throws, so the whole test run fails loudly. The runner has Docker. |
| Hook sees prod name as text | Read-only segments are dropped (no false prompt). |
| Hook sees hidden execution | `$( )`, backtick, `<( )`, `--pre`, and similar flags keep the segment scanned. |
| Hook `jq` or `kubectl` slow or missing | Not handled. Accepted: the hook is a guard rail, not the only control. |
| Tool result larger than the cap | Becomes an error to the caller (`upstreams.ts:49`, default 1 MB from `config.ts:34`). |

**Flake root cause** (the one to be able to tell as a story):
- `beforeEach` runs `TRUNCATE ... CASCADE` (`helpers.ts:36-38`), which needs an exclusive lock.
- The `/mcp` POST sends its SSE response headers before the handler finishes. `listRequest` (`mcp-endpoint.test.ts:98`) never read the body, so the test ended while a `tool_rules JOIN upstream_servers` query was still running.
- That query deadlocked with the next test's TRUNCATE. It failed about 1 run in 5.
- Fix: drain the body (`res.text()`). `app.sweep()` now returns the purge promise (`app.ts:89-95`), so tests `await` it instead of sleeping. `allSettled` makes the promise mean "both deletes finished" even if one failed.
- Proof: 20/20 file runs, 5/5 full `make test`.
- Diagnosis came from `pg_stat_activity` and the deadlock detail, not from reading the SDK source.

Two later test fixes (`cecfa5b`, `7699549`): concurrent admin demotion has two valid orderings (200+409, or 200+403/401), so the test accepts both. A second test holds a table lock to force the 409 path deterministically (`api-invites-members.test.ts:174`) and now fails on timeout instead of silently continuing.

## 5. Security

- **Trusted:** the repo, the CI runner, the pinned actions, the committed hook. **Not trusted:** the command text Claude proposes, which is why the hook parses it.
- **Credentials in CI:** none. No `secrets.*`, no cluster, no deploy. The token is `contents: read` (`ci.yml:8-9`). Tests use a throwaway Postgres with a random password that lives only in the runner's memory and on the container's localhost-bound port.
- **Supply chain:** actions pinned by SHA, so a moved tag cannot change what runs. `npm ci` installs exactly the lockfile. Helm is pinned. Accepted gap: the `postgres:17.6-alpine` test image is pinned by tag, not digest.
- **Hook** (the control over prod): `ask` before anything touching `urumi-vps`, `deny` for any foreign context or non-k3d default context. It is a guard rail, not a security boundary: it is regex, and a determined `eval "$(...)"`-style obfuscation can get past it. The real protection for prod is that the SSH key needs Ash's ssh-agent.
- **restore-check:** the password never appears in argv or logs (secretKeyRef). The restored copy lives in a temp DB that is always dropped.
- **Tool-result cap:** a compromised or buggy upstream cannot make the gateway buffer unbounded data. The cap is measured on the JSON already received, so it bounds what is forwarded, not what was read. That is the future-work item "byte-counting cap in `limitedFetch`".

## 6. Ten interview questions

1. **How did you find the flaky test's cause?** I did not guess. I captured `pg_stat_activity` and the Postgres deadlock detail on a failing run. It showed TRUNCATE waiting on a leftover SELECT. Then I explained why the SELECT outlived the test: the SSE headers were sent before the handler finished.
2. **Why not add a retry or `retry: 2` in vitest?** It hides a real bug (a leaked query) and slows the suite. The brief said no retries or skips, and the fix was five lines.
3. **Why does CI start Postgres with `docker run` instead of a `services:` block?** The tests need a random port and password and one lifecycle owned by the test code. It runs the same on a laptop and in CI, so there is a single code path. Trade-off: CI needs Docker, which GitHub runners have.
4. **Why no deploy in CI?** There is no cluster in GitHub and no secrets in the workflow. The VPS is reached through an SSH tunnel by a human with an agent loaded (ADR 024). A CD step would need a long-lived credential for prod, which is more risk than a 10-minute manual deploy.
5. **Why pin actions by SHA?** Tags are mutable. A hijacked `v7` tag would run attacker code with the job's token. The token is read-only anyway, which limits the damage.
6. **Why is the CI cache keyed on lockfiles?** `setup-node` hashes them, so a dependency change invalidates the cache and nothing else does. `npm ci` ignores `package.json` drift.
7. **Why a hook rather than just being careful?** The assistant runs commands on my machine, and a wrong `kubectl` context could hit the VPS. The hook makes the safe path the default: k3d is free, prod needs a click, other contexts are blocked.
8. **Why drop read-only segments in the hook instead of improving the regex?** Prompts on `grep ENV=prod Makefile` trained me to click "yes" blindly, which defeats the guard. Removing text-only commands before matching fixes the cause, and the exceptions (`$(`, `--pre`) are listed and tested.
9. **Why does restore-check compare row counts, not content?** Cheap, and it catches empty or truncated dumps and failed restores. It does not prove column-level fidelity. A checksum per table would be the next step (accepted).
10. **Why take a fresh backup inside restore-check?** Without it, any write since 02:00 (a chat, a dod run) shows a false DIFF, so the check is noisy and gets ignored. `SKIP_BACKUP=1` still exists to test the nightly dump as-is.

## 7. Weak spots to be ready to defend

- **Hook is regex.** It is stricter on purpose (`git -C dir log` is still scanned), but it can be fooled by `eval`, variables, or `bash -c "..."` built from pieces. Say it is a guard rail against mistakes, not a sandbox. The ssh-agent requirement is the real gate.
- **Hook tests take about 70 s** (process start on Windows) and run in CI on Linux, which is faster but a different shell environment than the one the hook is used in.
- **CI gaps:** it never runs `helm install`, so a chart that lints and renders but fails on a real cluster passes. `make dod` is the only check for that, and it is manual. The `postgres` test image is tag-pinned, not digest-pinned. The `ci.yml` helm version (v4.3.0) must be kept in step with the dev machine by hand.
- **CI runs on `push` to `main` plus all PRs.** Pushes to other branches without a PR are not tested.
- **I could not show a green GitHub run in this session:** the commit is in, but check the Actions tab (or `gh run list`) before the demo and do not claim it passes until you have seen it.
- **restore-check races:** the nightly CronJob firing during the check, and writes between dump and count (documented, accepted). Dump selection relies on filename format, a coupling written as a comment at `restore-check.sh:38-39`; if the CronJob changes the name, the stale-dump compare silently misorders.
- **Row counts only** (see Q9).
- **Test-only fixes can mask product bugs.** The 409 test uses an artificial table lock to reach a race path. Be clear that it proves the guard logic, not production timing.
- **Tool-result cap** counts after the fetch. It is a memory/response guard, not a network-transfer limit.

## 8. The admin-demotion race test (`cecfa5b`, `7699549`)

**What is being protected.** `PATCH /members/:id` must never leave the system with zero enabled admins. The product code already does this: it takes `LOCK TABLE users IN EXCLUSIVE MODE` in a transaction, then checks "is there another enabled admin?" and does the update as one step (`services/gateway/src/api/members.ts:40-47`, the last-admin check at `:55-58`). The lock is a product feature (same pattern as `bootstrap.ts:16`). These commits only changed the tests.

**The failure.** The test "two admins removing each other at once" (`test/api-invites-members.test.ts:202`) expected exactly `[200, 409]`. That is only one of two valid outcomes:
- Both requests pass the auth check before either change lands. The lock serialises them, and the loser hits the last-admin guard and gets **409**.
- One change commits before the other request passes auth. The loser's caller is no longer an admin (**403**) or is disabled, so its session is dead (**401**).

Which one happens depends on timing, so the test failed intermittently. I found this by reading the test and the two orderings, not from a captured run. **I could not verify the CI run that failed**: `1305d7a` is only a handoff commit, and its handoff text says the first CI run of `7cebe21` still needed checking in the Actions tab (`gh` is not installed). Check the Actions history before you say "CI caught it".

**Fix 1, `cecfa5b`.**
- The both-orderings test now accepts `[403 or 401, 409]` for the loser (`:213-215`): 403 for the `role: member` case, 401 for the `disabled: true` case. The winner is always 200, and exactly one enabled admin must remain (`:216-217`). The comment at `:198-201` explains why.
- Because sequential calls can never reach the 409 (a demoted or disabled actor fails auth first), a **new deterministic test** forces it (`:172-196`):
  - A second connection (`holder`) opens a transaction and takes `LOCK TABLE users IN EXCLUSIVE MODE`.
  - Alice's PATCH is sent. It passes auth, then blocks on the same lock inside the handler.
  - `holder` disables alice's row and commits.
  - Alice's request then runs the guard: carol is the target, no other enabled admin is left, so **409**. Carol's row is untouched.

**Fix 2, `7699549`.** The first version of that test polled `pg_locks` for any ungranted lock and gave up silently after 100 tries. Two problems: another relation's lock wait could satisfy it, and a timeout would let the test carry on and fail in a confusing way. Now it:
- filters on `relation = 'users'::regclass AND NOT granted` (`:182`),
- polls up to 250 times at 20 ms,
- asserts `expect(blocked).toBe(true)` (`:185`), so a timeout fails clearly at that line.

**Say it in the interview.** "The product was right. The test asserted one of two legal outcomes. I made the test accept both, and added a lock-forced test so the 409 path is still proven. It is deterministic because the test controls who waits on the lock."

**Be ready to defend.**
- The deterministic test proves the guard logic, not production timing.
- Polling `pg_locks` is a wait on database state, not a sleep for a guess, but it is still polling with a 5 s ceiling.
- The 403/401 split in the assertion depends on which change the test applies (`change.role ? 403 : 401`).
