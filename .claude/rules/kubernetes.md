---
paths:
  - "charts/**"
  - "deploy/**"
  - "scripts/**"
---
# Kubernetes rules

- Every workload: readiness + liveness probes, resource requests + limits, non-root where the image allows.
- No secret values in templates, values files, or ConfigMaps. Values reference Secret names; secrets are created by `scripts/` or via `existingSecret`. Never print secret values in output.
- woo-mcp and the extra upstreams: ClusterIP only, no Ingress, NetworkPolicy allowing ingress only from gateway pods.
- PVCs for MariaDB data and `wp-content`; storageClass from values.
- Local vs prod differences only in `deploy/values-*.yaml`. If a template needs `if prod`, make it a value.
- k3d needs `k3d image import` for local images and `imagePullPolicy: IfNotPresent`.
- Traefik must not buffer SSE responses on `/mcp`.
- Quiet output: `helm template ... | grep -A3 <thing>` instead of dumping full renders; `kubectl get -o name`; `kubectl logs --tail=50`; `kubectl describe` piped through `sed -n '/Events/,$p'` when you only need events.
- Windows Git Bash: prefix `kubectl exec ... -- /path` with `MSYS_NO_PATHCONV=1` (otherwise `/var/...` becomes a Windows path). Python `open().write()` writes CRLF; strip with `sed -i 's/\r$//'`. After a Docker restart, if `kubectl` is refused, check `netsh interface ipv4 show excludedportrange protocol=tcp` (ADR 001).
- k3s NetworkPolicy (kube-router) REJECTS blocked traffic: curl gets "connection refused" (exit 7), not a timeout (28). Prove a deny test with a labelled control pod that succeeds, and wait for the test pod to be Ready plus ~10s first (new pod IPs are refused until the policy syncs).
- Image tags come from `git rev-parse HEAD:services/<name>` (Makefile). Commit service changes before `make deploy` or the pod keeps the old image.
- Windows `jq -r` ends lines with CR; pipe through `tr -d '\r'` (e.g. `helm status -o json | jq -r .version | tr -d '\r'`).
- Traefik keeps idle backend connections 90s: Node servers behind it need `keepAliveTimeout` above that (gateway uses 95s) or you get sporadic 502s. SIGTERM: drain 10s, then `closeAllConnections()`, with `terminationGracePeriodSeconds` above that.
- Extra upstreams (fx-mcp, notes-mcp) live in `charts/upstreams`, one `<name>:` values block each, templates wrapped in `{{- if .Values.<name> }}` so `--set <name>=null` renders nothing. Image tag is `upstreams.<name>.image.tag`; add a `<NAME>_TAG` and image build/import to the Makefile or the pod sits in ImagePullBackOff. After scripted Makefile edits, check recipe lines with `cat -A` (a literal `\n` slipped in once, and a `\t` in sed `a` text became a plain `t`; recipe lines need a real tab).
- Shell polling without `sleep` (blocked in Git Bash): `read -t 1 <> <(:) || true`. The `/api/servers` status values are lowercase (`connected`, `unreachable`).
- Windows kubectl cannot read `/dev/stdin` or `/proc/self/fd/0` (`--from-file=k=/dev/stdin` fails with "error reading /proc/self/fd/0"): create Secrets with `--from-literal` like the rest of `scripts/secrets.sh`. Test script changes in a throwaway namespace (`NS=<tmp> bash scripts/secrets.sh`), then delete it.
- `scripts/dod-check.sh` (`make dod`) is the repeatable DoD check: it scales notes-mcp to 0 and disables fx while running (EXIT trap restores both), refuses a kubectl context other than `k3d-urumi` (`DOD_CONTEXT`), and uses the fixed member `dod-member@example.com` with Secret `dod-member`. Waits default to `DOD_WAIT=60`. It makes 19 MCP requests (12 on one key): keep 7c's per-key limit above that.
