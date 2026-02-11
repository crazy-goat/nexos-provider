#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"

PROMPT="You are a math tutor. A student asks you to prove that the square root of 2 is irrational. Walk through the classic proof by contradiction step by step. First explain the setup, then the assumption, then derive the contradiction, and finally state the conclusion. Be thorough and explain each logical step."

[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

MODELS=(
  "Gemini 2.5 Pro"
  "Gemini 2.5 Flash"
  "Gemini 3 Flash Preview"
  "Gemini 3 Pro Preview"
  "Claude Sonnet 4.5"
  "Claude Opus 4.5"
  "Claude Opus 4.6"
  "GPT 5"
)

echo "=== Thinking blocks test (non-stream) ==="
echo ""
printf "   %-25s %8s %8s %8s %8s %8s %8s\n" \
  "MODEL" "THINK" "IN" "OUT" "REASON" "CACHED" "TOTAL"
printf "   %-25s %8s %8s %8s %8s %8s %8s\n" \
  "-------------------------" "--------" "--------" "--------" "--------" "--------" "--------"

for model in "${MODELS[@]}"; do
  if echo "$model" | grep -qi gpt; then
    body=$(jq -n --arg m "$model" --arg p "$PROMPT" '{
      model: $m, messages: [{role:"user",content:$p}],
      reasoning_effort: "high", max_tokens: 4000
    }')
  else
    body=$(jq -n --arg m "$model" --arg p "$PROMPT" '{
      model: $m, messages: [{role:"user",content:$p}],
      thinking: {type:"enabled",budget_tokens:2000}, max_tokens: 4000
    }')
  fi

  resp=$(curl -s --max-time 90 -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" 2>&1)

  if echo "$resp" | grep -q '"error"'; then
    err=$(echo "$resp" | python3 -c "import sys,json;print(json.loads(sys.stdin.read()).get('error',{}).get('message','?')[:50])" 2>/dev/null || echo "?")
    printf "⚠️  %-25s ERROR: %s\n" "$model" "$err"
    continue
  fi

  echo "$resp" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read())
m='$model'
blocks=d.get('choices',[{}])[0].get('message',{}).get('content_blocks',[])
tb=[b for b in blocks if b.get('type')=='thinking']
tlen=len(tb[0].get('thinking','')) if tb else 0
u=d.get('usage',{})
pt=u.get('prompt_tokens',0)
ct=u.get('completion_tokens',0)
tt=u.get('total_tokens',0)
cached=u.get('prompt_tokens_details',{}).get('cached_tokens',0)
rtok=(u.get('completion_tokens_details',{}).get('reasoning_tokens',0)) or 0
icon='✅' if tlen>0 else '⚠️' if rtok>0 else '❌'
print(f'{icon} {m:<25s} {tlen:>8} {pt:>8} {ct:>8} {rtok:>8} {cached:>8} {tt:>8}')
" 2>/dev/null || printf "⚠️  %-25s parse error\n" "$model"

done
