# nexos-provider

Custom [AI SDK](https://sdk.vercel.ai/) provider for using [nexos.ai](https://nexos.ai) Gemini models with [opencode](https://opencode.ai).

## What it does

Gemini models via nexos.ai have two issues that break opencode: missing `data: [DONE]` in SSE streams (causes hanging) and `$ref` in tool schemas (rejected by Vertex AI). This provider wraps `@ai-sdk/openai-compatible` and fixes both by appending the `[DONE]` signal and inlining `$ref` references before sending. Other models available through nexos.ai (GPT, Claude, etc.) are called directly without any modifications.

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
        "Gemini 3 Flash Preview": {
          "name": "Gemini 3 Flash Preview",
          "limit": { "context": 128000, "output": 64000 }
        },
        "Gemini 3 Pro Preview": {
          "name": "Gemini 3 Pro Preview",
          "limit": { "context": 128000, "output": 64000 }
        }
      }
    }
  }
}
```

> **Tip:** You can automatically generate the config with all available nexos.ai models using [opencode-nexos-models-config](https://github.com/crazy-goat/opencode-nexos-models-config).

> **Warning:** Gemini 3 models (Flash Preview, Pro Preview) are currently unavailable — tool calling through nexos.ai does not work for these models.

### 3. Use it

Simple prompt:
```bash
opencode run "hello" -m "nexos-ai/Gemini 2.5 Pro"
```

With tool calling:
```bash
opencode run "list files in current directory" -m "nexos-ai/Gemini 2.5 Pro"
```

Or select the model interactively in opencode with `Ctrl+X M`.

## How it works

The provider exports `createNexosAI` which creates a standard AI SDK provider with a custom `fetch` wrapper:

```
Gemini models:
  opencode → createNexosAI → fetch wrapper → nexos.ai API
                                 │
                                 ├─ Resolves $ref in tool schemas
                                 └─ Appends data: [DONE] to SSE stream

Other models (GPT, Claude, etc.):
  opencode → createNexosAI → fetch (no modifications) → nexos.ai API
```

The provider detects Gemini models by name and only applies fixes for them. GPT, Claude, and other models pass through the fetch wrapper unchanged — they already handle `[DONE]` signals and `$ref` schemas correctly.

## License

MIT
