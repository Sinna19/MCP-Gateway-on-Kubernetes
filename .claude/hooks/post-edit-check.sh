#!/usr/bin/env bash
# PostToolUse (Write|Edit|MultiEdit): fast feedback after each edit.
#  - charts/**: helm lint the chart that owns the file
#  - *.ts/*.tsx: prettier format in place (if installed)
input=$(cat)
path=$(jq -r '.tool_input.file_path // ""' <<<"$input")
[ -z "$path" ] && exit 0

case "$path" in
  */charts/*)
    command -v helm >/dev/null || exit 0
    dir=$(dirname "$path")
    while [ "$dir" != "/" ] && [ ! -f "$dir/Chart.yaml" ]; do dir=$(dirname "$dir"); done
    [ -f "$dir/Chart.yaml" ] || exit 0
    if ! out=$(helm lint "$dir" 2>&1); then
      echo "helm lint failed for $dir:" >&2
      echo "$out" | tail -30 >&2
      exit 2
    fi
    ;;
  *.ts|*.tsx)
    root="$CLAUDE_PROJECT_DIR"
    [ -x "$root/node_modules/.bin/prettier" ] && "$root/node_modules/.bin/prettier" --write "$path" >/dev/null 2>&1
    ;;
esac
exit 0
