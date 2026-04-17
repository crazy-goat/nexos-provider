#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"
[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

echo "=== GPT chat completions restriction tests ==="
echo "(sends direct to nexos.ai — no provider fix applied)"
echo ""

send () {
  local label="$1"
  local body="$2"

  local resp
  resp=$(curl -sS -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    --max-time 30 -d "$body" 2>&1)

  if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
    local err
    err=$(echo "$resp" | jq -r '.error.message // "?"' | head -c 70)
    printf "❌ %-40s rejected: %s\n" "$label" "$err"
  else
    printf "✅ %-40s accepted\n" "$label"
  fi
}

# --- Issue 1: reasoning_effort:"none" — split by model family ---
echo "--- Issue 1: reasoning_effort:\"none\" ---"
echo "(legacy/chat/instant/oss reject; modern GPT 5 reasoning models accept)"
echo ""

LEGACY_MODELS=("GPT 4.1" "GPT 4o" "GPT 5.2 Chat" "GPT 5.3 Instant" "gpt-oss-120b")
MODERN_MODELS=("GPT 5" "GPT 5.2" "GPT 5.4" "GPT 5.4 mini")

for m in "${LEGACY_MODELS[@]}"; do
  body=$(jq -n --arg m "$m" '{model:$m, messages:[{role:"user",content:"hi"}], reasoning_effort:"none", max_tokens:5}')
  send "legacy: $m  reasoning_effort=none" "$body"
done
echo ""

for m in "${MODERN_MODELS[@]}"; do
  body=$(jq -n --arg m "$m" '{model:$m, messages:[{role:"user",content:"hi"}], reasoning_effort:"none", max_tokens:5}')
  send "modern: $m  reasoning_effort=none" "$body"
done

echo ""
echo "--- Issue 2: temperature:false ---"
body=$(jq -n '{model:"GPT 5", messages:[{role:"user",content:"hi"}], temperature:false, max_tokens:20}')
send "GPT 5  temperature=false" "$body"

echo ""
echo "--- Issue 3: custom numeric temperature ---"
body=$(jq -n '{model:"GPT 5", messages:[{role:"user",content:"hi"}], temperature:0.5, max_tokens:20}')
send "GPT 5  temperature=0.5" "$body"

echo ""
echo "=== Legend ==="
echo "Issue 1: legacy rejected / modern accepted → bug reproduced"
echo "         → fixChatGPTRequest strips reasoning_effort=none ONLY for legacy models"
echo "           (isLegacyChatGPTModel: GPT 4.x, 'Chat', 'Instant', 'oss' families)"
echo "Issue 2: temperature=false rejected → fixChatGPTRequest strips it"
echo "Issue 3: custom temperature rejected → fixChatGPTTemperature strips it"
