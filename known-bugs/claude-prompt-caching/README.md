# Claude — prompt caching via `cache_control` markers

## Summary

Anthropic requires explicit `cache_control: {"type": "ephemeral"}` markers on content blocks to enable prefix caching. opencode sends plain string messages without markers, so without intervention no caching would happen — every turn would bill at full input price.

The provider injects markers at up to four positions per request and strips them on models where they misbehave.

## Strategy (`fixClaudeCacheControl`)

| Position | Purpose |
|---|---|
| Last `system` message | Caches system prompt (rarely changes across turns). |
| Last tool definition | Caches tool schemas (rarely change). |
| Last non-assistant message (latest user or tool_result) | Creates the main sliding cache covering conversation history. |
| Previous non-assistant message | Secondary breakpoint — provides an additional cache entry at a shorter prefix (defensive, cheap: Anthropic charges tokens once regardless of the marker count). |

Sonnet 4.6 skips the two user-message breakpoints — vertex-ai invalidates cache when `cache_control` appears on user turns for that model. See `claude-sonnet-46-cache/` for details.

## Economics (nexos.ai vertex-ai EU)

| | Input | Cache write | Cache read |
|---|---|---|---|
| Price ratio | 1.00× | 1.25× | 0.10× |

**Break-even: one reuse.** If a cached prefix is read exactly once on a subsequent turn, cost already beats "no cache" (`1.25 + 0.1` vs `2.0`).

### Typical opencode tool-heavy session

20 tool calls, roughly 220k total input across turns:

| Strategy | Effective cost |
|---|---|
| No cache | 220k × input |
| With markers | ~30k × cache_write + ~190k × cache_read ≈ 32% of "no cache" |

Empirically verified in stream mode for Opus 4.7 on vertex-ai: both same and different user messages produce 100% cache hits on the system prefix.

## Usage reporting fix

`fixClaudeStream()` also sums `usage.prompt_tokens_details.cached_tokens` into `usage.prompt_tokens` in each SSE chunk, because Opus reports the two separately while opencode expects a combined `prompt_tokens` for cost display. See `claude-cached-tokens-reporting/`.

## Impact

Without this strategy: ~3× higher cost on typical multi-turn tool-calling workloads, and the usage display under-reports input tokens on Opus models.
