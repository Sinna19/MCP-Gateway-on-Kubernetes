#!/usr/bin/env bash
# Create the local k3d cluster "urumi" with Traefik on host ports 80/443. Safe to re-run.
set -euo pipefail

if k3d cluster list -o json | grep -q '"name": *"urumi"'; then
  echo "cluster urumi already exists"
else
  k3d cluster create urumi -p "80:80@loadbalancer" -p "443:443@loadbalancer" --wait
fi
kubectl config use-context k3d-urumi >/dev/null
kubectl get nodes -o name
