#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_URL="https://api.nexos.ai/v1/chat/completions"

SYSTEM_PROMPT=$(cat "$SCRIPT_DIR/prompt_1.txt")
USER_PROMPT=$(cat "$SCRIPT_DIR/prompt_2.txt")

[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

if [ -n "${1:-}" ]; then
  ALL_MODELS=("$1")
else
  ALL_MODELS=(
    "anthropic.claude-haiku-4-5@20251001"
    "Claude Sonnet 4.5"
    "Claude Opus 4.5"
    "Claude Opus 4.6"
    "GPT 5"
    "GPT 5.2"
    "Gemini 2.5 Pro"
    "Gemini 2.5 Flash"
    "Gemini 3 Flash Preview"
    "Gemini 3 Pro Preview"
  )
fi

echo "=== Token caching test (vibe coding simulation) ==="
echo ""
echo "Request 1: system prompt + user question (primes cache)"
echo "Request 2: same system prompt + different user question (should hit cache)"
echo ""
echo "System prompt: prompt_1.txt"
echo "User prompt:   prompt_2.txt"
echo ""
echo "Min cacheable: Opus=4096, Sonnet=1024, GPT=1024, Gemini=2048"
echo ""
printf "   %-45s %5s %8s %8s %8s %8s %8s\n" \
  "MODEL" "REQ#" "IN" "OUT" "C.WRITE" "C.READ" "TOTAL"
printf "   %-45s %5s %8s %8s %8s %8s %8s\n" \
  "---------------------------------------------" "-----" "--------" "--------" "--------" "--------" "--------"

print_result() {
  local model="$1"
  local resp="$2"
  local req_num="$3"

  echo "$resp" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read())
m='$model'
rn='$req_num'
u=d.get('usage',{})
pt=u.get('prompt_tokens',0)
ct=u.get('completion_tokens',0)
tt=u.get('total_tokens',0)

ptd=u.get('prompt_tokens_details',{}) or {}
cached_read=ptd.get('cached_tokens',0) or 0
if not cached_read:
    cached_read=u.get('cache_read_input_tokens',0) or 0

cache_write=u.get('cache_creation_input_tokens',0) or 0

if cached_read>0:
    icon='✅'
elif rn=='2':
    icon='❌'
else:
    icon='  '

cw_str=str(cache_write) if cache_write>0 else '-'
cr_str=str(cached_read) if cached_read>0 else '-'

print(f'{icon} {m:<45s} {rn:>5} {pt:>8} {ct:>8} {cw_str:>8} {cr_str:>8} {tt:>8}')
" 2>/dev/null || printf "⚠️  %-45s %5s %8s %8s %8s %8s %8s\n" "$model" "$req_num" "-" "-" "-" "-" "-"
}

do_request() {
  local body="$1"
  curl -s --max-time 90 -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" 2>&1
}

check_error() {
  local resp="$1"
  local model="$2"
  local req_num="$3"
  if echo "$resp" | grep -q '"error"'; then
    local err
    err=$(echo "$resp" | python3 -c "import sys,json;print(json.loads(sys.stdin.read()).get('error',{}).get('message','?')[:40])" 2>/dev/null || echo "?")
    printf "⚠️  %-45s %5s %8s %8s %8s %8s %8s  %s\n" "$model" "$req_num" "-" "-" "-" "-" "-" "$err"
    return 1
  fi
  return 0
}

build_body() {
  local model="$1"
  local prompt="$2"

  if echo "$model" | grep -qi claude; then
    jq -n --arg m "$model" --arg s "$SYSTEM_PROMPT" --arg p "$prompt" '{
      model: $m,
      messages: [
        {role:"system", content:[{type:"text", text:$s, cache_control:{type:"ephemeral"}}]},
        {role:"user", content:$p}
      ],
      max_tokens: 300
    }'
  else
    jq -n --arg m "$model" --arg s "$SYSTEM_PROMPT" --arg p "$prompt" '{
      model: $m,
      messages: [{role:"system",content:$s},{role:"user",content:$p}],
      max_tokens: 300
    }'
  fi
}

for model in "${ALL_MODELS[@]}"; do
  body1=$(build_body "$model" "What is the difference between let and const in JavaScript?")

  resp1=$(do_request "$body1")
  if check_error "$resp1" "$model" "1"; then
    print_result "$model" "$resp1" "1"
  fi || true

  sleep 3

  body2=$(build_body "$model" "$USER_PROMPT")

  resp2=$(do_request "$body2")
  if check_error "$resp2" "$model" "2"; then
    print_result "$model" "$resp2" "2"
  fi || true

  echo ""
done

echo "=== Legend ==="
echo ""
echo "  IN      = prompt tokens (uncached input)"
echo "  OUT     = completion tokens"
echo "  C.WRITE = cache_creation_input_tokens (tokens written to cache on 1st request)"
echo "  C.READ  = cached_tokens / cache_read_input_tokens (tokens read from cache on 2nd request)"
echo "  TOTAL   = total tokens"
echo ""
echo "  ✅ = cache hit    ❌ = no cache hit on 2nd request"
