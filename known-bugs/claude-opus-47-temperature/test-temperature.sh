#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"

[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

MODELS=(
  "Claude Sonnet 4.5"
  "Claude Sonnet 4.6"
  "Claude Opus 4.6"
  "Claude Opus 4.7"
)

TOOL='{"type":"function","function":{"name":"bash","description":"Run a command","parameters":{"type":"object","properties":{"cmd":{"type":"string"}},"required":["cmd"]}}}'
USER_MSG='{"role":"user","content":"Run ls -la"}'

send () {
  local model="$1"
  local with_temp="$2"
  local tempfield=""
  [ "$with_temp" = "yes" ] && tempfield=',"temperature":0.2'
  local body="{\"model\":\"$model\",\"stream\":true${tempfield},\"messages\":[$USER_MSG],\"tools\":[$TOOL]}"
  curl -sS -N -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    --max-time 25 -d "$body" 2>&1
}

classify () {
  local out="$1"
  local backend="unknown"
  echo "$out" | grep -q '"provider":"vertex-ai"' && backend="vertex-ai"
  echo "$out" | grep -q '"guardrails"' && backend="guardrails"
  local tc="no"
  echo "$out" | grep -q '"tool_calls"' && tc="yes"
  local fr=""
  fr=$(echo "$out" | grep -oE '"finish_reason":"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  echo "backend=$backend tool_calls_in_stream=$tc finish_reason=$fr"
}

echo "=== Streaming tool-call behavior across Claude models ==="
printf "   %-22s %-8s %s\n" "MODEL" "TEMP" "RESULT"
printf "   %-22s %-8s %s\n" "----------------------" "--------" "----------------------------------------"

for model in "${MODELS[@]}"; do
  for with_temp in no yes; do
    out=$(send "$model" "$with_temp")
    result=$(classify "$out")
    icon="✅"
    echo "$result" | grep -q "tool_calls_in_stream=no" && icon="❌"
    printf "%s  %-22s %-8s %s\n" "$icon" "$model" "$with_temp" "$result"
  done
done
