# nexos-provider

Custom [AI SDK](https://sdk.vercel.ai/) provider for using [nexos.ai](https://nexos.ai) models with [opencode](https://opencode.ai).

## What it does

Fixes compatibility issues when using Gemini, Claude, ChatGPT, Codex, and Codestral models through nexos.ai API in opencode:

- **Gemini**: appends missing `data: [DONE]` SSE signal (prevents hanging), inlines `$ref` in tool schemas (rejected by Vertex AI), fixes `finish_reason` for tool calls (`stop`→`tool_calls`)
- **Claude**: converts thinking params to snake_case (`budgetTokens`→`budget_tokens`), fixes `finish_reason` (`end_turn`→`stop`, prevents infinite retry loop), strips `thinking` object when disabled, adds `cache_control` markers for prompt caching, strips `temperature` when thinking is enabled, **strips `temperature` for Opus 4.7** (nexos.ai routes Opus 4.7 requests with `temperature` to a guardrails backend where streaming tool calls are broken)
- **ChatGPT/GPT**: strips `reasoning_effort: "none"` (unsupported), strips `temperature: false` (invalid value), **strips temperature for non-Codex models** (nexos.ai chat completions only supports default temperature; Codex models via Responses API support custom temperature)
- **Codex**: transparently redirects requests to `/v1/responses` (Responses API) — Codex models don't support `/v1/chat/completions`. Handles streaming, tool calls, reasoning effort, and cache token reporting.
- **Codestral**: sets `strict: false` in tool definitions when `strict` is `null` (Mistral API rejects `null` for this field)

## Setup

### 1. Set your API key

```bash
export NEXOS_API_KEY="your-nexos-api-key"
```

### 2. Configure opencode

Add the provider to your `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "nexos-ai": {
      "npm": "@crazy-goat/nexos-provider",
      "name": "Nexos AI",
      "env": ["NEXOS_API_KEY"],
      "options": {
        "baseURL": "https://api.nexos.ai/v1/",
        "timeout": 300000
      },
      "models": {
        "Gemini 2.5 Pro": {
          "name": "Gemini 2.5 Pro",
          "limit": { "context": 128000, "output": 64000 }
        },
        "Claude Sonnet 4.5": {
          "name": "Claude Sonnet 4.5",
          "limit": { "context": 200000, "output": 16000 },
          "options": {
            "thinking": { "type": "enabled", "budgetTokens": 1024 }
          },
          "variants": {
            "thinking-high": { "thinking": { "type": "enabled", "budgetTokens": 10000 } },
            "no-thinking": { "thinking": { "type": "disabled" } }
          }
        },
        "GPT 5": {
          "name": "GPT 5",
          "limit": { "context": 400000, "output": 128000 },
          "options": { "reasoningEffort": "medium" },
          "variants": {
            "high": { "reasoningEffort": "high" },
            "no-reasoning": { "reasoningEffort": "none" }
          }
        }
      }
    }
  }
}
```

> **Tip:** You can automatically generate the config with all available nexos.ai models using [opencode-nexos-models-config](https://github.com/crazy-goat/opencode-nexos-models-config).

> **Warning:** Gemini 3 models (Flash Preview, Pro Preview) do not work with tool calling through nexos.ai — see [known-bugs/gemini3-tools](known-bugs/gemini3-tools/) for details.

### 3. Use it

Simple prompt:
```bash
opencode run "hello" -m "nexos-ai/Gemini 2.5 Pro"
```

With tool calling:
```bash
opencode run "list files in current directory" -m "nexos-ai/Gemini 2.5 Pro"
```

Claude with thinking:
```bash
opencode run "what is 2+2?" -m "nexos-ai/Claude Sonnet 4.5" --variant thinking-high
```

GPT with reasoning effort:
```bash
opencode run "what is 2+2?" -m "nexos-ai/GPT 5" --variant high
```

Or select the model interactively in opencode with `Ctrl+X M`.

## Updating

opencode caches the provider in `~/.cache/opencode/`. To force an update to the latest version:

```bash
rm -rf ~/.cache/opencode/node_modules/@crazy-goat
```

The next time you run opencode, it will download the latest version from npm.

## How it works

The provider exports `createNexosAI` which creates a standard AI SDK provider with a custom `fetch` wrapper. Per-provider fixes are in separate modules:

```
opencode → createNexosAI → fetch wrapper → nexos.ai API
                               │
                               ├─ fix-gemini.mjs: $ref inlining, finish_reason fix
                               ├─ fix-claude.mjs: thinking params, end_turn→stop
                               ├─ fix-chatgpt.mjs: strips reasoning_effort:"none"
                               ├─ fix-codex.mjs: chat completions → Responses API
                               └─ fix-codestral.mjs: strict:null→false in tools
```

## Testing

Test with a simple prompt:
```bash
opencode run "what is 2+2?" -m "nexos-ai/Gemini 2.5 Pro"
opencode run "what is 2+2?" -m "nexos-ai/Gemini 2.5 Flash"
opencode run "what is 2+2?" -m "nexos-ai/Claude Sonnet 4.5"
opencode run "what is 2+2?" -m "nexos-ai/GPT 5"
```

Test tool calling:
```bash
opencode run "list files in current directory" -m "nexos-ai/Gemini 2.5 Pro"
opencode run "list files in current directory" -m "nexos-ai/Claude Sonnet 4.5"
opencode run "list files in current directory" -m "nexos-ai/GPT 5"
opencode run "list files in current directory" -m "nexos-ai/GPT 5.3 Codex"
```

Test thinking/reasoning variants:
```bash
opencode run "what is 2+2?" -m "nexos-ai/Claude Sonnet 4.5" --variant thinking-high
opencode run "what is 2+2?" -m "nexos-ai/Gemini 2.5 Pro" --variant thinking-high
opencode run "what is 2+2?" -m "nexos-ai/GPT 5" --variant high
opencode run "what is 2+2?" -m "nexos-ai/GPT 5.3 Codex" --variant high
```

### Automated model check

Run `check-models/check-all.mjs` to test all available models for simple prompts and tool calling:

```bash
node check-models/check-all.mjs
```

Test a single model:
```bash
node check-models/check-all.mjs "GPT 4.1"
```

Results are saved to [`check-models/checks.md`](check-models/checks.md) — see current compatibility status there.

## Known Bugs

The `known-bugs/` directory documents every API quirk the provider works around, one folder per issue. Each folder has a README and, where empirical reproduction adds value, a test script.

### Claude

- **[claude-prompt-caching](known-bugs/claude-prompt-caching/)** — `cache_control` marker strategy (4 breakpoints: system, tools, latest user, previous user) + break-even math and real-session savings.
- **[claude-finish-reason-end-turn](known-bugs/claude-finish-reason-end-turn/)** — Claude emits `finish_reason: "end_turn"`; opencode expects `stop`. Without the rewrite, opencode retries indefinitely.
- **[claude-thinking-params](known-bugs/claude-thinking-params/)** — `budgetTokens` → `budget_tokens` (snake_case), strip disabled `thinking`, bump `max_tokens` when budget exceeds it, strip `temperature` while thinking is enabled.
- **[claude-opus-47-temperature](known-bugs/claude-opus-47-temperature/)** — Opus 4.7 with any `temperature` routes to a guardrails backend where streaming tool calls are broken. Provider strips `temperature` for Opus 4.7.
- **[claude-sonnet-46-cache](known-bugs/claude-sonnet-46-cache/)** — Sonnet 4.6 on vertex-ai invalidates cache when `cache_control` is on user messages; also a higher minimum token threshold than documented.
- **[claude-cached-tokens-reporting](known-bugs/claude-cached-tokens-reporting/)** — Opus models only report cache via `prompt_tokens_details.cached_tokens`; provider sums it into `prompt_tokens` for opencode's usage display.

### Gemini

- **[gemini-schema-restrictions](known-bugs/gemini-schema-restrictions/)** — Vertex AI rejects many JSON Schema keywords (`$ref`, `exclusiveMinimum`, `patternProperties`, `if/then/else`, `not`, `$schema`, etc.). Provider inlines refs and strips the rest.
- **[gemini-stream-format](known-bugs/gemini-stream-format/)** — Four stream-format issues bundled: missing `[DONE]` sentinel, uppercase `STOP`, `stop` instead of `tool_calls` for tool use, `content_blocks[].delta.thinking` instead of `reasoning_content`.
- **[gemini3-tools](known-bugs/gemini3-tools/)** — Gemini 3 / 3.1 reject multi-turn tool-use replays because nexos.ai does not propagate `thought_signature`. Provider rewrites history into plain alternating turns.

### GPT / Codex

- **[gpt-chat-completions-limits](known-bugs/gpt-chat-completions-limits/)** — nexos.ai chat completions rejects `reasoning_effort: "none"`, `temperature: false`, and custom `temperature` for non-Codex GPT models.
- **[codex-responses-api](known-bugs/codex-responses-api/)** — Codex models require `/v1/responses`, not `/v1/chat/completions`. Provider redirects the URL and converts both directions (request schema + SSE stream + usage).

### Codestral

- **[codestral-strict-null](known-bugs/codestral-strict-null/)** — Mistral API rejects `strict: null` in tool function definitions. Provider coerces `null` → `false`.

### Kimi / GLM

- **[kimi-fireworks-stream](known-bugs/kimi-fireworks-stream/)** — Kimi and GLM on fireworks-ai stream without `data: [DONE]` or `usage` chunk. Provider's `TransformStream` synthesizes both on flush while preserving progressive streaming.

### Cross-provider

- **[token-caching](known-bugs/token-caching/)** — Prefix caching matrix across Gemini / Claude / GPT. Gemini implicit caching only matches identical requests (no prefix match); explicit `cachedContents` API is not exposed by nexos.ai.
- **[thinking](known-bugs/thinking/)** — Test harness for thinking / reasoning token reporting across models.

## License

MIT
