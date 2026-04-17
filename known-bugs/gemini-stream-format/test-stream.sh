#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"
[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

if [ -n "${1:-}" ]; then
  MODELS=("$1")
else
  MODELS=(
    "Gemini 2.5 Pro"
    "Gemini 2.5 Flash"
    "Gemini 3 Flash Preview"
    "Gemini 3 Pro Preview"
  )
fi

TOOL='{"type":"function","function":{"name":"bash","description":"Run a command","parameters":{"type":"object","properties":{"cmd":{"type":"string"}},"required":["cmd"]}}}'

send_stream () {
  local model="$1"
  local mode="$2"

  local body
  if [ "$mode" = "plain" ]; then
    body=$(jq -n --arg m "$model" '{
      model: $m, stream: true,
      messages: [{role:"user",content:"Say hi in 3 words"}],
      max_tokens: 30
    }')
  elif [ "$mode" = "thinking" ]; then
    body=$(jq -n --arg m "$model" '{
      model: $m, stream: true,
      messages: [{role:"user",content:"What is 2+2? Think briefly."}],
      thinking: {type:"enabled", budget_tokens: 1000},
      max_tokens: 500
    }')
  else
    body=$(jq -n --arg m "$model" --argjson tool "$TOOL" '{
      model: $m, stream: true,
      messages: [{role:"user",content:"Run ls -la"}],
      tools: [$tool]
    }')
  fi

  curl -sS -N -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    --max-time 30 -d "$body" 2>&1
}

classify () {
  local out="$1"

  local done_flag="no"; echo "$out" | grep -q "data: \[DONE\]" && done_flag="yes"

  local finish
  finish=$(echo "$out" | grep -oE '"finish_reason":"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  finish=${finish:-none}

  local tc="no"; echo "$out" | grep -q '"tool_calls"' && tc="yes"

  local tb_nested="no"; echo "$out" | grep -q '"content_blocks"' && tb_nested="yes"

  echo "done=$done_flag finish=$finish tool_calls=$tc content_blocks=$tb_nested"
}

echo "=== Gemini raw stream check (direct to nexos.ai — no provider fix) ==="
echo ""
printf "  %-25s %-9s %-5s %-10s %-11s %s\n" "MODEL" "MODE" "DONE" "FINISH" "TOOL_CALLS" "CONTENT_BLOCKS"
printf "  %-25s %-9s %-5s %-10s %-11s %s\n" "-------------------------" "---------" "-----" "----------" "-----------" "--------------"

for model in "${MODELS[@]}"; do
  for mode in plain thinking tool; do
    out=$(send_stream "$model" "$mode")
    r=$(classify "$out")
    d=$(echo "$r" | sed -n 's/.*done=\([^ ]*\).*/\1/p')
    f=$(echo "$r" | sed -n 's/.*finish=\([^ ]*\).*/\1/p')
    tc=$(echo "$r" | sed -n 's/.*tool_calls=\([^ ]*\).*/\1/p')
    cb=$(echo "$r" | sed -n 's/.*content_blocks=\([^ ]*\).*/\1/p')

    # Expected broken behaviors:
    #   plain   : done=no, finish=STOP (uppercase)
    #   thinking: content_blocks=yes (thinking not in reasoning_content)
    #   tool    : tool_calls=yes but finish=stop (not tool_calls)

    icon="✅"
    [ "$d" = "no" ] && icon="❌"
    [ "$f" = "STOP" ] && icon="❌"
    [ "$mode" = "tool" ] && [ "$tc" = "yes" ] && [ "$f" = "stop" ] && icon="❌"
    [ "$mode" = "thinking" ] && [ "$cb" = "yes" ] && icon="❌"

    printf "%s %-25s %-9s %-5s %-10s %-11s %s\n" "$icon" "$model" "$mode" "$d" "$f" "$tc" "$cb"
  done
done

echo ""
echo "Expected broken behaviors (direct):"
echo "  - DONE=no          → appendDoneToStream appends data: [DONE]"
echo "  - FINISH=STOP      → fixGeminiStream lowercases to stop"
echo "  - tool + finish=stop → fixGeminiStream rewrites to tool_calls when tool_calls[] present"
echo "  - content_blocks   → fixGeminiStream lifts thinking → delta.reasoning_content"
