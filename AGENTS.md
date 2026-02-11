# nexos-provider

Custom AI SDK provider wrapping `@ai-sdk/openai-compatible` for nexos.ai models (Gemini, Claude, ChatGPT) in opencode.

## Project Structure

- `index.mjs` — Main provider module, exports `createNexosAI`, imports per-provider fix modules
- `fix-gemini.mjs` — Gemini-specific fixes (tool schema `$ref` inlining, `STOP`/`stop`→`tool_calls` finish reason, thinking params)
- `fix-claude.mjs` — Claude-specific fixes (thinking params normalization, `end_turn`→`stop` finish reason)
- `fix-chatgpt.mjs` — ChatGPT-specific fixes (strips reasoning_effort:"none")
- `fix-codestral.mjs` — Codestral-specific fixes (strips `strict: null` from tool definitions)
- `package.json` — Dependencies (pinned `@ai-sdk/openai-compatible@1.0.32`)
- `README.md` — User-facing documentation
- `test-thinking/` — Test configuration and debug proxy for thinking/reasoning testing
- `cache/` — Test output directory (gitignored)

## What This Provider Does

Fixes issues when using models through nexos.ai API:

### Gemini
1. **Missing `data: [DONE]` in SSE streaming** — Gemini responses via nexos don't emit the `[DONE]` signal. The provider appends it via a `TransformStream` flush handler.
2. **`$ref` in tool schemas** — Gemini (Vertex AI) rejects JSON Schemas with `$ref`/`$defs`. The provider inlines all `$ref` references before sending.
3. **Wrong `finish_reason` for tool calls** — Gemini returns `stop` instead of `tool_calls` when tool calls are present. The provider fixes this in the SSE stream.
4. **`finish_reason: "STOP"` (uppercase)** — With thinking enabled, Gemini returns `STOP` instead of `stop`. The provider normalizes it to lowercase.
5. **`budgetTokens` → `budget_tokens`** — Same as Claude: opencode sends camelCase, API expects snake_case. The provider converts automatically.
6. **`type: "disabled"` thinking removal** — Same as Claude: strips the entire `thinking` object when `type === "disabled"`.
7. **Gemini 3 models + tool use** — Gemini 3 Preview models require `thought_signature` for multi-turn tool-use conversations. This is a nexos/Vertex AI limitation, not fixable in the provider. Tool use with Gemini 3 models does NOT work.
8. **Gemini 2.5 Flash budget limit** — Flash model has a lower thinking budget limit (24576) than Pro (32000+). Configure `budgetTokens` accordingly in `opencode.json`.

### Claude
1. **`finish_reason: "end_turn"`** — Claude with thinking enabled returns `end_turn` instead of `stop`. opencode doesn't recognize this and enters an infinite retry loop. The provider rewrites it to `stop`.
2. **`budgetTokens` → `budget_tokens`** — opencode sends thinking params in camelCase but the API expects snake_case. The provider converts automatically.
3. **`type: "disabled"` with leftover `budgetTokens`** — When a variant disables thinking, opencode merges the variant config with the default, leaving `budgetTokens` in the request. The API rejects this. The provider strips the entire `thinking` object when `type === "disabled"`.

### ChatGPT
1. **`reasoning_effort: "none"` unsupported** — The API rejects `"none"` as a value for `reasoning_effort` (supported: `minimal`, `low`, `medium`, `high`). opencode sends `"none"` when the `no-reasoning` variant is selected. The provider strips the `reasoning_effort` field entirely, which disables reasoning.

### Codestral
1. **`strict: null` in tool definitions** — AI SDK / nexos.ai adds `strict: null` to tool function definitions. Mistral API rejects `null` for this field (expects boolean or absent). The provider sets `strict` to `false` when it's `null` or `undefined` (nexos.ai re-adds `strict: null` if the field is absent, so deletion doesn't work).

## Architecture

```
opencode → createNexosAI() → custom fetch wrapper → nexos.ai API
                                    │
                                    ├─ fix-gemini.mjs
                                    │   ├─ fixGeminiRequest(): inlines $ref in tool schemas
                                    │   ├─ fixGeminiThinkingRequest(): thinking params (camelCase→snake_case, disabled removal)
                                    │   └─ fixGeminiStream(): STOP→stop, stop→tool_calls finish reason
                                    │
                                    ├─ fix-claude.mjs
                                    │   ├─ fixClaudeRequest(): thinking params (camelCase→snake_case, disabled removal)
                                    │   └─ fixClaudeStream(): end_turn→stop finish reason
                                    │
                    ├─ fix-chatgpt.mjs
                    │   ├─ fixChatGPTRequest(): strips reasoning_effort:"none"
                    │   └─ fixChatGPTStream(): passthrough
                                    │
                                    ├─ fix-codestral.mjs
                                    │   ├─ fixCodestralRequest(): sets strict:false when strict is null/undefined in tool definitions
                                    │   └─ fixCodestralStream(): passthrough
                                    │
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
- Stream fixing (`TransformStream` piping) is applied for Gemini models AND any model with `thinking` params.
- The `hadThinking` flag tracks whether the original request had `thinking` — needed because `fixClaudeRequest` may remove it (when disabled), but body still needs to be re-serialized.

## Code Style

- Pure ESM (`"type": "module"`)
- No comments in code
- No TypeScript — plain `.mjs` for simplicity and direct `file://` import compatibility
- Functional style, no classes
- Per-provider fixes in separate files (`fix-*.mjs`), composed in `index.mjs`

## Variant Naming Convention

- Thinking/reasoning variants MUST be named exactly `low` and `high` — never `thinking-low`, `thinking-high`, etc.
- Do NOT add `no-thinking` or `no-reasoning` variants — opencode adds these automatically.
- For ChatGPT models, reasoning effort variants are also named `low` and `high`.

## When Making Changes

- Test with all Gemini models: `Gemini 2.5 Pro`, `Gemini 2.5 Flash`, `Gemini 3 Flash Preview`, `Gemini 3 Pro Preview`
- Test Claude models with thinking variants: `Claude Sonnet 4.5`, `Claude Opus 4.5`
- Test ChatGPT models with reasoning effort: `GPT 5`, `GPT 5.2`, `GPT 4.1`
- Test Codestral models with tool use: `codestral-2508`
- Test both simple prompts (`what is 2+2?`) and tool-use prompts (`list files in current directory`)
- Test command: `opencode run "what is 2+2?" -m "nexos-ai/Gemini 2.5 Pro"`
- Claude thinking test: `opencode run "what is 2+2?" -m "nexos-ai/Claude Sonnet 4.5" --variant thinking-high`
- Gemini thinking test: `opencode run "what is 2+2?" -m "nexos-ai/Gemini 2.5 Pro" --variant thinking-high`
- Use `test-thinking/` directory with its `opencode.json` for thinking/reasoning tests
- Use `test-thinking/debug-proxy.mjs` to inspect request/response bodies (change `baseURL` to `http://localhost:9999/v1/`)
- Automated Claude thinking test: `bash cache/test-claude-thinking.sh`
- If upgrading `@ai-sdk/openai-compatible`, check the bundled version in opencode first: `strings ~/.opencode/bin/opencode | grep 'openai-compatible@'`
