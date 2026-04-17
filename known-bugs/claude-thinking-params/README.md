# Claude — thinking parameter naming and lifecycle mismatches

## Summary

opencode / AI SDK sends Anthropic's thinking config in a form that the API rejects. Four independent schema-level mismatches are handled together in `fixClaudeRequest`.

## Issues

1. **`budgetTokens` (camelCase) → `budget_tokens` (snake_case)** — AI SDK keeps camelCase on outgoing request bodies; Anthropic expects snake_case.
2. **`thinking: {type: "disabled"}`** — there is no Anthropic-supported "disabled" mode. The field's absence turns thinking off. opencode variants like `no-thinking` send the explicit disabled object; we strip the whole `thinking` key instead.
3. **`max_tokens <= budget_tokens`** — Anthropic requires `max_tokens > budget_tokens`. When they're equal or the budget is larger, the request 400s. We bump `max_tokens = budget_tokens + 4096`.
4. **`temperature` with thinking enabled** — Anthropic rejects custom temperature while thinking is on. Strip the field.

## Workaround

All four live in `fixClaudeRequest` in `fix-claude.mjs`:

- Enters only when `body.thinking` is present.
- Exits early (stripping `thinking`) when `thinking.type === "disabled"`.
- Otherwise renames camelCase, strips `temperature`, and adjusts `max_tokens` as needed.

Applied for every Claude model through `index.mjs`.

## Related

Opus 4.7 has an additional temperature issue (stripped even without thinking) — see `claude-opus-47-temperature/`.

## Impact

Without these fixes: any variant switching between `thinking-high` / `no-thinking` immediately fails with schema validation or 400 errors from Anthropic.
