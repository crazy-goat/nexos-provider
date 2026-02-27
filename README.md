# nexos-provider

Custom [AI SDK](https://sdk.vercel.ai/) provider for using [nexos.ai](https://nexos.ai) models with [opencode](https://opencode.ai).

## What it does

Fixes compatibility issues when using Gemini, Claude, ChatGPT, Codex, and Codestral models through nexos.ai API in opencode:

- **Gemini**: appends missing `data: [DONE]` SSE signal (prevents hanging), inlines `$ref` in tool schemas (rejected by Vertex AI), fixes `finish_reason` for tool calls (`stop`→`tool_calls`)
- **Claude**: converts thinking params to snake_case (`budgetTokens`→`budget_tokens`), fixes `finish_reason` (`end_turn`→`stop`, prevents infinite retry loop), strips `thinking` object when disabled, adds `cache_control` markers for prompt caching
- **ChatGPT**: strips `reasoning_effort: "none"` (unsupported by the API)
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
rm -rf ~/.cache/opencode/node_modules ~/.cache/opencode/bun.lock
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

The `known-bugs/` directory contains documentation and test scripts for known API issues:

- **[token-caching](known-bugs/token-caching/)** — Gemini implicit caching does not do prefix matching (only caches identical requests). Claude and GPT prefix caching works correctly. Gemini explicit caching works but nexos.ai does not expose the `cachedContents` API.
- **[gemini3-tools](known-bugs/gemini3-tools/)** — Gemini 3 models (Flash Preview, Pro Preview) fail on multi-turn tool calling due to missing `thought_signature` support in nexos.ai API
- **[thinking](known-bugs/thinking/)** — Test script for thinking/reasoning blocks across models

## License

MIT
