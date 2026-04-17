# Claude Opus 4.7 — `temperature` breaks streaming tool calls

## Summary

Claude Opus 4.7 on nexos.ai is routed to one of two backends depending on whether the request contains `temperature`:

| Request | Backend | Streaming tool calls |
|---|---|---|
| No `temperature` | `vertex-ai` (id `vertex-ai-…`) | ✅ Works — proper `delta.tool_calls[]` deltas with `arguments` chunks, `finish_reason: "tool_calls"` |
| Any `temperature` | Guardrails-enabled backend (id is a numeric Python object id, response has `guardrails.detect_pii`, `audio_tokens`) | ❌ Broken — only empty `content` deltas, then `finish_reason: "tool_use"` with no `tool_calls`/`arguments` anywhere in the stream |

Non-streaming responses work on both backends. The bug is specific to streaming tool calls on the guardrails backend.

Only **Opus 4.7** is affected. Sonnet 4.5/4.6 and Opus 4.6 tolerate `temperature` correctly — they either don't route to the guardrails backend or that backend translates streaming properly for them.

## Reproduction

```bash
./test-temperature.sh
```

Matrix tested:

| Model | temp=no | temp=0.2 |
|---|---|---|
| Claude Sonnet 4.5 | ✅ | ✅ |
| Claude Sonnet 4.6 | ✅ vertex-ai | ✅ vertex-ai |
| Claude Opus 4.6 | ✅ vertex-ai | ✅ vertex-ai |
| Claude Opus 4.7 | ✅ vertex-ai | ❌ guardrails — no `tool_calls` in stream |

## Evidence from broken stream (with `temperature`)

```
data: {"id":"140486259591680","choices":[{"delta":{"content":""},"finish_reason":null}],"guardrails":{"validation_passed":true,"results":[{"type":"detect_pii","result":"pass"}]}}
data: {"id":"140486259591680","choices":[{"delta":{"content":""},"finish_reason":null}],"guardrails":{...}}
...  (23+ empty content deltas)
data: {"id":"140486259591680","choices":[{"delta":{"content":""},"finish_reason":"tool_use"}],"usage":{...,"prompt_tokens_details":{"audio_tokens":0,"cached_tokens":0}}}
data: [DONE]
```

The client sees: model said nothing, then claimed it used a tool — but no tool name, arguments, or id anywhere. opencode treats this as "tool not used correctly" and the run fails.

## Workaround

`fix-claude.mjs` strips `temperature` from the request body for Opus 4.7 regardless of `thinking` state. Opus 4.7 then routes to vertex-ai and streaming tool calls work normally.

## Impact

Anyone setting a custom `temperature` on Opus 4.7 (opencode's `build-heavy` agent uses `temperature: 0.1`, for example) would hit this. Without the fix, every tool-using conversation silently fails.
