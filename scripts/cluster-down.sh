#!/usr/bin/env bash
# Delete the local k3d cluster "urumi".
set -euo pipefail
k3d cluster delete urumi
