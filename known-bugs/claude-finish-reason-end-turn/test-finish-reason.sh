#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"
[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

if [ -n "${1:-}" ]; then
  MODELS=("$1")
else
  MODELS=(
    "Claude Sonnet 4.5"
    "Claude Sonnet 4.6"
    "Claude Opus 4.6"
    "Claude Opus 4.7"
    "anthropic.claude-haiku-4-5@20251001"
  )
fi

TOOL='{"type":"function","function":{"name":"bash","description":"Run","parameters":{"type":"object","properties":{"cmd":{"type":"string"}},"required":["cmd"]}}}'

check () {
  local label="$1" body="$2" expected="$3"
  local out
  out=$(curl -sS -N -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" -H "Content-Type: application/json" \
    --max-time 40 -d "$body" 2>&1)

  local fr
  fr=$(echo "$out" | grep -oE '"finish_reason":"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  fr=${fr:-none}

  local icon
  if [ "$fr" = "$expected" ]; then
    icon="❌"  # matches bug expectation
  elif [ "$fr" = "stop" ] || [ "$fr" = "tool_calls" ]; then
    icon="✅"
  else
    icon="⚠️"
  fi

  printf "%s %-38s finish_reason=%s\n" "$icon" "$label" "$fr"
}

echo "=== Claude finish_reason leak in thinking mode ==="
echo "(sends direct to nexos.ai — demonstrates end_turn / tool_use leaks that fixClaudeStream rewrites)"
echo ""

for model in "${MODELS[@]}"; do
  echo "--- $model ---"

  body=$(jq -n --arg m "$model" '{model:$m, stream:true, messages:[{role:"user",content:"Say hi"}], max_tokens:30}')
  check "plain stream" "$body" "end_turn"

  body=$(jq -n --arg m "$model" '{model:$m, stream:true, messages:[{role:"user",content:"What is 2+2?"}], thinking:{type:"enabled",budget_tokens:1024}, max_tokens:2000}')
  check "stream + thinking" "$body" "end_turn"

  body=$(jq -n --arg m "$model" --argjson t "$TOOL" '{model:$m, stream:true, messages:[{role:"user",content:"Run ls"}], tools:[$t], thinking:{type:"enabled",budget_tokens:1024}, max_tokens:2000}')
  check "stream + tool + thinking" "$body" "tool_use"

  body=$(jq -n --arg m "$model" --argjson t "$TOOL" '{
    model:$m, stream:true,
    messages:[
      {role:"user",content:"Run ls"},
      {role:"assistant",content:null,tool_calls:[{id:"call_1",type:"function",function:{name:"bash",arguments:"{\"cmd\":\"ls\"}"}}]},
      {role:"tool",tool_call_id:"call_1",content:"a\nb"}
    ],
    tools:[$t], thinking:{type:"enabled",budget_tokens:1024}, max_tokens:2000
  }')
  check "post-tool + thinking" "$body" "end_turn"

  echo ""
done

echo "Legend:"
echo "  ❌ = matches expected leak (bug reproduced; fixClaudeStream rewrites)"
echo "  ✅ = stop / tool_calls (upstream or provider already handled)"
echo "  ⚠️  = unexpected value — investigate"
