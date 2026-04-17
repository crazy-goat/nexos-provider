# Codestral — Mistral API rejects `strict: null` in tool definitions

## Summary

opencode / AI SDK emits tool definitions with `function.strict = null` when strict mode is not explicitly set. Mistral's API (the Codestral backend on nexos.ai) rejects `null` for this field — it accepts `true`, `false`, or the field's absence, nothing else.

## Workaround

`fix-codestral.mjs` `fixCodestralRequest()` iterates every tool in `body.tools` and coerces `null` / `undefined` `function.strict` → `false`. Non-function tools and already-boolean values pass through unchanged.

Applied for every Codestral model via `isCodestralModel` in `index.mjs`.

## Impact

Without the fix, every tool-using request to a Codestral model returns 400 before inference starts.
