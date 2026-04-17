#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"
[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

MODEL="${1:-codestral-2508}"

echo "=== Codestral tool.function.strict null rejection test ==="
echo "Model: $MODEL"
echo "(sends direct to nexos.ai — no provider fix applied)"
echo ""
printf "  %-22s %s\n" "STRICT VALUE" "RESULT"
printf "  %-22s %s\n" "----------------------" "----------------------------------------"

send () {
  local label="$1"
  local tools_json="$2"

  local body
  body=$(jq -n --arg m "$MODEL" --argjson t "$tools_json" '{
    model: $m,
    messages: [{role:"user",content:"Use the tool"}],
    tools: $t,
    max_tokens: 30
  }')

  local resp
  resp=$(curl -sS -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    --max-time 30 -d "$body" 2>&1)

  if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
    local err
    err=$(echo "$resp" | jq -r '.error.message // "?"' | head -c 70)
    printf "❌ %-22s rejected: %s\n" "$label" "$err"
  else
    printf "✅ %-22s accepted\n" "$label"
  fi
}

# strict: null (the bug) — emitted by AI SDK when strict mode is unset
TOOL_NULL='[{"type":"function","function":{"name":"ping","description":"Ping","strict":null,"parameters":{"type":"object","properties":{"x":{"type":"string"}}}}}]'
send "strict: null" "$TOOL_NULL"

# strict omitted — should be accepted
TOOL_MISSING='[{"type":"function","function":{"name":"ping","description":"Ping","parameters":{"type":"object","properties":{"x":{"type":"string"}}}}}]'
send "strict: (omitted)" "$TOOL_MISSING"

# strict: false — should be accepted
TOOL_FALSE='[{"type":"function","function":{"name":"ping","description":"Ping","strict":false,"parameters":{"type":"object","properties":{"x":{"type":"string"}}}}}]'
send "strict: false" "$TOOL_FALSE"

# strict: true — should be accepted
TOOL_TRUE='[{"type":"function","function":{"name":"ping","description":"Ping","strict":true,"parameters":{"type":"object","properties":{"x":{"type":"string"}}}}}]'
send "strict: true" "$TOOL_TRUE"

echo ""
echo "Legend: strict:null rejected = bug reproduced (fixCodestralRequest coerces null → false)"
echo "        other values accepted = baseline"
