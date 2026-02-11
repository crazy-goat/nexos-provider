# Gemini 3 Flash/Pro Preview — function calling broken via nexos API

## Problem

Gemini 3 models (Flash Preview, Pro Preview) require `thought_signature` on every `functionCall` content block in multi-turn conversations. This is a Vertex AI requirement for all Gemini 3 models, even with thinking disabled.

The official way to pass `thought_signature` in the OpenAI-compatible API is via `extra_content.google.thought_signature` on `tool_calls` entries. However, nexos API strips `extra_content` (and any unknown fields) from `tool_calls` before forwarding to Vertex AI.

This means **function calling with Gemini 3 models is broken** — the first request works, but the follow-up request (containing the tool result) always fails with:

```
error: Unable to submit request because function call `<name>` in the 2. content block
is missing a `thought_signature`.
```

Gemini 2.5 Pro is not affected (no thought_signature requirement).

## Reproduce

### Step 1 — Get a tool call response (works)

```bash
curl -s -X POST "https://api.nexos.ai/v1/chat/completions" \
  -H "Authorization: Bearer $NEXOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Gemini 3 Flash Preview",
    "messages": [
      {"role": "user", "content": "Run ls -la in the current directory"}
    ],
    "tools": [{"type":"function","function":{"name":"bash","description":"Run a shell command","parameters":{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}}}]
  }'
```

Returns a tool call with `id` — note it down for step 2.

### Step 2 — Send tool result back (fails)

```bash
curl -s -X POST "https://api.nexos.ai/v1/chat/completions" \
  -H "Authorization: Bearer $NEXOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Gemini 3 Flash Preview",
    "messages": [
      {"role": "user", "content": "Run ls -la in the current directory"},
      {"role": "assistant", "content": null, "tool_calls": [{"id":"TOOL_CALL_ID_FROM_STEP1","type":"function","function":{"name":"bash","arguments":"{\"command\":\"ls -la\"}"}}]},
      {"role": "tool", "tool_call_id": "TOOL_CALL_ID_FROM_STEP1", "content": "total 40\ndrwxrwxr-x 3 user user 4096 Feb 8 12:16 .\n-rw-rw-r-- 1 user user 3666 Feb 8 12:14 index.mjs\n-rw-rw-r-- 1 user user 163 Feb 8 11:35 package.json"}
    ],
    "tools": [{"type":"function","function":{"name":"bash","description":"Run a shell command","parameters":{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}}}]
  }'
```

Returns 400:

```json
{"error":{"message":"error: Unable to submit request because function call `bash` in the 2. content block is missing a `thought_signature`.","type":"INVALID_ARGUMENT","param":null,"code":"400"},"provider":"vertex-ai"}
```

### Step 3 — Adding extra_content does not help (nexos strips it)

```bash
curl -s -X POST "https://api.nexos.ai/v1/chat/completions" \
  -H "Authorization: Bearer $NEXOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Gemini 3 Flash Preview",
    "messages": [
      {"role": "user", "content": "Run ls -la in the current directory"},
      {"role": "assistant", "content": null, "tool_calls": [{"id":"TOOL_CALL_ID_FROM_STEP1","type":"function","function":{"name":"bash","arguments":"{\"command\":\"ls -la\"}"},"extra_content":{"google":{"thought_signature":"skip_thought_signature_validator"}}}]},
      {"role": "tool", "tool_call_id": "TOOL_CALL_ID_FROM_STEP1", "content": "total 40\ndrwxrwxr-x 3 user user 4096 Feb 8 12:16 .\n-rw-rw-r-- 1 user user 3666 Feb 8 12:14 index.mjs\n-rw-rw-r-- 1 user user 163 Feb 8 11:35 package.json"}
    ],
    "tools": [{"type":"function","function":{"name":"bash","description":"Run a shell command","parameters":{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}}}]
  }'
```

Same 400 error — `extra_content` is stripped by nexos before reaching Vertex AI.

### Tested placements for thought_signature (all fail)

Nexos strips all non-standard fields from `tool_calls` entries (only `id`, `type`, `function` survive). The following placements were all tested and failed:

| Placement | Result |
|-----------|--------|
| `tool_calls[].thought_signature` | Stripped by nexos |
| `tool_calls[].extra_content.google.thought_signature` | Stripped by nexos |
| `tool_calls[].extra_content.thought_signature` | Stripped by nexos |
| `tool_calls[].google.thought_signature` | Stripped by nexos |
| `tool_calls[].metadata.thought_signature` | Stripped by nexos |
| `message.thought_signature` | Stripped by nexos |
| `tool_calls[].function.thought_signature` | Passed to Vertex but rejected — `thought_signature` is not a valid field inside `function_call` |
| `tool_calls[].function.google.thought_signature` | Stripped by nexos |
| `tool_calls[].function.extra_content.google.thought_signature` | Stripped by nexos |
| `tool_calls[].function.metadata.thought_signature` | Stripped by nexos |
| `tool_calls[].function.parts[].thought_signature` | Stripped by nexos |
| `tool_calls[].function.extensions.thought_signature` | Stripped by nexos |
| `tool_calls[].function.vendor_extensions.thought_signature` | Stripped by nexos |
| Inside `arguments` JSON string | Stripped by nexos |

In the native Vertex AI format, `thought_signature` is a sibling of `functionCall` at `parts[]` level. Nexos converts OpenAI format to native format but does not map any client field to `parts[].thought_signature`.

## Expected fix

Nexos API should propagate `extra_content.google.thought_signature` on `tool_calls` entries to Vertex AI, as documented in:
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures

Alternatively, nexos could inject `skip_thought_signature_validator` server-side for Gemini 3 models when the client does not provide a thought_signature.

## Reference

- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures
- Affected models: `Gemini 3 Flash Preview`, `Gemini 3 Pro Preview`
- Not affected: `Gemini 2.5 Pro`
