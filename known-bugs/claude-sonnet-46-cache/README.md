# Claude cache minimum token thresholds on nexos.ai

## Summary

Cache minimum token thresholds on nexos.ai differ from Anthropic documentation. The practical minimums through nexos.ai (vertex-ai backend) are higher than documented.

## Documented vs actual minimums

| Model | Backend | Documented minimum | Actual minimum (nexos.ai) |
|-------|---------|-------------------|---------------------------|
| Claude Sonnet 4.5 | anthropic | 1,024 | ~1,024 ✅ matches |
| Claude Sonnet 4.6 | vertex-ai | 2,048 | ~4,096+ (higher than documented) |
| Claude Opus 4.6 | vertex-ai | 4,096 | ~4,096+ ✅ matches |

## Evidence

With ~3,400 token system prompt — Sonnet 4.6 and Opus 4.6 do NOT cache:
```
   Claude Sonnet 4.5          ✅ cache_read=3402
   Claude Sonnet 4.6          ❌ cache_read=0, cache_creation=3403 on both requests
   Claude Opus 4.6            ❌ cache_read=0, no cache fields reported
```

With ~6,800 token system prompt — all models cache correctly:
```
   Claude Sonnet 4.5          ✅ cache_read=6802
   Claude Sonnet 4.6          ✅ cache_read=6803
   Claude Opus 4.6            ✅ cache_read=6803
```

## Impact

For opencode sessions with small system prompts (< 4096 tokens), Sonnet 4.6 won't cache. Typical opencode sessions have system prompts of 2000-5000 tokens — borderline for vertex-ai models.

## Test script

```bash
./test-cache.sh                    # test all Claude models
./test-cache.sh "Claude Sonnet 4.6" # test single model
```
