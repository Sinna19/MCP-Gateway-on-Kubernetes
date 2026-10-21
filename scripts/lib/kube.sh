#!/usr/bin/env bash
# Picks the cluster and refuses anything else. Source it; do not run it.
# KUBE_CONTEXT must be k3d-* (local) or urumi-vps (the VPS, ADR 024). Default k3d-urumi.
# After sourcing, every kubectl and helm call in the script carries an explicit context, so the
# default context of the kubeconfig is never used. Needs KUBECONFIG set for urumi-vps (the Makefile does).

KUBE_CONTEXT="${KUBE_CONTEXT:-k3d-urumi}"
case "$KUBE_CONTEXT" in
  k3d-* | urumi-vps) ;;
  *) echo "refusing KUBE_CONTEXT='$KUBE_CONTEXT': only k3d-* and urumi-vps are allowed" >&2; exit 1 ;;
esac
if ! command kubectl config get-contexts -o name | tr -d '\r' | grep -qx -- "$KUBE_CONTEXT"; then
  echo "refusing: kube context '$KUBE_CONTEXT' not found in the loaded kubeconfig" >&2
  exit 1
fi

kubectl() { command kubectl --context "$KUBE_CONTEXT" "$@"; }
helm() { command helm --kube-context "$KUBE_CONTEXT" "$@"; }
