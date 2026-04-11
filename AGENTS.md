# nexos-provider

Custom AI SDK provider wrapping `@ai-sdk/openai-compatible` for nexos.ai models (Gemini, Claude, ChatGPT, Codex, Kimi, GLM) in opencode.

## Project Structure

- `index.mjs` — Main provider module, exports `createNexosAI`, imports per-provider fix modules
- `fix-gemini.mjs` — Gemini-specific fixes (tool schema `$ref` inlining, unsupported JSON Schema keyword stripping, `STOP`/`stop`→`tool_calls` finish reason, thinking params)
- `fix-claude.mjs` — Claude-specific fixes (prompt caching via `cache_control`, thinking params normalization, `end_turn`→`stop` finish reason, prompt_tokens += cached_tokens). Note: `fixClaudeRequest` only runs for Claude models (not globally) to avoid stripping temperature from non-Claude models with thinking.
- `fix-chatgpt.mjs` — ChatGPT-specific fixes (strips reasoning_effort:"none")
- `fix-codestral.mjs` — Codestral-specific fixes (strips `strict: null` from tool definitions)
- `fix-codex.mjs` — Codex-specific fixes (full chat completions → Responses API translation)
- `fix-kimi.mjs` — Kimi/GLM (fireworks-ai) fixes (stream TransformStream for missing `[DONE]` and usage, model detection)
- `package.json` — Dependencies (pinned `@ai-sdk/openai-compatible@2.0.37`)
- `README.md` — User-facing documentation
- `test-thinking/` — Test configuration and debug proxy for thinking/reasoning testing
- `check-models/` — Automated model compatibility testing script
- `known-bugs/` — Documentation and test scripts for known API issues
- `cache/` — Test output directory (gitignored)

## What This Provider Does

Fixes issues when using models through nexos.ai API:

### Gemini
1. **Missing `data: [DONE]` in SSE streaming** — Gemini responses via nexos don't emit the `[DONE]` signal. The provider appends it via a `TransformStream` flush handler.
2. **`$ref` in tool schemas** — Gemini (Vertex AI) rejects JSON Schemas with `$ref`/`$defs`. The provider inlines all `$ref` references before sending.
3. **Unsupported JSON Schema keywords** — Gemini rejects `exclusiveMinimum`, `exclusiveMaximum`, `patternProperties`, `if`/`then`/`else`, `not`, `$schema`, `$id`, `$anchor`, `$comment`, `contentMediaType`, `contentEncoding` in tool schemas. The provider strips these keywords during `$ref` resolution, converting `exclusiveMinimum`/`exclusiveMaximum` to `minimum`/`maximum` as a best-effort approximation.
4. **Wrong `finish_reason` for tool calls** — Gemini returns `stop` instead of `tool_calls` when tool calls are present. The provider fixes this in the SSE stream.
5. **`finish_reason: "STOP"` (uppercase)** — With thinking enabled, Gemini returns `STOP` instead of `stop`. The provider normalizes it to lowercase.
6. **`budgetTokens` → `budget_tokens`** — Same as Claude: opencode sends camelCase, API expects snake_case. The provider converts automatically.
7. **`type: "disabled"` thinking removal** — Same as Claude: strips the entire `thinking` object when `type === "disabled"`.
8. **Gemini 3 models + tool use** — Gemini 3 Preview models require `thought_signature` for multi-turn tool-use conversations. This is a nexos/Vertex AI limitation, not fixable in the provider. Tool use with Gemini 3 models does NOT work.
9. **Gemini 2.5 Flash budget limit** — Flash model has a lower thinking budget limit (24576) than Pro (32000+). Configure `budgetTokens` accordingly in `opencode.json`.

### Kimi / GLM (fireworks-ai)
1. **Missing `data: [DONE]` in SSE streaming** — fireworks-ai models (Kimi, GLM) do not emit the `[DONE]` signal at the end of streaming responses. Without it, AI SDK cannot determine when the stream has ended.
2. **Missing `usage` in streaming** — fireworks-ai does not include usage data (prompt_tokens, completion_tokens) in streaming responses, even though non-streaming responses have it. AI SDK requires this data. The provider synthesizes a usage chunk with zero values.
3. **Stream fix via TransformStream** — The provider uses a `TransformStream` with `\n\n` buffering (same pattern as `appendDoneToStream`) to add missing `[DONE]` and usage chunks in the `flush` handler while streaming tokens to the user in real-time.

### Claude
1. **Prompt caching via `cache_control`** — Anthropic requires explicit `cache_control: {"type": "ephemeral"}` markers to enable prompt caching. opencode sends plain string system messages without these markers. The provider automatically converts system messages to content part arrays with `cache_control` on the last part, and adds `cache_control` to the last tool definition. This enables prefix caching for the system prompt and tools, reducing costs and latency on subsequent requests.
2. **`finish_reason: "end_turn"`** — Claude with thinking enabled returns `end_turn` instead of `stop`. opencode doesn't recognize this and enters an infinite retry loop. The provider rewrites it to `stop`.
3. **`budgetTokens` → `budget_tokens`** — opencode sends thinking params in camelCase but the API expects snake_case. The provider converts automatically.
4. **`type: "disabled"` with leftover `budgetTokens`** — When a variant disables thinking, opencode merges the variant config with the default, leaving `budgetTokens` in the request. The API rejects this. The provider strips the entire `thinking` object when `type === "disabled"`.
5. **`prompt_tokens` excludes cached tokens (Opus)** — Claude Opus models via nexos.ai report `prompt_tokens` without including cached tokens (unlike Sonnet which includes them). Additionally, Opus does not return Anthropic-style `cache_creation_input_tokens` / `cache_read_input_tokens` fields — only `prompt_tokens_details.cached_tokens` (OpenAI-style). The provider adds `cached_tokens` to `prompt_tokens` in the SSE stream so token accounting is correct. See `known-bugs/claude-cached-tokens-reporting/` for details.
6. **SSE stream chunk buffering** — SSE events from nexos.ai may arrive split across TCP chunks. Without buffering, the regex-based stream fixes (`end_turn`→`stop`, `prompt_tokens` adjustment) fail on partial JSON, causing opencode to hang waiting for a valid `stop` finish reason. The provider now buffers SSE events by `\n\n` boundaries before applying fixes.

### ChatGPT
1. **`reasoning_effort: "none"` unsupported** — The API rejects `"none"` as a value for `reasoning_effort` (supported: `minimal`, `low`, `medium`, `high`). opencode sends `"none"` when the `no-reasoning` variant is selected. The provider strips the `reasoning_effort` field entirely, which disables reasoning.

### Codex
1. **Not a chat model** — Codex models (e.g., `GPT 5.3 Codex`) do not support `/v1/chat/completions`. The API returns "This is not a chat model". The provider intercepts Codex requests and redirects them to `/v1/responses` (Responses API), converting the chat completions request format to Responses API format and converting the response/stream back to chat completions format so opencode can process it transparently.

### Codestral
1. **`strict: null` in tool definitions** — AI SDK / nexos.ai adds `strict: null` to tool function definitions. Mistral API rejects `null` for this field (expects boolean or absent). The provider sets `strict` to `false` when it's `null` or `undefined` (nexos.ai re-adds `strict: null` if the field is absent, so deletion doesn't work).

## Architecture

```
opencode → createNexosAI() → custom fetch wrapper → nexos.ai API
                                    │
                                    ├─ fix-gemini.mjs
                                    │   ├─ fixGeminiRequest(): inlines $ref, strips unsupported JSON Schema keywords in tool schemas
                                    │   ├─ fixGeminiThinkingRequest(): thinking params (camelCase→snake_case, disabled removal)
                                    │   └─ fixGeminiStream(): STOP→stop, stop→tool_calls finish reason
                                    │
                                    ├─ fix-claude.mjs
                                    │   ├─ fixClaudeCacheControl(): adds cache_control to system messages and last tool
                                    │   ├─ fixClaudeRequest(): thinking params (camelCase→snake_case, disabled removal, temperature strip)
                                    │   └─ fixClaudeStream(): end_turn→stop finish reason, prompt_tokens += cached_tokens
                                    │
                    ├─ fix-chatgpt.mjs
                    │   ├─ fixChatGPTRequest(): strips reasoning_effort:"none"
                    │   └─ fixChatGPTStream(): passthrough
                                    │
                                    ├─ fix-codex.mjs
                                    │   ├─ isCodexModel(): detects Codex models by name
                                    │   ├─ convertChatToResponsesRequest(): chat completions → Responses API request
                                    │   └─ createResponsesStreamConverter(): Responses API SSE → chat completions SSE
                                    │
                                    ├─ fix-codestral.mjs
                                    │   ├─ fixCodestralRequest(): sets strict:false when strict is null/undefined in tool definitions
                                    │   └─ fixCodestralStream(): passthrough
                                    │
                                    ├─ fix-kimi.mjs
                                    │   ├─ isKimiModel(): detects Kimi and GLM (fireworks-ai) models by name
                                    │   └─ createKimiStreamTransform(): TransformStream with \n\n buffering, adds usage+[DONE]
                                    │
                                    └─ appendDoneToStream(): buffers SSE events by \n\n, applies fixStreamChunk, adds [DONE] if missing
```

The provider is loaded by opencode via `file://` path in `opencode.json`:
```json
"npm": "file:///absolute/path/to/index.mjs"
```

## Key Technical Details

- The `@ai-sdk/openai-compatible` version MUST match what opencode bundles (currently `2.0.37`). Mismatched versions cause `mode.type` errors in `getArgs`.
- opencode discovers the provider by finding the first export starting with `create` and calling it with `{ name, ...options }`.
- The `env` field in the opencode provider config maps environment variable names for API key resolution. For nexos.ai use `["NEXOS_API_KEY"]`.
- `isGeminiModel()`, `isClaudeModel()`, and `isKimiModel()` checks are case-insensitive against the model name string. `isKimiModel()` also matches GLM models (both run on fireworks-ai backend).
- Stream fixing (`TransformStream` piping) is applied for Gemini models and all Claude models. The `appendDoneToStream()` transform buffers SSE events by `\n\n` boundaries before applying `fixStreamChunk()`, ensuring regex-based fixes work even when TCP chunks split SSE events.
- Kimi/GLM models use `createKimiStreamTransform()` — a `TransformStream` with `\n\n` buffering that adds missing `[DONE]` and usage chunks. Same buffering pattern as `appendDoneToStream()`.
- `fixClaudeRequest` only runs inside the `if (claude)` block — it strips temperature (required for Claude thinking) and would incorrectly strip it from Gemini if run globally. Gemini has its own thinking handler (`fixGeminiThinkingRequest`) that preserves temperature.
- `resolveRefs` in fix-gemini.mjs has circular reference protection via a `seen` Set — circular `$ref` returns `{}` instead of infinite recursion.

### Prompt Caching Status by Provider

| Provider | Status | Mechanism | Provider Fix Needed |
|----------|--------|-----------|-------------------|
| **Claude (Anthropic)** | Works with fix | Requires `cache_control: {"type": "ephemeral"}` markers on system messages and tools | Yes — `fixClaudeCacheControl()` adds markers automatically |
| **GPT (OpenAI)** | Works automatically | Auto prefix caching (min 1024 tokens), no markers needed | No |
| **Gemini (Vertex AI)** | Implicit caching (automatic) | Vertex AI has implicit caching enabled by default for Gemini 2.5 (min 2048 tokens, 90% discount). Works automatically but nexos.ai does not report `cached_tokens` in responses — savings are applied on billing side | No fix needed (or possible) |
| **Codestral (Mistral)** | Not supported | Mistral API does not support prompt caching | Cannot fix in provider |

### Vision / Image Input

opencode uses the `modalities` field in model config to determine if a model supports image input. Without `modalities.input` containing `"image"`, opencode will NOT send images to the model — even if the API supports it. This is an opencode behavior, not a provider issue.

**Required config for vision-capable models:**
```json
"modalities": {
  "input": ["text", "image"],
  "output": ["text"]
}
```

All vision-capable models in `opencode.json` MUST have this field. Models confirmed to support vision via nexos.ai API:
- Kimi K2.5
- Claude Opus 4.5, 4.6
- Claude Sonnet 4.5, 4.6
- Gemini 2.5 Pro, 2.5 Flash
- GPT 5, 5.2, 5.3 Instant

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
- Test Codex models: `GPT 5.3 Codex`
- Test Codestral models with tool use: `codestral-2508`
- Test both simple prompts (`what is 2+2?`) and tool-use prompts (`list files in current directory`)
- Test command: `opencode run "what is 2+2?" -m "nexos-ai/Gemini 2.5 Pro"`
- Claude thinking test: `opencode run "what is 2+2?" -m "nexos-ai/Claude Sonnet 4.5" --variant thinking-high`
- Gemini thinking test: `opencode run "what is 2+2?" -m "nexos-ai/Gemini 2.5 Pro" --variant thinking-high`
- Use `test-thinking/` directory with its `opencode.json` for thinking/reasoning tests
- Use `test-thinking/debug-proxy.mjs` to inspect request/response bodies (change `baseURL` to `http://localhost:9999/v1/`)
- Automated Claude thinking test: `bash cache/test-claude-thinking.sh`
- Automated model compatibility check: `node check-models/check-all.mjs`
- Single model test: `node check-models/check-all.mjs "GPT 4.1"`
- If upgrading `@ai-sdk/openai-compatible`, check the bundled version in opencode first: `strings ~/.opencode/bin/opencode | grep 'openai-compatible@'`
