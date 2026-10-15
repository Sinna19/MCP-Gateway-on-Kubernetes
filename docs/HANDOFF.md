# Handoff

- **Done this session:** Phase 2b, woo-mcp in the cluster.
  - 8b15ddf fix(woo-mcp): `toolResult` logs unexpected errors; non-JSON 200 throws WooError; `client.list()` gives `{items,total,total_pages}` and `list_products`/`list_orders` use it. 34 tests.
  - a6cb8f1 feat(woo-mcp): Dockerfile, `charts/woo-mcp` (Deployment, ClusterIP Service, NetworkPolicy from `app.kubernetes.io/name=gateway`), `make images`/`deploy` with tag = tree hash of `services/woo-mcp`.
  - d39f520 docs: ADR 005, Phase 2 chart and ADR boxes ticked.
  - Verified on k3d: pod `1/1 Running` with the policy on; `tools/list` shows 5 tools; `create_product` "Accept Mug" id 17, `grep -c` on `/shop/` = 3; labelled pod gets `ok` exit 0.
- **In progress:** one Accept deviation, needs your call. Unlabelled pod is blocked but curl exits **7** (connection refused), not 28. k3s kube-router rejects instead of dropping; DNS resolves and the labelled control passes, so the block is the policy. Your "exactly 28" check can't pass on k3s; I did not change it. Suggest the check assert exit 7 plus the labelled control. No `scripts/` check exists yet; the Phase 7 DoD script should include this.
- **Next step:** `3a gateway service + tests` (Phase 3 is big; see split-big-phases memory)
- **Gotchas learned:**
  - New pods are refused for a few seconds even with the right label (kube-router sync). Wait for Ready plus ~10s, or use `sleep` pods and `kubectl exec`. Added to `.claude/rules/kubernetes.md`.
  - Commit service changes before `make deploy`: the tag comes from `git rev-parse HEAD:services/woo-mcp`, so uncommitted edits keep the old tag and the old pod.
  - The 2a handoff said PLAN.md was uncommitted; it was already committed (70456c8).
  - The shell cwd persists between Bash calls; `cd` into a service dir leaks into later commands. Use absolute paths or `cd` back.
- **Files the next task needs:** CLAUDE.md, docs/REQUIREMENTS.md, docs/PLAN.md (Phase 3), `.claude/rules/gateway.md`, `services/woo-mcp/{package.json,tsconfig.json,eslint.config.js,vitest.config.ts,src/server.ts}` (copy the service layout), `Makefile` (`TS_SERVICES`).
