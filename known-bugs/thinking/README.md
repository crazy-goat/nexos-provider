# Thinking/Reasoning Blocks Test

Tests whether `content_blocks` with thinking/reasoning content are returned by the nexos.ai API for various models.

## Problem

Some models support "thinking" or "reasoning" modes where the model shows its internal reasoning process. The API should return this in `content_blocks` with `type: "thinking"`. However:

- **Claude Opus 4.5/4.6** — Does not return thinking blocks even with `thinking: {type: "enabled"}` enabled
- **GPT models** — Uses `reasoning_tokens` in usage stats but doesn't expose reasoning content in `content_blocks`

## Test script

Run `thinking-blocks.sh` to test thinking/reasoning across models:

```bash
./thinking-blocks.sh
```

### Columns

| Column | Description |
|--------|-------------|
| THINK | Length of thinking content in `content_blocks` (0 = not returned) |
| IN | Input/prompt tokens |
| OUT | Output/completion tokens |
| REASON | Reasoning tokens (from `usage.completion_tokens_details.reasoning_tokens`) |
| CACHED | Cached prompt tokens |
| TOTAL | Total tokens |

### Status icons

- ✅ Thinking blocks returned (`content_blocks` contains thinking content)
- ⚠️ Reasoning tokens counted but not exposed (GPT models)
- ❌ No thinking content returned despite being enabled

## Example output

```
=== Thinking blocks test (non-stream) ===

   MODEL                        THINK       IN      OUT   REASON   CACHED    TOTAL
   ------------------------- -------- -------- -------- -------- -------- --------
✅ Gemini 2.5 Pro                2030       61     1416     1366        0     2843
✅ Gemini 2.5 Flash              4441       61     1670      991        0     2722
✅ Gemini 3 Flash Preview         477       61      892      564        0     1517
✅ Gemini 3 Pro Preview           343       61     1079     1281        0     2421
✅ Claude Sonnet 4.5              383      102      893        0        0      995
❌ Claude Opus 4.5                  0      102     1376        0        0     1478
❌ Claude Opus 4.6                  0      102     1196        0        0     1298
⚠️ GPT 5                            0       67     1734     1280        0     1801
```

## Notes

- Gemini models consistently return thinking blocks
- Claude Sonnet 4.5 returns thinking blocks, but Opus 4.5/4.6 do not
- GPT 5 uses reasoning internally (1280 reasoning tokens) but doesn't expose the content
- This is a nexos.ai API behavior — the provider cannot fix missing thinking blocks
