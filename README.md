# Urumi MCP Gateway on Kubernetes

WooCommerce store + woo-mcp + team MCP gateway with dashboard and chat agent, all deployed with Helm.

Status: Phase 0 (foundation). Full setup, VPS, MCP client and chat instructions land in Phase 9.

## Quick start (local)

Needs Docker Desktop, k3d, helm, kubectl, make (Git Bash on Windows).

    make cluster-up
    make deploy
    make register   # gives the gateway woo-mcp's token; until then woo shows Unreachable
