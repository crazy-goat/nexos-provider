# Changelog

All notable changes to this project will be documented in this file.

## [1.13.0] - 2026-04-17

### Added
- **`tool_use` → `tool_calls` rewrite in `fixClaudeStream`** — in thinking mode Claude emits `finish_reason: "tool_use"` (Anthropic-native) instead of the OpenAI-compatible `"tool_calls"` for tool-invoking turns. Verified on all 5 current Claude models (Sonnet 4.5, Sonnet 4.6, Opus 4.6, Opus 4.7, Haiku 4.5). Without the rewrite AI SDK maps it to `"other"` and opencode retries on every tool call made under `/high` or `/low` variants. See `known-bugs/claude-finish-reason-end-turn/` for the expanded reproduction map.
- **`isLegacyChatGPTModel()` heuristic** — `fix-chatgpt.mjs` now detects non-reasoning GPT variants (GPT 4.x, `*Chat*`, `*Instant*`, `gpt-oss*`) and only strips `reasoning_effort:"none"` for those. Modern GPT 5/5.2/5.4 accept `"none"` natively, so the provider no longer rewrites their requests. Verified direct against nexos.ai and end-to-end through opencode (simple + tool-call + `/high` / `/low` variants) — all 6 modern GPT models work without stripping.

### Changed
- **`thinking: {type: "disabled"}` is now a pass-through** — previously stripped by `fixClaudeRequest`. Verified 2026-04-17 that all 5 Claude models on nexos.ai accept `{type: "disabled"}` in non-stream, stream, and stream+tool modes; the strip was dead code against current upstream behavior. Kept the early-return so disabled requests skip camelCase conversion and `temperature` stripping. See `known-bugs/claude-thinking-params/` for the historical note.

## [1.12.0] - 2026-04-17

### Fixed
- **Claude Opus 4.7 streaming tool calls broken when `temperature` is present** — nexos.ai routes Opus 4.7 requests with `temperature` (any value) to a guardrails-enabled backend where streaming tool calls are broken: the response streams only empty `content` deltas and a final `finish_reason: "tool_use"` with no `tool_calls`/`arguments` deltas, so opencode never receives the tool invocation. `fixClaudeRequest` now strips `temperature` for Opus 4.7 regardless of `thinking` state. Other Claude models (Sonnet 4.5/4.6, Opus 4.6) tolerate `temperature` and are unaffected. See `known-bugs/claude-opus-47-temperature/` for details.
- **SSE stream buffering** — `appendDoneToStream()` now buffers SSE events by `\n\n` boundaries so `end_turn`→`stop` conversion no longer fails on TCP-split chunks (previously caused 2-minute client timeouts).
- **Sonnet 4.6 cache invalidation on vertex-ai** — Sonnet 4.6 invalidates cache when `cache_control` appears on user/tool_result messages. `fixClaudeCacheControl` now skips user-message breakpoints for Sonnet 4.6 (system + tools breakpoints still applied). See `known-bugs/claude-sonnet-46-cache/` for details.
- **Kimi progressive streaming** — `bufferKimiStream` (introduced in 1.9.1) waited for the entire response before emitting, so users saw no streaming. Replaced with a `TransformStream` that buffers by `\n\n` boundaries and emits chunks as they arrive, while still appending `usage` + `[DONE]` in flush. The original flush()-reentry workaround is no longer needed thanks to the 1.10.0 SDK upgrade.
- **`fixClaudeRequest` scope** — moved inside the `if (claude)` guard in `index.mjs` so it no longer strips `temperature` from Gemini requests that enable thinking.

### Added
- **4th cache breakpoint on previous user message** — `fixClaudeCacheControl` now adds a second sliding breakpoint for multi-turn conversation history caching.
- **Gemini 3 / 3.1 multi-turn tool calling workaround** — Gemini 3/Pro Preview and Gemini 3.1 reject follow-up requests that reference prior tool calls because nexos.ai does not propagate `thought_signature`. `fix-gemini.mjs` rewrites tool-using history into plain alternating user/assistant turns (tool calls described as text, results injected as user content) so multi-turn tool workflows continue to function. See `known-bugs/gemini3-tools/` for details.
- **GLM 5 support** — added to the `fireworks-ai` stream-buffering fix path (same issue profile as Kimi).
- **Circular `$ref` protection** — `resolveRefs` returns `{}` instead of recursing infinitely when a schema contains cyclic references.

## [1.11.0] - 2026-03-30

### Note
Published to npm but not tracked in git (ad-hoc release). All changes from this release are captured in 1.12.0, which is the authoritative continuation of the 1.10.0 git state.

## [1.10.0] - 2026-03-30

### Changed
- **Upgrade `@ai-sdk/openai-compatible` from 1.0.32 to 2.0.37** to match opencode's bundled version. Removes the `fixClaudeMessages` "dot workaround" that was needed under the older SDK to satisfy Claude's "conversation must end with user" requirement.

## [1.9.1] - 2026-03-29

### Added
- **Kimi stream buffering fix** — new `fix-kimi.mjs` module. Buffers entire SSE stream (instead of `TransformStream`) to work around `flush()` being called multiple times by the AI SDK. Appends missing `[DONE]` and usage chunks for Kimi streaming responses.
- 20 new tests (87 total, all passing).

### Fixed
- **Claude "assistant message prefill" error** — `fix-claude.mjs` appends an empty user message when the last message is from the assistant (Claude requires conversations to end with a user turn).

## [1.9.0] - 2026-03-18

### Fixed
- **Vision support** — all models were missing `modalities` config in `opencode.json`, causing opencode to strip image content before sending to API. Added `modalities: { input: ["text", "image"], output: ["text"] }` to all 11 nexos-ai models.
- **Gemini unsupported JSON Schema keywords** — Gemini/Vertex AI rejects `exclusiveMinimum`, `exclusiveMaximum`, `patternProperties`, `if`/`then`/`else`, `not`, `$schema`, `$id`, `$anchor`, `$comment`, `contentMediaType`, `contentEncoding` in tool schemas. The provider now strips these during `$ref` resolution, converting `exclusiveMinimum`/`exclusiveMaximum` to `minimum`/`maximum` as best-effort approximation.

### Added
- **Unit tests** — 67 tests covering all fix modules (`fix-gemini`, `fix-claude`, `fix-chatgpt`, `fix-codestral`, `fix-codex`) using Node.js built-in test runner.
- **Test images** — `test-cat.jpg`, `test-horse.jpg` for vision testing.
- **`npm test` script** in `package.json`.
- **Vision/modalities documentation** in `AGENTS.md`.

## [1.8.0] - 2026-03-05

### Fixed
- **ChatGPT/GPT**: strip `temperature` for non-Codex models (nexos.ai chat completions only supports default temperature; Codex models via Responses API support custom temperature).
- **Bug fix**: `fixChatGPTRequest()` no longer strips temperature for all models - only when explicitly set to `false`.

## [1.7.0] - 2026-02-27

### Added
- **Codex support** — `fix-codex.mjs` adds full support for `GPT 5.3 Codex` and other Codex models that require the Responses API (`/v1/responses`) instead of `/v1/chat/completions`. The provider transparently converts chat completions requests to Responses API format and converts the response (including SSE streaming, tool calls, reasoning, and usage/cache tokens) back to chat completions format.

### Fixed
- **Claude**: strip `temperature` from request body when thinking is enabled (API rejects `temperature` with thinking).
- **ChatGPT**: strip `temperature` from request body when set to `false` (invalid value rejected by API).

## [1.6.0] - 2026-02-13

### Added
- **Claude multi-turn caching** — `fixClaudeCacheControl` now adds `cache_control: {"type": "ephemeral"}` to the last non-assistant message (user or tool_result), in addition to the existing system prompt and tool-definition breakpoints. Creates a rolling cache of conversation history so subsequent turns get cache reads over prior tool_results and user messages.

## [1.4.0] - 2026-02-13

### Fixed
- **Claude Opus `prompt_tokens` excludes cached tokens** — Opus reports cached input via `prompt_tokens_details.cached_tokens` while keeping `prompt_tokens` as uncached-only. `fixClaudeStream` now adds `cached_tokens` into `prompt_tokens` on streamed usage chunks so opencode's usage display reflects the full input volume.

## [1.3.5] - 2026-02-12

### Added
- `known-bugs/token-caching/` — comprehensive token caching tests and documentation for all providers.
  - Test script (`test-caching.sh`) simulating vibe coding sessions with ~5000 token system prompt.
  - Supports testing all models or a single model (`./test-caching.sh "Gemini 2.5 Pro"`).
  - Discovered that Gemini implicit caching does NOT do prefix matching — only caches identical requests.
  - Gemini explicit caching (via `cachedContents` API) does prefix matching but is not available through nexos.ai.
  - Claude and GPT prefix caching works correctly through nexos.ai.
- `known-bugs/thinking/` — documented thinking blocks known bug.

## [1.3.4] - 2026-02-11

### Fixed
- Include README.md in npm package.

## [1.3.3] - 2026-02-11

### Added
- `check-models/` directory with automated model compatibility testing script.
- `known-bugs/gemini3-tools/` directory with test script and documentation for Gemini 3 tool calling issue.

## [1.3.2] - 2026-02-09

### Removed
- Removed `list-models.mjs` CLI tool (use [opencode-nexos-models-config](https://github.com/crazy-goat/opencode-nexos-models-config) instead).

### Changed
- Added update instructions to README.
- Cleaned up `package.json` (`bin`, `scripts` fields removed).

## [1.3.1] - 2026-02-09

### Fixed
- Include `fix-gemini.mjs`, `fix-claude.mjs`, and `fix-chatgpt.mjs` in published npm package (missing from `files` field since 1.2.2).

## [1.3.0] - 2026-02-09

### Added
- **Gemini thinking support** — new `fixGeminiThinkingRequest()` function handles `budgetTokens` → `budget_tokens` conversion, strips disabled thinking, and adjusts `max_tokens` when budget exceeds it.
- **Gemini stream thinking blocks** — `fixGeminiStream()` now extracts `content_blocks[].delta.thinking` into `reasoning_content` for compatibility with opencode's reasoning display.
- **Gemini `STOP` normalization** — uppercase `STOP` finish reason (returned with thinking enabled) is now normalized to lowercase `stop`.
- **ChatGPT `reasoning_effort: "none"` fix** — `fixChatGPTRequest()` strips `reasoning_effort` when set to `"none"` (unsupported by the API), effectively disabling reasoning.
- **Gemini 2.5 Flash** added to tested models.
- **Variant naming convention** documented — variants must be named `low` and `high`.

### Changed
- `index.mjs` now imports and applies `fixGeminiThinkingRequest()` for Gemini models.
- Request body re-serialization now also triggers when ChatGPT request was modified.
- Updated `AGENTS.md` with Gemini thinking fixes (#4–#8), ChatGPT fix, variant naming rules, and Gemini thinking test command.

## [1.2.2] - 2026-02-08

### Changed
- Simplified README, updated provider name to `nexos-ai`.
- Refactored provider fixes into per-model modules (`fix-gemini.mjs`, `fix-claude.mjs`, `fix-chatgpt.mjs`).
- Updated documentation with Claude and ChatGPT support.

## [1.1.0] - 2026-02-08

### Added
- Claude support with thinking params normalization and `end_turn` → `stop` finish reason fix.
- ChatGPT support (passthrough).
- Multi-provider architecture.

## [1.0.1] - 2026-02-08

### Fixed
- Minor bug fixes.

## [1.0.0] - 2026-02-08

### Added
- Initial release: custom AI SDK provider for nexos.ai Gemini models.
- SSE streaming `[DONE]` signal fix.
- `$ref` inlining in tool schemas for Vertex AI compatibility.
- `stop` → `tool_calls` finish reason fix for tool calls.
- Model listing script (`list-models.mjs`).
