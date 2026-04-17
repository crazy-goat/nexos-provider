#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"
[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

if [ -n "${1:-}" ]; then
  MODELS=("$1")
else
  MODELS=("Kimi K2" "GLM 5")
fi

check_model () {
  local model="$1"
  local body
  body=$(python3 -c "
import json
print(json.dumps({'model':'$model','stream':True,'messages':[{'role':'user','content':'Say hi in 3 words'}],'max_tokens':30}))
")
  local out
  out=$(curl -sS -N -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    --max-time 30 -d "$body" 2>&1)

  local done_icon="❌"
  echo "$out" | grep -q "data: \[DONE\]" && done_icon="✅"
  local usage_icon="❌"
  echo "$out" | grep -q '"usage"' && usage_icon="✅"
  local chunks
  chunks=$(echo "$out" | grep -c "^data: " || true)

  printf "  %-16s [DONE]=%s  usage=%s  chunks=%s\n" "$model" "$done_icon" "$usage_icon" "$chunks"
}

echo "=== Kimi / GLM raw stream check ==="
echo "(sends direct to nexos.ai — demonstrates upstream fireworks-ai behavior)"
echo ""
printf "  %-16s %s\n" "MODEL" "RESULT"
printf "  %-16s %s\n" "----------------" "----------------------------------------"
for model in "${MODELS[@]}"; do
  check_model "$model"
done
