# Token Caching — Gemini implicit caching does not do prefix matching

## Problem

Gemini models through nexos.ai (and directly via Google API) only do **implicit caching** which caches identical requests. They do NOT do prefix matching — changing only the user message invalidates the entire cache, even though the system prompt is identical.

This makes Gemini implicit caching useless for vibe coding / opencode sessions, where the system prompt stays the same but user messages change on every request.

Gemini has **explicit caching** (via `cachedContents` API) that does proper prefix-based caching, but nexos.ai does not expose this endpoint.

## Implicit vs Explicit caching (direct Google API tests)

### Implicit caching — NO prefix matching

```bash
# req1: system prompt + "What is let vs const?"
→ cachedContentTokenCount: absent

# req2 (identical to req1):
→ cachedContentTokenCount: 4075   ← only identical requests cache

# req3 (same system prompt, different user msg):
→ cachedContentTokenCount: absent ← prefix NOT matched
```

### Explicit caching — prefix matching WORKS

```bash
# Create cache via cachedContents API (322697 tokens)
POST /v1beta/cachedContents → cachedContents/ww6stm52zh6r6...

# req1: "Please summarize this transcript"
→ cachedContentTokenCount: 322697  ✅

# req2: "What were the key moments during the mission?"
→ cachedContentTokenCount: 322697  ✅  (different question, same cache)
```

Explicit caching properly reuses the cached prefix regardless of user message. But it requires a separate API call (`POST /v1beta/cachedContents`) that nexos.ai does not expose.

## Test results via nexos.ai

```
   MODEL                                          REQ#       IN      OUT  C.WRITE   C.READ    TOTAL
   --------------------------------------------- ----- -------- -------- -------- -------- --------
   anthropic.claude-haiku-4-5@20251001               1       17      300        -        -     6077
✅ anthropic.claude-haiku-4-5@20251001               2       60      300        -     5760     6120

   Claude Sonnet 4.5                                 1       17      300     5760        -     6077
✅ Claude Sonnet 4.5                                 2       60      300        -     5760     6120

   Claude Opus 4.5                                   1       17      300        -        -     6077
✅ Claude Opus 4.5                                   2       60      300        -     5760     6120

   Claude Opus 4.6                                   1       17      300        -        -     6078
✅ Claude Opus 4.6                                   2       60      300        -     5761     6121

✅ GPT 5                                             1     4986      300        -     3200     5286
✅ GPT 5                                             2     5023      300        -     4992     5323

   GPT 5.2                                           1     4986      276        -        -     5262
✅ GPT 5.2                                           2     5023      286        -     4864     5309

   Gemini 2.5 Pro                                    1     5247      296        -        -     5543
❌ Gemini 2.5 Pro                                    2     5290      296        -        -     5586

   Gemini 2.5 Flash                                  1     5247      296        -        -     5543
❌ Gemini 2.5 Flash                                  2     5290      296        -        -     5586

   Gemini 3 Flash Preview                            1     5247      296        -        -     5543
❌ Gemini 3 Flash Preview                            2     5290      296        -        -     5586

   Gemini 3 Pro Preview                              1     5247      296        -        -     5543
❌ Gemini 3 Pro Preview                              2     5290      296        -        -     5586
```

Request 1 and 2 use the same system prompt (~5000 tokens) but different user messages. Claude and GPT cache the shared prefix. Gemini does not.

## Column legend

| Column | Description |
|--------|-------------|
| IN | `prompt_tokens` — uncached input tokens |
| OUT | `completion_tokens` |
| C.WRITE | `cache_creation_input_tokens` — tokens written to cache (1st request) |
| C.READ | `cached_tokens` / `cache_read_input_tokens` — tokens read from cache (2nd request) |
| TOTAL | `total_tokens` |

## How each provider handles caching

| Provider | Caching type | Prefix matching | Mechanism |
|----------|-------------|----------------|-----------|
| Claude | Explicit markers | Yes | `cache_control: {"type": "ephemeral"}` in message content parts. Provider adds via `fixClaudeCacheControl()` |
| GPT | Automatic | Yes | Auto prefix caching (min 1024 tokens), no config needed |
| Gemini (implicit) | Automatic | **No** | Only caches identical requests. Changing user message = cache miss |
| Gemini (explicit) | Manual API | Yes | Requires `POST /cachedContents` + `cachedContent` field in request. Not available through nexos |

## Cache minimum token requirements

| Provider | Model | Min tokens |
|----------|-------|-----------|
| Anthropic | Claude Opus 4.5, 4.6 | 4096 |
| Anthropic | Claude Sonnet 4.5 | 1024 |
| Anthropic | Claude Haiku 4.5 | 4096 |
| OpenAI | GPT 5, 5.2 | 1024 |
| Google | Gemini (all) | 2048 |

## Root cause

Gemini has two caching systems:
1. **Implicit caching** — automatic, no configuration. Only caches identical request prefixes (byte-for-byte match). Enabled by default on all Gemini 2.5/3 models. This is what nexos uses.
2. **Explicit caching** — requires creating a named cache via `POST /v1beta/cachedContents`, then referencing it with `"cachedContent": "cachedContents/..."` in generateContent requests. This does proper prefix-based caching where different user messages reuse the cached content.

Claude and GPT do prefix-based caching natively — the system prompt is cached and reused regardless of what the user message is. Gemini's implicit caching does NOT work this way.

## Impact

For a typical opencode session (50+ requests, ~5000 token system prompt + tools):
- **Claude/GPT**: System prompt cached after first request. ~90% (Claude) / ~50% (GPT) cost reduction on cached tokens.
- **Gemini**: No caching benefit, since every request has a different user message. Full price for all prompt tokens on every request.

## Reproduce

```bash
# Test all models via nexos
./test-caching.sh

# Test single model
./test-caching.sh "Gemini 2.5 Pro"
```

## Possible fix

nexos.ai could:
1. **Auto-create explicit caches** — When a system prompt exceeds 2048 tokens, automatically create a `cachedContents` entry and reference it in subsequent requests. This would give Gemini the same prefix-caching behavior as Claude/GPT.
2. **Expose `cachedContents` API** — Allow users to create and manage explicit caches through the OpenAI-compatible API.
3. **Improve implicit caching** — Work with Google to enable prefix matching for implicit caching (not just identical request matching).

Alternatively, the provider could be extended to use `@ai-sdk/google` (native Gemini provider) instead of `@ai-sdk/openai-compatible` for Gemini models, which would allow using explicit caching via `cachedContent` option. However, this would require significant changes to the provider architecture.

## Reference

- Vertex AI context caching overview: https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview
- Vertex AI implicit caching: min 2048 tokens, 90% discount, automatic on all Gemini 2.5/3 models
- Vertex AI explicit caching: requires `cachedContents` API, supports prefix-based reuse
- Anthropic prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- OpenAI prompt caching: https://platform.openai.com/docs/guides/prompt-caching
