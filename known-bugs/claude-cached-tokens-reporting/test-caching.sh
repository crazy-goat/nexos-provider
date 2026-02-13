#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_URL="https://api.nexos.ai/v1/chat/completions"

SYSTEM_PROMPT=$(cat "$SCRIPT_DIR/prompt_1.txt")
USER_PROMPT=$(cat "$SCRIPT_DIR/prompt_2.txt")

[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

if [ -n "${1:-}" ]; then
  MODELS=("$1")
else
  MODELS=(
    "Claude Sonnet 4.5"
    "Claude Opus 4.5"
    "Claude Opus 4.6"
  )
fi

DUMP_DIR="$SCRIPT_DIR/../../cache/claude-cached-tokens"
mkdir -p "$DUMP_DIR"

echo "=== Claude cached tokens reporting test ==="
echo ""
echo "Tests which cache-related usage fields are returned by each Claude model."
echo ""
echo "Request 1: long system prompt + user question (primes cache)"
echo "Request 2: same system prompt + different user question (should hit cache)"
echo ""
printf "   %-22s %4s %8s %6s %8s %8s %8s %8s\n" \
  "MODEL" "REQ" "PROMPT" "OUT" "CACHED" "C.WRITE" "C.READ" "TOTAL"
printf "   %-22s %4s %8s %6s %8s %8s %8s %8s\n" \
  "----------------------" "----" "--------" "------" "--------" "--------" "--------" "--------"

do_request() {
  local model="$1"
  local user_msg="$2"

  local body
  body=$(jq -n --arg m "$model" --arg s "$SYSTEM_PROMPT" --arg p "$user_msg" '{
    model: $m,
    messages: [
      {role:"system", content:[{type:"text", text:$s, cache_control:{type:"ephemeral"}}]},
      {role:"user", content:$p}
    ],
    max_tokens: 300
  }')

  curl -s --max-time 120 -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" 2>&1
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

ptd = u.get('prompt_tokens_details', {}) or {}
cached = ptd.get('cached_tokens', 0) or 0

cw = u.get('cache_creation_input_tokens')
cr = u.get('cache_read_input_tokens')

def fmt(val):
    if val is None:
        return 'N/A'
    return str(val) if val > 0 else '-'

cached_s = str(cached) if cached > 0 else '-'
cw_s = fmt(cw)
cr_s = fmt(cr)

has_cache = (cached > 0 or (cw is not None and cw > 0) or (cr is not None and cr > 0))
if has_cache:
    icon = '✅'
elif '$req_num' == '2':
    icon = '❌'
else:
    icon = '  '

print(f'{icon} {\"$model\":<22s} {\"$req_num\":>4} {pt:>8} {ct:>6} {cached_s:>8} {cw_s:>8} {cr_s:>8} {tt:>8}')
" 2>/dev/null || printf "⚠️  %-22s %4s %8s %6s %8s %8s %8s %8s\n" "$model" "$req_num" "?" "?" "?" "?" "?" "?"
}

for model in "${MODELS[@]}"; do
  slug=$(echo "$model" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')

  resp1=$(do_request "$model" "What is the difference between let and const in JavaScript?")
  echo "$resp1" > "$DUMP_DIR/${slug}-req1.json"

  if echo "$resp1" | jq -e '.error' >/dev/null 2>&1; then
    err=$(echo "$resp1" | jq -r '.error.message // "unknown error"' | head -c 50)
    printf "⚠️  %-22s %4s  %s\n" "$model" "1" "$err"
    echo ""
    continue
  fi

  print_row "$model" "$resp1" "1"

  sleep 3

  resp2=$(do_request "$model" "$USER_PROMPT")
  echo "$resp2" > "$DUMP_DIR/${slug}-req2.json"

  if echo "$resp2" | jq -e '.error' >/dev/null 2>&1; then
    err=$(echo "$resp2" | jq -r '.error.message // "unknown error"' | head -c 50)
    printf "⚠️  %-22s %4s  %s\n" "$model" "2" "$err"
    echo ""
    continue
  fi

  print_row "$model" "$resp2" "2"
  echo ""
done

echo "=== Raw usage blocks ==="
echo ""
for f in "$DUMP_DIR"/*.json; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .json)
  echo "--- $name ---"
  jq '.usage' "$f" 2>/dev/null || echo "(no usage)"
  echo ""
done

echo "=== Legend ==="
echo ""
echo "  PROMPT  = prompt_tokens"
echo "  OUT     = completion_tokens"
echo "  CACHED  = prompt_tokens_details.cached_tokens (OpenAI-style)"
echo "  C.WRITE = cache_creation_input_tokens (Anthropic-style, top-level)"
echo "  C.READ  = cache_read_input_tokens (Anthropic-style, top-level)"
echo "  TOTAL   = total_tokens"
echo ""
echo "  N/A = field absent from response"
echo "  -   = field present but zero"
echo ""
echo "  ✅ = cache activity detected"
echo "  ❌ = no cache hit on 2nd request"
echo ""
echo "  Raw responses saved to: $DUMP_DIR/"
