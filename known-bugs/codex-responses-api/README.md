# Codex — requires /v1/responses, not /v1/chat/completions

## Summary

Codex models (`GPT 5.3 Codex` and siblings) do not work on `/v1/chat/completions`. They require OpenAI's Responses API at `/v1/responses`, which has a different request schema, different SSE event types, and different usage reporting. The provider redirects the URL and converts both directions transparently so opencode can keep talking chat-completions.

## Request conversion (`convertChatToResponsesRequest`)

- URL: `/v1/chat/completions` → `/v1/responses`
- `max_tokens` / `max_completion_tokens` → `max_output_tokens`
- `reasoning_effort` (if set and not `"none"`) → `reasoning.effort`
- System / developer messages → single `instructions` string (concatenated with `\n`)
- `messages[]` → `input[]`:
  - `user` → `{type: "message", role: "user", content}`
  - `assistant.tool_calls[]` → one `{type: "function_call", call_id, name, arguments}` per call
  - `assistant.content` → `{type: "message", role: "assistant", content}`
  - `tool` → `{type: "function_call_output", call_id, output}`
- Tools: flattened — drop the `function` wrapper, keep `type: "function"` + `name` + `description` + `parameters` at the top level.
- Pass-through for `tool_choice`, `temperature`, `top_p`, `parallel_tool_calls`.

## Stream conversion (`createResponsesStreamConverter`)

Responses API emits Anthropic-style named SSE events. Each is mapped back to a chat-completion-chunk delta:

| Upstream event | Downstream chunk |
|---|---|
| `response.output_item.added` (message) | `{delta: {role: "assistant", content: ""}}` |
| `response.output_text.delta` | `{delta: {content: <text>}}` |
| `response.output_item.added` (function_call) | `{delta: {tool_calls: [{index, id, type: "function", function: {name, arguments: ""}}]}}` |
| `response.function_call_arguments.delta` | `{delta: {tool_calls: [{index, function: {arguments: <chunk>}}]}}` |
| `response.completed` | `{finish_reason: "tool_calls" \| "stop", usage}` + final `data: [DONE]` |

Usage maps:
- `input_tokens` → `prompt_tokens`
- `output_tokens` → `completion_tokens`
- `total_tokens` → `total_tokens`
- `input_tokens_details.cached_tokens` → `prompt_tokens_details.cached_tokens`
- `output_tokens_details.reasoning_tokens` → `completion_tokens_details.reasoning_tokens`

## Impact

Without this conversion, every request to a Codex model returns 404. With it, Codex is usable from opencode unchanged — the provider handles the protocol translation, including progressive streaming, tool calls, reasoning effort, and cache token reporting.
