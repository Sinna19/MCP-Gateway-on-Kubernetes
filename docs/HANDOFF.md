# Handoff

## Done this session
- 3d67f1f docs: demo script fixes (docs/DEMO_SCRIPT.md only, pushed). make lint ok.
  - Added checklist step 0 (Azure NSG rule urumi-vps-nsg, priority 340, My IP).
  - Tunnel command now `ssh -i ~/.ssh/urumi-vps ... -L 16443:127.0.0.1:6443 azureuser@20.197.63.44` (matches ~/.kube/urumi-vps.yaml).
  - Helm: current revision 7, one-step rollback targets 6 (explained, not executed).
  - Claude Code connect: run from a scratch folder outside the repo, local scope, remove right after section 1.
  - wp-admin user is `admin` (secret store-wp-admin, key password); chat file is services/gateway/src/chat/agent.ts.
  - Verified unchanged: HELM_EXTRA, gateway.limits.mcp.callsPerMinute, gateway limits 500m/256Mi, health 5 s, timeout 15 s, ADR 024 pointers.

## In progress
- Nothing half-finished.
- README.md:80-82 still says local port 6443 for the tunnel, but the kubeconfig uses 16443. Fix when README is next touched.

## Next step
`/demo-prep` rehearsal: run the pre-recording checklist in docs/DEMO_SCRIPT.md (steps 0 to 14), then record.

## Gotchas learned
- Home IP changes daily: the NSG SSH rule must be updated in the Azure portal before the tunnel works.
- Never use `--scope project` for `claude mcp add`; it writes the API key into .mcp.json.
- The `urumi` MCP server configured in Claude Code currently fails with 401 (invalid or missing API key); needs a fresh key.

## Files the next task needs
- docs/DEMO_SCRIPT.md
- README.md (VPS section, lines 76-125)
