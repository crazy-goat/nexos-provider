# Claude — non-OpenAI `finish_reason` values leak in thinking mode

## Summary

When a Claude stream runs with **thinking enabled**, upstream leaks Anthropic-native `finish_reason` values that aren't in the OpenAI chat completions spec:

- `end_turn` — natural conversation end (should be `stop`)
- `tool_use` — model invoked a tool (should be `tool_calls`)

AI SDK maps unknown `finish_reason` values to `"other"`, which opencode interprets as a transient error and retries. The retry also ends with the same leaked value, so the loop never terminates.

Without thinking, nexos.ai (vertex-ai layer) already rewrites to `stop` / `tool_calls` upstream — the bug is specifically tied to the thinking flow.

## Reproduction map

Confirmed identical across all 5 current Claude models on nexos.ai (Sonnet 4.5, Sonnet 4.6, Opus 4.6, Opus 4.7, Haiku 4.5):

| Scenario | `finish_reason` (raw) |
|---|---|
| plain stream | `stop` ✅ |
| stream + thinking | **`end_turn` ❌** |
| stream + tool (no thinking, turn 1) | `tool_calls` ✅ |
| stream + tool + thinking | **`tool_use` ❌** |
| post-tool_result (no thinking) | `stop` ✅ |
| post-tool_result + thinking | **`end_turn` ❌** |

Any opencode session on a Claude model with the `/high` or `/low` variant triggers this in every turn.

## Workaround

`fix-claude.mjs` `fixClaudeStream()` walks each SSE chunk and rewrites:

- `choices[].finish_reason === "end_turn"` → `"stop"`
- `choices[].finish_reason === "tool_use"` → `"tool_calls"`

## Prerequisite: stream must be buffered by `\n\n`

SSE chunks can be split arbitrarily across TCP boundaries. A split landing in the middle of a `{ ... "finish_reason": "end_turn" ... }` JSON body means `fixClaudeStream`'s regex never matches, and the unfixed value reaches the client.

`appendDoneToStream()` in `index.mjs` accumulates bytes and only calls fix functions on complete `\n\n`-delimited events. Before this was added, the retry loop manifested as intermittent 2-minute client timeouts.

## Impact

Without the rewrites: every thinking-mode conversation on every Claude model would retry indefinitely. Without the buffering: the rewrites work most of the time but fail unpredictably on large / slow responses.
