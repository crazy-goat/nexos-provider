# nexos-provider

Custom [AI SDK](https://sdk.vercel.ai/) provider for using [nexos.ai](https://nexos.ai) Gemini models with [opencode](https://opencode.ai).

## Problem

When accessing Gemini models through the nexos.ai API proxy, two issues prevent them from working with opencode (and likely other AI SDK-based tools):

1. **Missing `data: [DONE]` in SSE streaming** — Gemini responses via nexos don't emit the standard `data: [DONE]` signal at the end of a streaming response. The AI SDK's `EventSourceParserStream` waits indefinitely for more data, causing opencode to hang forever.

2. **`$ref` in tool schemas** — opencode sends JSON Schemas with `$ref` / `$defs` for tool parameters. Gemini (Vertex AI) rejects these with: `Schema.ref was set alongside unsupported fields`.

## Solution

This provider wraps `@ai-sdk/openai-compatible` and intercepts `fetch` to:

- **Append `data: [DONE]\n\n`** to the end of streaming responses from Gemini models (via a `TransformStream` flush handler)
- **Inline `$ref` references** in tool parameter schemas before sending them to the API

No proxy, no extra processes — everything runs inline inside opencode.

## Setup

### 1. Clone this repo

```bash
git clone <this-repo> ~/nexos-provider
cd ~/nexos-provider
npm install
```

### 2. Set your API key

```bash
export NEXOS_API_KEY="your-nexos-api-key"
```

### 3. Configure opencode

Add the provider to your `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "nexos-gemini": {
      "npm": "file:///absolute/path/to/nexos-provider/index.mjs",
      "name": "Nexos Gemini",
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

> **Note:** The `npm` path must be an absolute `file://` URL pointing to `index.mjs`.

### 4. Use it

```bash
opencode run "hello" -m "nexos-gemini/Gemini 2.5 Pro"
```

Or select the model interactively in opencode with `Ctrl+X M`.

## GPT and Claude models

GPT and Claude models work fine through nexos.ai without this provider — they correctly emit `data: [DONE]` and handle `$ref` schemas. Use the standard `@ai-sdk/openai-compatible` provider for those:

```json
{
  "nexos-ai": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "Nexos AI",
    "env": ["NEXOS_API_KEY"],
    "options": {
      "baseURL": "https://api.nexos.ai/v1/",
      "timeout": 300000
    },
    "models": {
      "Claude Opus 4.6": {
        "name": "Claude Opus 4.6",
        "limit": { "context": 128000, "output": 64000 }
      },
      "GPT 5.2": {
        "name": "GPT 5.2",
        "limit": { "context": 128000, "output": 64000 }
      }
    }
  }
}
```

## How it works

The provider exports `createNexosAI` which creates a standard AI SDK provider with a custom `fetch` wrapper:

```
Request flow:
  opencode → createNexosAI → fetch wrapper → nexos.ai API
                                 │
                                 ├─ Resolves $ref in tool schemas (for Gemini)
                                 └─ Appends data: [DONE] to SSE stream (for Gemini)
```

Only Gemini model requests are modified — all other models pass through unchanged.

## License

MIT
