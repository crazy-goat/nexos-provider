#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"

[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

SYSTEM_PROMPT=$(python3 -c "print('You are an expert software engineer specializing in TypeScript React Node and cloud architecture. ' * 400)")

if [ -n "${1:-}" ]; then
  MODELS=("$1")
else
  MODELS=(
    "Claude Sonnet 4.5"
    "Claude Sonnet 4.6"
    "Claude Opus 4.6"
  )
fi

echo "=== Claude prompt cache read test ==="
echo ""
echo "Request 1: long system prompt + question (primes cache)"
echo "Request 2: same system prompt + different question (should hit cache)"
echo ""
printf "   %-22s %5s %8s %8s %8s %8s %8s\n" \
  "MODEL" "REQ" "PROMPT" "C.WRITE" "C.READ" "COMPL" "TOTAL"
printf "   %-22s %5s %8s %8s %8s %8s %8s\n" \
  "----------------------" "-----" "--------" "--------" "--------" "--------" "--------"

do_request() {
  local model="$1"
  local user_msg="$2"

  curl -s --max-time 60 -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$model" --arg s "$SYSTEM_PROMPT" --arg p "$user_msg" '{
      model: $m,
      messages: [
        {role:"system", content:[{type:"text", text:$s, cache_control:{type:"ephemeral"}}]},
        {role:"user", content:$p}
      ],
      max_tokens: 20
    }')" 2>&1
}

print_row() {
  local model="$1"
  local resp="$2"
  local req_num="$3"

  echo "$resp" | python3 -c "
import sys, json

d = json.loads(sys.stdin.read())
u = d.get('usage', {})

pt = u.get('prompt_tokens', 0)
ct = u.get('completion_tokens', 0)
tt = u.get('total_tokens', 0)
cw = u.get('cache_creation_input_tokens', 0) or 0
cr = u.get('cache_read_input_tokens', 0) or 0

if not cr:
    cr = (u.get('prompt_tokens_details') or {}).get('cached_tokens', 0) or 0

if cr > 0:
    icon = '✅'
elif '$req_num' == '2':
    icon = '❌'
else:
    icon = '  '

def fmt(v):
    return str(v) if v > 0 else '-'

print(f'{icon} {\"$model\":<22s} {\"$req_num\":>5} {fmt(pt):>8} {fmt(cw):>8} {fmt(cr):>8} {fmt(ct):>8} {fmt(tt):>8}')
" 2>/dev/null || printf "⚠️  %-22s %5s %8s\n" "$model" "$req_num" "parse error"
}

for model in "${MODELS[@]}"; do
  resp1=$(do_request "$model" "What is the difference between let and const in JavaScript?")

  if echo "$resp1" | jq -e '.error' >/dev/null 2>&1; then
    err=$(echo "$resp1" | jq -r '.error.message // "unknown"' | head -c 50)
    printf "⚠️  %-22s %5s  %s\n" "$model" "1" "$err"
    echo ""
    continue
  fi

  print_row "$model" "$resp1" "1"
  sleep 3

  resp2=$(do_request "$model" "Explain async/await in TypeScript.")

  if echo "$resp2" | jq -e '.error' >/dev/null 2>&1; then
    err=$(echo "$resp2" | jq -r '.error.message // "unknown"' | head -c 50)
    printf "⚠️  %-22s %5s  %s\n" "$model" "2" "$err"
    echo ""
    continue
  fi

  print_row "$model" "$resp2" "2"
  echo ""
done
