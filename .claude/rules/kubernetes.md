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
