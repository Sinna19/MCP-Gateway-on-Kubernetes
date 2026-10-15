# 001: Local cluster is k3d, deploy with one umbrella chart

Status: accepted

## Decision
- Local cluster: k3d (k3s in Docker). The VPS runs k3s, so Traefik, local-path storage and NetworkPolicy behave the same in both places.
- Hostnames: `shop.localtest.me`, `app.localtest.me`. `*.localtest.me` resolves to 127.0.0.1, so no hosts-file edits. On the VPS only `global.domain` changes.
- One umbrella chart `charts/platform` with `file://` dependencies (store, woo-mcp, gateway, upstreams). `make deploy` runs `helm dependency update` then one `helm upgrade --install`. Environment differences live only in `deploy/values-local.yaml` and `deploy/values-prod.yaml`.
- The namespace `urumi` is created with `--create-namespace`, not a template. Helm stores the release record in that namespace, so a templated Namespace is chicken-and-egg, and uninstall or rollback could delete it together with the PVCs (store data).

## Consequences
- Dependency tarballs (`charts/*/charts/*.tgz`) are gitignored and rebuilt on deploy.
- Namespace deletion is a manual, deliberate act.
- The API port is pinned to 6550 (`--api-port`). On Windows, k3d's random port can fall in a reserved range (`netsh interface ipv4 show excludedportrange protocol=tcp`), and after a Docker restart the cluster then refuses to start.
