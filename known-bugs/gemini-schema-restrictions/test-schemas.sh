#!/usr/bin/env bash
set -euo pipefail

API_URL="https://api.nexos.ai/v1/chat/completions"
[ -z "${NEXOS_API_KEY:-}" ] && echo "ERROR: NEXOS_API_KEY not set" && exit 1

MODEL="${1:-Gemini 2.5 Pro}"

send_tool () {
  local name="$1"
  local params_json="$2"
  local body
  body=$(python3 -c "
import json, sys
body = {
  'model': '$MODEL',
  'messages': [{'role': 'user', 'content': 'test'}],
  'tools': [{'type': 'function', 'function': {'name': 'test_fn', 'description': 'Test', 'parameters': json.loads('''$params_json''')}}],
  'max_tokens': 10
}
print(json.dumps(body))
")
  local resp
  resp=$(curl -sS -X POST "$API_URL" \
    -H "Authorization: Bearer $NEXOS_API_KEY" \
    -H "Content-Type: application/json" \
    --max-time 25 -d "$body" 2>&1)
  if echo "$resp" | grep -q '"error"'; then
    local err
    err=$(echo "$resp" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['error']['message'][:80])" 2>/dev/null || echo "?")
    printf "❌  %-22s %s\n" "$name" "$err"
  else
    printf "✅  %-22s accepted\n" "$name"
  fi
}

echo "=== Gemini tool-schema keyword rejection test ==="
echo "Model: $MODEL"
echo "(sends direct to nexos.ai — no provider fix applied)"
echo ""

send_tool "baseline"           '{"type":"object","properties":{"x":{"type":"string"}}}'
send_tool "\$ref"              '{"type":"object","properties":{"x":{"$ref":"#/$defs/X"}},"$defs":{"X":{"type":"string"}}}'
send_tool "exclusiveMinimum"   '{"type":"object","properties":{"x":{"type":"integer","exclusiveMinimum":0}}}'
send_tool "patternProperties"  '{"type":"object","patternProperties":{"^a":{"type":"string"}}}'
send_tool "if/then"            '{"type":"object","properties":{"x":{"type":"string"}},"if":{"properties":{"x":{"const":"a"}}},"then":{"required":["x"]}}'
send_tool "not"                '{"type":"object","properties":{"x":{"not":{"type":"null"}}}}'
send_tool "\$schema"           '{"type":"object","$schema":"http://json-schema.org/draft-07/schema#","properties":{"x":{"type":"string"}}}'
send_tool "contentMediaType"   '{"type":"object","properties":{"x":{"type":"string","contentMediaType":"text/plain"}}}'
