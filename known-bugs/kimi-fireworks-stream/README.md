# Kimi / GLM — fireworks-ai stream missing `[DONE]` and `usage` chunks

## Summary

Kimi (e.g. `Kimi K2`) and GLM (e.g. `GLM 5`) models on nexos.ai route to fireworks-ai. The upstream SSE stream terminates without emitting two OpenAI-standard artifacts that opencode relies on:

1. `data: [DONE]` sentinel — clients wait indefinitely for the end-of-stream signal and hit the 2-minute network timeout.
2. Final `usage` chunk — opencode shows "0 tokens" in its cost display for otherwise-successful responses.

## Workaround

`fix-kimi.mjs` `createKimiStreamTransform()` wraps the upstream stream in a `TransformStream` that buffers by `\n\n` event boundaries. It tracks whether it has seen `[DONE]` and `usage` during passthrough. On flush:

- If no `usage` chunk was seen but at least one data chunk had an `id`, emits a synthetic zero-token usage chunk (`prompt_tokens: 0, completion_tokens: 0, total_tokens: 0`) reusing that `id` / `created` / `model`.
- If no `[DONE]` was seen, emits `data: [DONE]\n\n`.

The wrapper also preserves progressive streaming — chunks flow through `\n\n`-delimited as they arrive, not buffered to end.

Applied to every model matched by `isKimiModel` (currently `kimi*` and `glm*`).

## Reproduction

`./test-stream.sh` sends a short streaming completion directly to nexos.ai for each model and checks whether the raw response contains `data: [DONE]` and a `usage` chunk.

## Impact

Without the fix: responses hang until client timeout, and token usage is never reported — opencode's cost tracking is silently broken for these models.

## History

1.9.1 used full-stream buffering (accumulate all chunks, then emit at end) as a workaround for `flush()` being called multiple times by the older AI SDK. 1.10.0 upgraded `@ai-sdk/openai-compatible` to 2.0.37, and 1.12.0 replaced the full-buffer approach with the progressive `TransformStream` so chunks stream to the client as they arrive.
