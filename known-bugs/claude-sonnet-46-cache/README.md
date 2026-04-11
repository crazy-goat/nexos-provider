# Claude Sonnet 4.6 — prompt cache read always 0

## Problem

Claude Sonnet 4.6 through nexos.ai never reads from prompt cache. Every request creates a new cache (`cache_creation_input_tokens > 0`) but never reads it (`cache_read_input_tokens: 0`).

Other Claude models cache correctly:
- Claude Sonnet 4.5 (backend: `anthropic`) — cache works
- Claude Opus 4.6 (backend: `vertex-ai`) — cache works
- Claude Sonnet 4.6 (backend: `vertex-ai`) — **cache read broken**

## Evidence

Same system prompt (~3400 tokens), two sequential requests with 3s delay:

```
Claude Sonnet 4.5 (anthropic):
  req1: cache_creation=3402, cache_read=0
  req2: cache_creation=0,    cache_read=3402  ✅

Claude Sonnet 4.6 (vertex-ai):
  req1: cache_creation=3403, cache_read=0
  req2: cache_creation=3403, cache_read=0     ❌

Claude Opus 4.6 (vertex-ai):
  req1: cache_creation=3403, cache_read=0
  req2: cache_creation=10,   cache_read=3403  ✅
```

## What was tested

- `cache_control: {"type": "ephemeral"}` on system message content ✓
- Top-level `cache_control` on request body — no effect
- `anthropic-beta: prompt-caching-2024-07-31` header — no effect
- `anthropic-beta: token-counting-2025-02-19` header — no effect
- `prompt_cache_key` field (from Responses API) — ignored on chat completions
- Prompts above 4096 tokens (minimum for Opus, Sonnet 4.6 minimum is 2048) — no effect
- Streaming vs non-streaming — same result
- Responses API (`/v1/responses`) — "Model not supported by this endpoint"

## Root cause

Sonnet 4.6 is routed through `vertex-ai` backend (visible in response `"provider": "vertex-ai"`). Opus 4.6 uses the same backend and caches correctly. The issue is specific to Sonnet 4.6 on vertex-ai.

## Impact

Every Sonnet 4.6 request pays full price for all input tokens. For a typical opencode session with ~5000 token system prompt + tools, this means ~90% cost savings are lost compared to Sonnet 4.5 or Opus 4.6.

## Workaround

Use Claude Sonnet 4.5 or Claude Opus 4.6 for cache-sensitive workloads.
