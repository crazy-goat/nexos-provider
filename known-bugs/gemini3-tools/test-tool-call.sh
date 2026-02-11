#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"

[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

MODELS=(
  "Gemini 2.5 Pro"
  "Gemini 2.5 Flash"
  "Gemini 3 Flash Preview"
  "Gemini 3 Pro Preview"
)

echo "=== Multi-turn tool calling test ==="
echo ""
printf "   %-25s %10s %10s %s\n" \
  "MODEL" "STEP1" "STEP2" "NOTES"
printf "   %-25s %10s %10s %s\n" \
  "-------------------------" "----------" "----------" "------------------------------"

for model in "${MODELS[@]}"; do
  body1=$(jq -n --arg m "$model" '{
    model: $m,
    messages: [{role:"user",content:"Run ls -la"}],
    tools: [{type:"function",function:{name:"bash",description:"Run a command",parameters:{type:"object",properties:{cmd:{type:"string"}},required:["cmd"]}}}]
  }')

  resp1=$(curl -s --max-time 30 -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body1" 2>&1)

  if echo "$resp1" | grep -q '"error"'; then
    err=$(echo "$resp1" | python3 -c "import sys,json;print(json.loads(sys.stdin.read()).get('error',{}).get('message','?')[:40])" 2>/dev/null || echo "?")
    printf "❌ %-25s %10s %10s %s\n" "$model" "ERROR" "-" "$err"
    continue
  fi

  tcid=$(echo "$resp1" | jq -r '.choices[0].message.tool_calls[0].id // empty')
  if [ -z "$tcid" ]; then
    printf "❌ %-25s %10s %10s %s\n" "$model" "NO_TC" "-" "no tool_call returned"
    continue
  fi

  body2=$(jq -n --arg m "$model" --arg tcid "$tcid" '{
    model: $m,
    messages: [
      {role:"user",content:"Run ls -la"},
      {role:"assistant",content:null,tool_calls:[{id:$tcid,type:"function",function:{name:"bash",arguments:"{\"cmd\":\"ls -la\"}"}}]},
      {role:"tool",tool_call_id:$tcid,content:"file1.txt\nfile2.txt"}
    ],
    tools: [{type:"function",function:{name:"bash",description:"Run a command",parameters:{type:"object",properties:{cmd:{type:"string"}},required:["cmd"]}}}]
  }')

  resp2=$(curl -s --max-time 30 -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body2" 2>&1)

  if echo "$resp2" | grep -q '"error"'; then
    err=$(echo "$resp2" | python3 -c "import sys,json;print(json.loads(sys.stdin.read()).get('error',{}).get('message','?')[:60])" 2>/dev/null || echo "?")
    printf "⚠️  %-25s %10s %10s %s\n" "$model" "OK" "ERROR" "$err"
    continue
  fi

  content=$(echo "$resp2" | jq -r '.choices[0].message.content // empty')
  if [ -n "$content" ]; then
    printf "✅ %-25s %10s %10s %s\n" "$model" "OK" "OK" ""
  else
    printf "⚠️  %-25s %10s %10s %s\n" "$model" "OK" "NO_RESP" "empty response"
  fi

done
