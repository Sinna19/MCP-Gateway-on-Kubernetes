# Claude Code workflow for the Urumi MCP Gateway

You have no code yet, so `/init` has nothing to read. Instead, this kit gives Claude the context `/init` would have produced, written from the assignment: architecture, stack, rules, and a phased plan. You copy it into an empty repo and work phase by phase.

## 1. One-time setup (15 minutes)

1. Install: Docker, `k3d`, `kubectl`, `helm`, Node 20+, `jq`, Claude Code.
2. Create the repo and drop the kit in:
   ```bash
   mkdir urumi-mcp-gateway && cd urumi-mcp-gateway && git init
   unzip ~/Downloads/urumi-claude-starter-kit.zip    # or copy starter-kit/ contents here
   chmod +x .claude/hooks/*.sh
   git add -A && git commit -m "chore: claude code workflow kit"
   ```
3. Start `claude` in the repo. Run `/hooks` once to confirm the four hooks are loaded, `/agents` to see the two reviewers, `/model opusplan`, and `/context` to see your baseline.
4. Read `CLAUDE.md` yourself and change anything you disagree with *now* (stack, language, LLM provider). It's the contract Claude follows for two weeks.

## 2. What's in the kit

| File | Purpose |
|---|---|
| `CLAUDE.md` | Project memory: architecture, stack, commands, and token discipline rules. Kept short because it loads every turn. |
| `.claude/rules/*.md` | Kubernetes, store and gateway rules that load only when Claude touches those folders. |
| `docs/REQUIREMENTS.md` | The assignment compressed to one page. Claude reads this, not the full text. |
| `docs/ASSIGNMENT.md` | The full PDF text, only for checking exact wording. |
| `docs/HANDOFF.md` | Where the last session stopped. Written by `/handoff`, read by `/phase`. |
| `docs/PLAN.md` | 10 phases mapped to the 14 days, each with checkboxes and **Accept** checks taken from the Definition of Done. |
| `docs/decisions/` | ADRs. Every "why did you choose X?" in the interview should have one. |
| `docs/explain/` | Interview prep notes, one per component, written by `/explain`. |
| `.claude/settings.json` | Permissions: read-only kubectl/helm, tests and lint run without prompts; deletes and pushes ask; `.env` and keys can't be read. |
| `.claude/hooks/guard-secrets.sh` | Blocks any edit that writes a literal API key, password or private key (the "no hardcoded secrets" requirement). |
| `.claude/hooks/guard-kube-context.sh` | Mutating `kubectl`/`helm` commands run freely on the local k3d cluster but require your approval on any other context (your VPS). |
| `.claude/hooks/post-edit-check.sh` | Runs `helm lint` after every chart edit and prettier after TS edits, so Claude sees errors immediately. |
| `.claude/hooks/stop-typecheck.sh` | Claude can't end a turn with TypeScript errors in packages it changed. |
| `/phase N [task]` | Pulls in just that phase's section, the last handoff and recent commits, then plans, tests first, builds and accept-tests one task. |
| `/handoff` | Saves state in 25 lines so you can `/clear` without losing anything. |
| `/verify N` or `/verify dod` | Run acceptance checks or the full Definition of Done, with evidence. |
| `/explain <component>` | Writes interview notes from the real code, then quizzes you. |
| `/checkpoint` | Lint, test, update PLAN/CLAUDE.md/ADRs, commit. |
| `/demo-prep` | Builds the demo video script against the six required sections. |
| `k8s-reviewer`, `security-reviewer` | Read-only subagents on Sonnet that review charts and gateway security. Use at checkpoints only. |

## 3. The loop (every phase)

```
/clear
/phase 3 upstream manager   # one task, not a whole phase
  (big task? shift+tab into plan mode; push back on anything you can't explain)
  approve -> tests first, then code, commits at green points
/handoff                    # Claude saves state
/clear
...next task...
end of phase:  /verify 3  ->  "use the k8s-reviewer agent on charts/gateway"  ->  /explain gateway-routing  ->  /checkpoint
```

Rules that make this work:
- **`/clear` between tasks, not just phases.** HANDOFF.md, PLAN.md and git carry the state, so a fresh context is cheap and keeps Claude sharp.
- **Plan before code** for phases 1, 3 and 6. Those are where the hard choices are (setup Job and app passwords, aggregation and sessions, the agent loop).
- **Verify against the cluster, not just tests.** Ask Claude to show you `kubectl` output and the MCP Inspector result.
- **Do `/explain` yourself, every phase.** The interview asks you to defend every part. The quiz is the cheapest prep you'll get.
- **Commit on green.** If a session goes sideways, `git reset` to the last checkpoint instead of arguing with it.

## 4. Saving tokens

These come from the video you sent, filtered for this project:

| Tip from the video | How the kit applies it |
|---|---|
| New session for every task; quality drops past roughly 100k to 200k tokens | Phases are split into tasks. `/phase` does one task, `/handoff` saves state, you `/clear`. |
| Don't let auto-compact happen; compact yourself or restart | CLAUDE.md tells Claude to stop at a green point and hand off when the context gets long. If you must stay, run `/compact keep: current task, failing test, files touched`. |
| Check `/context` before big tasks | Run it before `/phase` on phases 1, 3 and 6. If MCP tools you don't need show up there, disable them in `/mcp`. |
| Be very specific; stop research tangents | `/phase` injects only the phase's section, the handoff and recent commits. CLAUDE.md forbids exploring the repo, and `.claude/settings.json` blocks reading `node_modules`, `dist` and lockfiles. |
| Plan with the smart model, implement with a cheaper one | Run `/model opusplan`: Opus while in plan mode, Sonnet while building. The reviewer subagents are pinned to Sonnet. |
| Plan mode for big tasks only | Written into CLAUDE.md: new service, new chart, gateway core, agent loop. |
| Verification is the top tip: tests first, typecheck, lint | `/phase` writes failing tests first. Hooks lint charts on every edit and typecheck before a turn ends. `make lint`/`make test` print failures only. |
| Don't spam skills or MCP servers | The kit adds no MCP servers. Rules files load only for the folders they cover, and commands load only when you call them. |
| Subagents burn limits fast | Only two, read-only, on Sonnet, used once per phase. |
| Have Claude teach you as you go | `/explain` plus its quiz, kept separate so day-to-day updates stay short. |
| `!` shell mode, `/btw` | Run `! kubectl get pods` yourself instead of asking Claude to. Use `/btw why X?` for side questions; they don't enter the conversation history. |

Also in the kit: Bash output is capped at 15,000 characters (`BASH_MAX_OUTPUT_LENGTH`), so one noisy `helm template` or test run can't flood the context.

I left out three things from the video on purpose:
- **caveman** (ultra-terse replies): it would hurt the explanations you need for the interview. CLAUDE.md asks for terse progress updates instead.
- **rtk** (compresses command output): it's optional. Try it if output still dominates `/context` after a few phases.
- **`/loop`, goal mode and worktrees**: they spend tokens faster, and this is a solo two-week build.

## 5. Kickoff prompt for session one

```
Read CLAUDE.md, docs/REQUIREMENTS.md and docs/PLAN.md. Before we start phase 0,
list anything in CLAUDE.md that conflicts with the assignment or that you think
is a risky choice, and the 5 riskiest parts of the whole build in order.
Then /phase 0.
```

## 6. Decisions I made for you (change in CLAUDE.md if you disagree)

- **k3d instead of Kind/Minikube.** It *is* k3s, so local and VPS share Traefik, the `local-path` storage class, and NetworkPolicy enforcement. Your "local to prod only changes values" story becomes almost trivially true.
- **`*.localtest.me` domains.** Resolve to 127.0.0.1 publicly, no `/etc/hosts`. That's your documented local-domain approach.
- **TypeScript for everything.** The official MCP TypeScript SDK has both the Streamable HTTP server and client you need for the gateway.
- **Tool names `<server_slug>__<tool>`.** Simple to route, simple to explain, solves collisions.
- **Application Passwords over WooCommerce consumer keys.** Basic auth works over in-cluster HTTP, and a WP-CLI Job can create them automatically.
- **Two extra upstreams you write** (`fx-mcp` with a bearer credential, `notes-mcp` with a deliberate name collision). You control them, so pod-kill, credential and collision demos are reliable. The official "everything" reference server is a fine fourth.
- **Chat agent calls the same `callTool(user, …)` function as `/mcp`.** One code path for auth, routing and audit, which is easy to defend.

## 7. Things to decide early (they bite late)

- **Tool list refresh in external clients.** When you disable a server, clients only drop its tools if the gateway sends `notifications/tools/list_changed` on a live session (or the client reconnects). Decide stateful sessions in phase 3, and test with Claude Code before the demo.
- **Bootstrap.** How the first admin and the woo-mcp registration get created on a fresh install (a Secret + startup seed). You'll reinstall many times.
- **One stand-out item only after phase 9 drafts exist.** Tool permissions per role (#2) and SSRF protection (#6) are the cheapest given this design, and the VPS deploy (#1) is already in the plan.

## 8. Testing the gateway from Claude Code (DoD user B)

```bash
claude mcp add --transport http urumi http://app.localtest.me/mcp \
  --header "Authorization: Bearer <user B's umk_ key>"
```
Then `/mcp` in Claude Code to see the tools, or use `npx @modelcontextprotocol/inspector`. Keep this config out of the repo.
