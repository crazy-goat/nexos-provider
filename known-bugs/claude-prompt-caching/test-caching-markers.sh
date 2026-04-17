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
    "Claude Opus 4.7"
  )
fi

echo "=== Claude cache_control marker requirement test ==="
echo ""
echo "Sends TWO requests per model: (1) with cache_control marker on system, (2) without."
echo "Both requests use the SAME long system prompt — expected: cache hit on re-run,"
echo "only when marker is present. Without marker, Anthropic never caches."
echo ""
printf "   %-22s %-12s %8s %8s %8s %8s\n" \
  "MODEL" "MARKER" "PROMPT" "C.WRITE" "C.READ" "TOTAL"
printf "   %-22s %-12s %8s %8s %8s %8s\n" \
  "----------------------" "------------" "--------" "--------" "--------" "--------"

do_request() {
  local model="$1"
  local with_marker="$2"

  local body
  if [ "$with_marker" = "yes" ]; then
    body=$(jq -n --arg m "$model" --arg s "$SYSTEM_PROMPT" '{
      model: $m,
      messages: [
        {role:"system", content:[{type:"text", text:$s, cache_control:{type:"ephemeral"}}]},
        {role:"user", content:"What is 2 + 2?"}
      ],
      max_tokens: 20
    }')
  else
    body=$(jq -n --arg m "$model" --arg s "$SYSTEM_PROMPT" '{
      model: $m,
      messages: [
        {role:"system", content:$s},
        {role:"user", content:"What is 2 + 2?"}
      ],
      max_tokens: 20
    }')
  fi

  curl -s --max-time 60 -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" 2>&1
}

print_row() {
  local model="$1"
  local resp="$2"
  local marker="$3"

  echo "$resp" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
u = d.get('usage', {})
pt = u.get('prompt_tokens', 0)
tt = u.get('total_tokens', 0)
cw = u.get('cache_creation_input_tokens', 0) or 0
cr = u.get('cache_read_input_tokens', 0) or 0
if not cr:
    cr = (u.get('prompt_tokens_details') or {}).get('cached_tokens', 0) or 0

def fmt(v): return str(v) if v > 0 else '-'

if '$marker' == 'with-marker':
    icon = '✅' if (cw > 0 or cr > 0) else '❌'
else:
    icon = '✅' if (cw == 0 and cr == 0) else '⚠️'

print(f'{icon} {\"$model\":<22s} {\"$marker\":<12s} {fmt(pt):>8} {fmt(cw):>8} {fmt(cr):>8} {fmt(tt):>8}')
" 2>/dev/null || printf "⚠️  %-22s %-12s parse error\n" "$model" "$marker"
}

for model in "${MODELS[@]}"; do
  resp_a=$(do_request "$model" "yes")
  if echo "$resp_a" | jq -e '.error' >/dev/null 2>&1; then
    err=$(echo "$resp_a" | jq -r '.error.message // "unknown"' | head -c 50)
    printf "⚠️  %-22s %-12s %s\n" "$model" "with-marker" "$err"
  else
    print_row "$model" "$resp_a" "with-marker"
  fi
  sleep 2

  resp_b=$(do_request "$model" "no")
  if echo "$resp_b" | jq -e '.error' >/dev/null 2>&1; then
    err=$(echo "$resp_b" | jq -r '.error.message // "unknown"' | head -c 50)
    printf "⚠️  %-22s %-12s %s\n" "$model" "no-marker" "$err"
  else
    print_row "$model" "$resp_b" "no-marker"
  fi
  echo ""
done

echo "=== Legend ==="
echo ""
echo "  with-marker: expect cache activity (C.WRITE or C.READ > 0)"
echo "  no-marker:   expect zero cache fields (Anthropic ignores caching without marker)"
echo ""
echo "  ✅ matches expectation    ❌/⚠️  unexpected"
