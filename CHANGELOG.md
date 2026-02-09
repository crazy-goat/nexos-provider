# Changelog

All notable changes to this project will be documented in this file.

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
