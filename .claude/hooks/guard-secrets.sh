#!/usr/bin/env bash
# PreToolUse (Write|Edit|MultiEdit): block writes that contain literal secrets.
# The assignment forbids hardcoded secrets; credentials must live in Kubernetes Secrets.
input=$(cat)
path=$(jq -r '.tool_input.file_path // ""' <<<"$input")
text=$(jq -r '[.tool_input.content, .tool_input.new_string, (.tool_input.edits // [] | .[].new_string)] | map(select(. != null)) | join("\n")' <<<"$input")

# Docs may show placeholder examples; allow them.
case "$path" in *.md) exit 0 ;; esac

patterns=(
  'sk-[A-Za-z0-9_-]{20,}'                 # OpenAI-style keys
  'gsk_[A-Za-z0-9]{20,}'                  # Groq
  'AIza[0-9A-Za-z_-]{35}'                 # Google
  'sk-ant-[A-Za-z0-9_-]{20,}'             # Anthropic
  'ghp_[A-Za-z0-9]{36}'                   # GitHub
  'c[ks]_[a-f0-9]{40}'                    # WooCommerce consumer key/secret
  'umk_[A-Za-z0-9_-]{24,}'                # our own gateway API keys
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  '([Pp]assword|PASSWORD|[Ss]ecret|SECRET|[Aa]pi[_-]?[Kk]ey|API_KEY|[Tt]oken|TOKEN)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'${}<>[:space:]]{12,}["'"'"']'
)
for p in "${patterns[@]}"; do
  if grep -Eq -- "$p" <<<"$text"; then
    echo "Blocked: $path looks like it contains a literal secret (pattern: $p)." >&2
    echo "Put the value in a Kubernetes Secret (created by a script or existingSecret) and reference it via env/secretKeyRef. Use obvious placeholders like CHANGE_ME in examples." >&2
    exit 2
  fi
done
exit 0
