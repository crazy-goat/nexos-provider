# Changelog

All notable changes to this project will be documented in this file.

## [1.7.0] - 2026-02-27

### Added
- **Codex support** — `fix-codex.mjs` adds full support for `GPT 5.3 Codex` and other Codex models that require the Responses API (`/v1/responses`) instead of `/v1/chat/completions`. The provider transparently converts chat completions requests to Responses API format and converts the response (including SSE streaming, tool calls, reasoning, and usage/cache tokens) back to chat completions format.

## [1.3.5] - 2025

### Added
- `known-bugs/token-caching/` — comprehensive token caching tests and documentation for all providers.
  - Test script (`test-caching.sh`) simulating vibe coding sessions with ~5000 token system prompt.
  - Supports testing all models or a single model (`./test-caching.sh "Gemini 2.5 Pro"`).
  - Discovered that Gemini implicit caching does NOT do prefix matching — only caches identical requests.
  - Gemini explicit caching (via `cachedContents` API) does prefix matching but is not available through nexos.ai.
  - Claude and GPT prefix caching works correctly through nexos.ai.
- `known-bugs/thinking/` — documented thinking blocks known bug.

## [1.3.4] - 2025

### Fixed
- Include README.md in npm package.

## [1.3.3] - 2025

### Added
- `check-models/` directory with automated model compatibility testing script.
- `known-bugs/gemini3-tools/` directory with test script and documentation for Gemini 3 tool calling issue.

## [1.3.2] - 2025

### Removed
- Removed `list-models.mjs` CLI tool (use [opencode-nexos-models-config](https://github.com/crazy-goat/opencode-nexos-models-config) instead).

### Changed
- Added update instructions to README.
- Cleaned up `package.json` (`bin`, `scripts` fields removed).

## [1.3.1] - 2025

### Fixed
- Include `fix-gemini.mjs`, `fix-claude.mjs`, and `fix-chatgpt.mjs` in published npm package (missing from `files` field since 1.2.2).

## [1.3.0] - 2025

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

## [1.2.2] - 2025

### Changed
- Simplified README, updated provider name to `nexos-ai`.
- Refactored provider fixes into per-model modules (`fix-gemini.mjs`, `fix-claude.mjs`, `fix-chatgpt.mjs`).
- Updated documentation with Claude and ChatGPT support.

## [1.1.0] - 2025

### Added
- Claude support with thinking params normalization and `end_turn` → `stop` finish reason fix.
- ChatGPT support (passthrough).
- Multi-provider architecture.

## [1.0.1] - 2025

### Fixed
- Minor bug fixes.

## [1.0.0] - 2025

### Added
- Initial release: custom AI SDK provider for nexos.ai Gemini models.
- SSE streaming `[DONE]` signal fix.
- `$ref` inlining in tool schemas for Vertex AI compatibility.
- `stop` → `tool_calls` finish reason fix for tool calls.
- Model listing script (`list-models.mjs`).
