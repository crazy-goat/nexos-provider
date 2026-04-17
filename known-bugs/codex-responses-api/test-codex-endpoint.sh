#!/usr/bin/env bash
set -euo pipefail

BASE="https://api.nexos.ai"
[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

MODEL="${1:-GPT 5.3 Codex}"

echo "=== Codex endpoint routing test ==="
echo "Model: $MODEL"
echo "(sends direct to nexos.ai — no provider fix applied)"
echo ""
printf "  %-28s %s\n" "ENDPOINT" "RESULT"
printf "  %-28s %s\n" "----------------------------" "----------------------------------------"

# 1. /v1/chat/completions should 404 / error for Codex
body_chat=$(jq -n --arg m "$MODEL" '{
  model: $m,
  messages: [{role:"user",content:"Say hi in 3 words"}],
  max_tokens: 20
}')

resp_chat=$(curl -sS -X POST "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $NEXOS_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 30 -d "$body_chat" 2>&1)

if echo "$resp_chat" | jq -e '.error' >/dev/null 2>&1; then
  err=$(echo "$resp_chat" | jq -r '.error.message // "?"' | head -c 70)
  printf "❌ %-28s rejected: %s\n" "/v1/chat/completions" "$err"
else
  printf "⚠️  %-28s accepted — upstream changed\n" "/v1/chat/completions"
fi

# 2. /v1/responses should accept the Codex request in Responses-API shape
body_resp=$(jq -n --arg m "$MODEL" '{
  model: $m,
  input: [{type:"message", role:"user", content:"Say hi in 3 words"}],
  max_output_tokens: 20
}')

resp_resp=$(curl -sS -X POST "$BASE/v1/responses" \
  -H "Authorization: Bearer $NEXOS_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 30 -d "$body_resp" 2>&1)

if echo "$resp_resp" | jq -e '.error' >/dev/null 2>&1; then
  err=$(echo "$resp_resp" | jq -r '.error.message // "?"' | head -c 70)
  printf "❌ %-28s rejected: %s\n" "/v1/responses" "$err"
else
  status=$(echo "$resp_resp" | jq -r '.status // .object // "ok"')
  printf "✅ %-28s accepted (status=%s)\n" "/v1/responses" "$status"
fi

echo ""
echo "Legend: chat rejected + responses accepted = bug reproduced"
echo "        provider redirects URL and translates request/stream shapes transparently"
