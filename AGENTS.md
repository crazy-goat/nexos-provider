# nexos-provider

Custom AI SDK provider wrapping `@ai-sdk/openai-compatible` for nexos.ai Gemini models in opencode.

## Project Structure

- `index.mjs` — Main provider module, exports `createNexosAI`
- `package.json` — Dependencies (pinned `@ai-sdk/openai-compatible@1.0.32`)
- `README.md` — User-facing documentation

## What This Provider Does

Fixes two issues when using Gemini models through nexos.ai API:

1. **Missing `data: [DONE]` in SSE streaming** — Gemini responses via nexos don't emit the `[DONE]` signal. The provider appends it via a `TransformStream` flush handler.
2. **`$ref` in tool schemas** — Gemini (Vertex AI) rejects JSON Schemas with `$ref`/`$defs`. The provider inlines all `$ref` references before sending.

Only Gemini model requests are modified — GPT/Claude pass through unchanged.

## Architecture

```
opencode → createNexosAI() → custom fetch wrapper → nexos.ai API
                                    │
                                    ├─ resolveRefs(): inlines $ref in tool schemas
                                    └─ appendDoneToStream(): adds data: [DONE]\n\n via TransformStream
```

The provider is loaded by opencode via `file://` path in `opencode.json`:
```json
"npm": "file:///absolute/path/to/index.mjs"
```

## Key Technical Details

- The `@ai-sdk/openai-compatible` version MUST match what opencode bundles (currently `1.0.32`). Mismatched versions cause `mode.type` errors in `getArgs`.
- opencode discovers the provider by finding the first export starting with `create` and calling it with `{ name, ...options }`.
- The `env` field in the opencode provider config maps environment variable names for API key resolution. For nexos.ai use `["NEXOS_API_KEY"]`.
- `isGeminiModel()` checks are case-insensitive against the model name string.

## Code Style

- Pure ESM (`"type": "module"`)
- No comments in code
- No TypeScript — plain `.mjs` for simplicity and direct `file://` import compatibility
- Functional style, no classes
- Keep everything in a single file unless there's a strong reason to split

## When Making Changes

- Test with all three Gemini models: `Gemini 2.5 Pro`, `Gemini 3 Flash Preview`, `Gemini 3 Pro Preview`
- Test both simple prompts (`what is 2+2?`) and tool-use prompts (`list files in current directory`)
- Test command: `opencode run "what is 2+2?" -m "nexos-gemini/Gemini 2.5 Pro"`
- If upgrading `@ai-sdk/openai-compatible`, check the bundled version in opencode first: `strings ~/.opencode/bin/opencode | grep 'openai-compatible@'`
