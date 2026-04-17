# GPT — chat completions endpoint restrictions on nexos.ai

## Summary

nexos.ai's chat completions endpoint for GPT models is narrower than OpenAI's native API. Three fields that opencode / AI SDK emit routinely cause 400 errors and must be stripped before the request leaves the provider.

## Issues

1. **`reasoning_effort: "none"` on non-reasoning models** — nexos.ai returns `Reasoning is not enabled for this model` on legacy / non-reasoning variants: GPT 4.x, `*Chat*`, `*Instant*`, `gpt-oss*`. Modern reasoning models (GPT 5, 5.2, 5.4 and their `mini`/`nano`) accept `"none"` natively. opencode's base config for GPT 5 defaults to `reasoning_effort:"none"`; adding any legacy GPT to the config without also overriding this option would 400 every request.
2. **`temperature: false`** — opencode emits the boolean `false` when a variant has no temperature; the API expects a number or the field to be absent.
3. **`temperature` for non-Codex models** — nexos.ai's chat completions only accepts the default temperature (1) for GPT. Any custom numeric value is rejected. Codex models bypass chat completions entirely and *do* support custom temperature via the Responses API (see `codex-responses-api/`).

## Workaround

`fix-chatgpt.mjs`:

- `isLegacyChatGPTModel(model)` — heuristic matching GPT 4.x, `Chat`, `Instant`, `oss` variants.
- `fixChatGPTRequest` strips `reasoning_effort` when it equals `"none"` **AND** the model is legacy; strips `temperature` when it equals `false`.
- `fixChatGPTTemperature` unconditionally strips `temperature` from the body.

`index.mjs` runs `fixChatGPTTemperature` for all GPT / ChatGPT models except Codex, then `fixChatGPTRequest` for all of them.

## Impact

Without these strips: every opencode request using the `no-reasoning` variant or a custom `temperature` on a GPT model returns 400 before inference starts.
