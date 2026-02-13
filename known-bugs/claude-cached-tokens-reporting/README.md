# Claude — inconsistent cached tokens reporting across models

## Problem

Claude models through the nexos.ai API report cached tokens differently depending on the model:

**Sonnet 4.5** — returns all fields:
```json
{
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 50,
    "total_tokens": 5820,
    "prompt_tokens_details": { "cached_tokens": 0 },
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 5760
  }
}
```

**Opus 4.5 / 4.6** — missing Anthropic-style fields:
```json
{
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 50,
    "total_tokens": 5820,
    "prompt_tokens_details": { "cached_tokens": 5760 }
  }
}
```

**Issues**:
1. Opus models do not return `cache_read_input_tokens` or `cache_creation_input_tokens` (Anthropic-style top-level fields)
2. Opus reports cache reads via `prompt_tokens_details.cached_tokens` only
3. On first request (cache creation), Opus has no way to report that tokens were written to cache — `cache_creation_input_tokens` is absent and `prompt_tokens_details.cached_tokens` is 0
4. `total_tokens` includes cached tokens but the client cannot verify this without the detailed breakdown

## Test script

Run `test-caching.sh` to test cached tokens reporting across Claude models:

```bash
./test-caching.sh
```

Output shows which fields are present (`-` = present but zero, `N/A` = field absent):

```
=== Claude cached tokens reporting test ===

   MODEL                       REQ   PROMPT      OUT  C.WRITE   C.READ  PTD.CAC    TOTAL
   ------------------------- ----- -------- -------- -------- -------- -------- --------
✅ Claude Sonnet 4.5             1       15      300     5760        -        -     6075
✅ Claude Sonnet 4.5             2       60      300        -     5760     5760     6120

❌ Claude Opus 4.5               1       15      300      N/A      N/A        -     6075
✅ Claude Opus 4.5               2       60      300      N/A      N/A     5760     6120

❌ Claude Opus 4.6               1       15      300      N/A      N/A        -     6076
✅ Claude Opus 4.6               2       60      300      N/A      N/A     5761     6121
```

## Column legend

| Column | Description |
|--------|-------------|
| PROMPT | `prompt_tokens` — uncached input tokens |
| OUT | `completion_tokens` |
| C.WRITE | `cache_creation_input_tokens` — tokens written to cache (Anthropic-style, top-level) |
| C.READ | `cache_read_input_tokens` — tokens read from cache (Anthropic-style, top-level) |
| PTD.CAC | `prompt_tokens_details.cached_tokens` — cached tokens (OpenAI-style) |
| TOTAL | `total_tokens` |

## Notes

- Sonnet returns both Anthropic-style (`cache_read_input_tokens`, `cache_creation_input_tokens`) and OpenAI-style (`prompt_tokens_details.cached_tokens`) fields
- Opus only returns OpenAI-style `prompt_tokens_details.cached_tokens` — Anthropic-style fields are completely absent
- On cache creation (first request), Opus has no field indicating tokens were cached — `cache_creation_input_tokens` is missing and `prompt_tokens_details.cached_tokens` is 0
- `total_tokens` appears correct for all models (includes cached tokens), but for Opus the client cannot verify the breakdown on cache creation requests
- This is a nexos.ai API inconsistency across Claude model variants
