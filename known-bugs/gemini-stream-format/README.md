# Gemini — stream format differences from OpenAI chat completions

## Summary

Gemini / Vertex AI streaming through nexos.ai does not emit OpenAI-chat-completions-compatible SSE. Four separate issues bundled here because they all live in stream processing and have the same root cause (Vertex AI's native event shape leaking through the translation layer).

## Issues

1. **Missing `data: [DONE]` sentinel** — the upstream stream simply ends, without the OpenAI-mandated `data: [DONE]` line. Clients wait indefinitely for the close signal and hit the 2-minute network timeout.
2. **Uppercase `finish_reason: "STOP"`** — emitted when thinking is enabled. opencode only recognizes the lowercase `stop` value and retries on anything else.
3. **`finish_reason: "stop"` for tool calls** — when the model actually invokes a tool, the stream contains `delta.tool_calls[]` but `finish_reason` is `stop` (not `tool_calls`). opencode then treats the assistant response as a final answer and never executes the tools.
4. **`content_blocks[].delta.thinking`** — thinking tokens arrive in an unrecognized shape instead of the standard `reasoning_content` field, so opencode's thinking display stays empty.

## Workaround

- `appendDoneToStream()` in `index.mjs` — buffers SSE events by `\n\n` boundaries, passes them through `fixGeminiStream`, and appends `data: [DONE]\n\n` in the stream's flush step.
- `fixGeminiStream()` in `fix-gemini.mjs`:
  - Rewrites `STOP` → `stop` on every chunk.
  - When `finish_reason === "stop"` but `delta.tool_calls[]` is non-empty, rewrites to `tool_calls`.
  - Extracts `content_blocks[].delta.thinking` → `delta.reasoning_content`, then deletes `content_blocks` from the delta.

## Impact

Without these fixes: (1) client hangs 2 minutes before failing, (2) opencode retries on unknown finish reason, (3) tool invocations silently dropped, (4) thinking panel stays blank.
