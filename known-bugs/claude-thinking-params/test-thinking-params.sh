#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"
[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

MODEL="${1:-Claude Sonnet 4.6}"

echo "=== Claude thinking-params schema mismatch test ==="
echo "Model: $MODEL"
echo "(sends direct to nexos.ai — no provider fix applied; each case should 400)"
echo ""
printf "  %-32s %s\n" "CASE" "RESULT"
printf "  %-32s %s\n" "--------------------------------" "----------------------------------------"

send () {
  local name="$1"
  local body="$2"

  local resp
  resp=$(curl -sS -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    --max-time 30 -d "$body" 2>&1)

  if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
    local err
    err=$(echo "$resp" | jq -r '.error.message // "?"' | head -c 70)
    printf "❌ %-32s rejected: %s\n" "$name" "$err"
  else
    local fr
    fr=$(echo "$resp" | jq -r '.choices[0].finish_reason // "?"')
    printf "✅ %-32s accepted (finish=%s)\n" "$name" "$fr"
  fi
}

# Case 1: camelCase budgetTokens (AI SDK form — Anthropic needs snake_case)
body1=$(jq -n --arg m "$MODEL" '{
  model: $m,
  messages: [{role:"user",content:"Hi"}],
  thinking: {type:"enabled", budgetTokens: 2000},
  max_tokens: 4000
}')
send "camelCase budgetTokens" "$body1"

# Case 2 (historical): thinking type "disabled" — verified 2026-04-17 that upstream
# now accepts it on all Claude models. Provider no longer strips it; kept as pass-through.
body2=$(jq -n --arg m "$MODEL" '{
  model: $m,
  messages: [{role:"user",content:"Hi"}],
  thinking: {type:"disabled"},
  max_tokens: 30
}')
send "thinking type=disabled (historical — upstream now accepts)" "$body2"

# Case 3: max_tokens <= budget_tokens (Anthropic requires strict >)
body3=$(jq -n --arg m "$MODEL" '{
  model: $m,
  messages: [{role:"user",content:"Hi"}],
  thinking: {type:"enabled", budget_tokens: 2000},
  max_tokens: 2000
}')
send "max_tokens == budget_tokens" "$body3"

# Case 4: custom temperature with thinking enabled
body4=$(jq -n --arg m "$MODEL" '{
  model: $m,
  messages: [{role:"user",content:"Hi"}],
  thinking: {type:"enabled", budget_tokens: 2000},
  max_tokens: 4000,
  temperature: 0.2
}')
send "temperature + thinking" "$body4"

echo ""
echo "Legend: ❌ rejected = bug reproduced (fixClaudeRequest rewrites/strips all four)"
echo "        ✅ accepted = upstream behavior changed — re-check workaround relevance"
