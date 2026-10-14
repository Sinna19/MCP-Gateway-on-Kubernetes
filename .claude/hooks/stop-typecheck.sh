#!/usr/bin/env bash
# Stop: before Claude finishes a turn, typecheck every package with changed TypeScript.
# Blocks once with the errors; never loops (stop_hook_active guard).
input=$(cat)
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

changed=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard; } | grep -E '\.(ts|tsx)$' )
[ -z "$changed" ] && exit 0

fail=0
for pkg in $(echo "$changed" | grep -oE '^(apps|services)/[^/]+' | sort -u); do
  [ -f "$pkg/tsconfig.json" ] || continue
  if ! out=$(cd "$pkg" && npx --no-install tsc --noEmit 2>&1); then
    echo "Typecheck failed in $pkg:" >&2
    echo "$out" | head -40 >&2
    fail=1
  fi
done
[ $fail -eq 1 ] && exit 2
exit 0
