#!/usr/bin/env bash
# Side-loads our locally built images into the VPS containerd (ADR 024): no registry, no pull secret.
# Needs IMAGES="name:tag ..." (the Makefile passes the five current tags). Skips tags already on the node.
set -euo pipefail

SSH_HOST="${SSH_HOST:-azureuser@20.197.63.44}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/urumi-vps}"
ssh_node() { ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "$@"; }

present="$(ssh_node 'sudo k3s ctr -n k8s.io images ls -q' | tr -d '\r')"
missing=()
for img in $IMAGES; do
  if grep -qx "docker.io/$img" <<<"$present"; then
    echo "skip $img: already on the node"
  else
    missing+=("$img")
  fi
done

if [ "${#missing[@]}" -eq 0 ]; then
  echo "push-images: nothing to push"
  exit 0
fi

echo "pushing: ${missing[*]}"
# One docker save for all missing images, so shared layers are sent once.
docker save "${missing[@]}" | gzip | ssh_node 'gunzip | sudo k3s ctr -n k8s.io images import -' | tail -n 10
