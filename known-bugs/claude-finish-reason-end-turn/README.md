# Claude — `end_turn` finish reason causes opencode retry loop

## Summary

Claude (both Anthropic-native and vertex-ai backends) emits `finish_reason: "end_turn"` at natural conversation end. The OpenAI chat completions spec uses `stop`. opencode treats unknown finish reasons as transient errors and retries the whole request — the retry also ends with `end_turn`, and the loop never terminates.

## Workaround

`fix-claude.mjs` `fixClaudeStream()` walks each SSE chunk and rewrites `choices[].finish_reason === "end_turn"` → `stop`.

## Prerequisite: stream must be buffered by `\n\n`

SSE chunks can be split arbitrarily across TCP boundaries. A split that lands in the middle of a `{ ... "finish_reason": "end_turn" ... }` JSON body means `fixClaudeStream`'s regex never matches, and the unfixed `end_turn` reaches the client.

`appendDoneToStream()` in `index.mjs` accumulates bytes and only calls fix functions on complete `\n\n`-delimited events. Before this was added, the retry loop manifested as intermittent 2-minute client timeouts.

## Impact

Without the rewrite: every Claude conversation would retry indefinitely. Without the buffering: the rewrite works most of the time but fails unpredictably on large / slow responses.
