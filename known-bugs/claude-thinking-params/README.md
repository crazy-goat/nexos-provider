# Claude — thinking parameter naming and lifecycle mismatches

## Summary

opencode / AI SDK sends Anthropic's thinking config in a form that the API rejects. Three schema-level mismatches are handled together in `fixClaudeRequest`.

## Issues

1. **`budgetTokens` (camelCase) → `budget_tokens` (snake_case)** — AI SDK keeps camelCase on outgoing request bodies; Anthropic expects snake_case.
2. **`max_tokens <= budget_tokens`** — Anthropic requires `max_tokens > budget_tokens`. When they're equal or the budget is larger, the request 400s. We bump `max_tokens = budget_tokens + 4096`.
3. **`temperature` with thinking enabled** — Anthropic rejects custom temperature while thinking is on. Strip the field.

## Historical issue (no longer reproduces)

**`thinking: {type: "disabled"}`** — originally opencode's `no-thinking` variant sent this and Anthropic rejected it (there is no "disabled" mode in the native API; absence of the field turns thinking off). Verified 2026-04-17 on nexos.ai across Sonnet 4.5, Sonnet 4.6, Opus 4.6, Opus 4.7, and Haiku 4.5 — all accept `{type: "disabled"}` in non-stream, stream, and stream+tool modes. `fixClaudeRequest` now treats `disabled` as a no-op pass-through (equivalent to "no thinking"), but does not modify the request.

## Workaround

All three active issues live in `fixClaudeRequest` in `fix-claude.mjs`:

- Returns early as "no thinking" when `body.thinking` is absent or `thinking.type === "disabled"`.
- Otherwise renames camelCase, strips `temperature`, and adjusts `max_tokens` as needed.

Applied for every Claude model through `index.mjs`.

## Related

Opus 4.7 has an additional temperature issue (stripped even without thinking) — see `claude-opus-47-temperature/`.

## Impact

Without these fixes: any variant switching to `thinking-high` / `thinking-low` with camelCase, equal max/budget, or temperature set immediately fails with schema validation or 400 errors from Anthropic.
