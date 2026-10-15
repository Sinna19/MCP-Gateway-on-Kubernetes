# Urumi MCP Gateway on Kubernetes

WooCommerce hosting with a team MCP gateway. Urumi AI FDE internship, Round 1 (two weeks).
- Requirements: `docs/REQUIREMENTS.md` (compact). Full text in `docs/ASSIGNMENT.md`, open only to check exact wording.
- Plan and current phase: `docs/PLAN.md`. Last session's state: `docs/HANDOFF.md`.
- Rules for `charts/`, the store and the gateway live in `.claude/rules/` and load when you touch those paths. If one isn't in your context when you edit there, read it first.

## The one rule that overrides speed

I (Ash) must explain and defend every part of this system in a demo video and a live interview.
- Before non-trivial code, state the approach in 3 to 6 bullets and why, plus the exact commands that will prove it works. Wait for my OK on anything architectural.
- Boring, readable code. No abstraction I can't explain in one sentence.
- Design decisions get a short ADR in `docs/decisions/NNN-title.md`.

## Architecture

1. **Store**: WordPress + WooCommerce + MariaDB, in-cluster, PVCs, storefront on Ingress.
2. **woo-mcp**: our MCP server (Streamable HTTP): `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`. ClusterIP only, NetworkPolicy allows the gateway only.
3. **Gateway + dashboard**: Node/TS backend, MCP client to every upstream and MCP server at `/mcp` exposing all their tools. React dashboard for servers, members, keys, audit, chat.
4. **Chat agent**: in the gateway backend, LLM tool loop through the same routing/auth/audit path, acting as the logged-in user.

## Repo layout (target; create folders as phases need them)

```
apps/dashboard/        services/gateway/      services/woo-mcp/
services/fx-mcp/       services/notes-mcp/    (2nd and 3rd upstreams)
charts/{store,woo-mcp,gateway,upstreams,platform}/
deploy/values-local.yaml  deploy/values-prod.yaml
scripts/  docs/{REQUIREMENTS,PLAN,HANDOFF,DESIGN,THREAT_MODEL}.md docs/decisions/ docs/explain/
```

## Stack (change only via an ADR)

k3d locally (same k3s, Traefik, local-path and NetworkPolicy as the VPS) · `*.localtest.me` domains (`shop.`, `app.`) · official `wordpress`/`mariadb`/`postgres` images, our own templates, no Bitnami · TypeScript + official MCP TypeScript SDK · Postgres for the gateway · Woo REST API v3 with a WP Application Password created by a WP-CLI setup Job · LLM via OpenAI-compatible API (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` from a Secret).

## Environment

Dev machine is Windows with Git Bash, Docker Desktop and k3d. Write every script as bash (`#!/usr/bin/env bash`), never PowerShell, use forward-slash paths, and keep LF line endings.

## Commands

<!-- Keep accurate as scripts are created. -->
- `make cluster-up` / `make cluster-down`: k3d cluster `urumi`
- `make images`: build + `k3d image import`
- `make deploy`: helm upgrade --install platform with values-local
- `make lint`: helm lint/template, eslint, tsc (prints failures only)
- `make test`: unit tests, dot reporter (prints failures only)
- `make dod`: `scripts/dod-check.sh`

## Token discipline

My plan has usage limits, and long contexts make you worse. Follow these every session:
- **One task per session.** A task is one checkbox group from a phase, not a whole phase. When it's done, run `/handoff` and stop; I'll `/clear`.
- **Read only what the task names.** Use `docs/REQUIREMENTS.md`, the phase section of PLAN.md, and the files listed in the plan. No exploring the repo "for context"; if you need a file not in the plan, say which and why in one line, then read it.
- **Never read** `node_modules/`, `dist/`, lockfiles, or rendered Helm output in full.
- **Keep command output small**: `--tail`, `-o name`, `| tail -30`, `| grep`, `-q` flags, reporters that print only failures. Never cat a large file to find one thing; grep it.
- **Look things up once.** For SDK/library questions, check the official docs for the one API you need, note the answer in the relevant ADR or rule file, and don't repeat the search next session.
- **Terse progress updates.** While building, report in a few lines: what changed, what passed, what's next. Save long explanations for `/explain`.
- **No auto-compact surprises.** If the context is getting long mid-task, stop at a green point and run `/handoff` instead of continuing.
- **Tests first** for logic (routing, collisions, key hashing, timeouts, roles): write the failing test, then the code. Test the important behaviour, not every line.

## Working conventions

- **Done means verified.** A task is done only when you've run its check (test, lint, `curl`, `kubectl`) and shown me the command and a line of output. Never report "should work".
- If a task is big (new service, new chart, gateway core, agent loop) and I'm not in plan mode, suggest I switch before you start. Small fixes: just do them.
- Small conventional commits (`feat(gateway): …`) at every green point.
- Stage files by name. Never git add -A or git add .
- When something fails in the cluster, read events and logs before changing code.
