# Gemini — Vertex AI rejects many JSON Schema keywords

## Summary

Gemini models through nexos.ai route to Vertex AI, whose tool-schema validator is stricter than the OpenAI JSON Schema dialect that opencode / AI SDK produces. Unsupported keywords cause Vertex AI to reject the entire request with a 400 error.

## Rejected keywords

`$ref`, `ref`, `$defs`, `definitions`, `$schema`, `$id`, `$anchor`, `$comment`, `exclusiveMinimum`, `exclusiveMaximum`, `patternProperties`, `if`, `then`, `else`, `not`, `contentMediaType`, `contentEncoding`

## Workaround

`fix-gemini.mjs` `resolveRefs()` processes each tool's `parameters`:

- Inlines `$ref` / `ref` against `$defs` / `definitions` (preserves `description` and `default` from the ref site).
- Strips every key in `UNSUPPORTED_SCHEMA_KEYS` from the resulting schema.
- Best-effort converts `exclusiveMinimum` / `exclusiveMaximum` → `minimum` / `maximum` so numeric bounds survive.
- Protects against cyclic `$ref` by tracking seen names — a self-referencing schema returns `{}` instead of recursing forever.

The pass runs on every Gemini request through `fixGeminiRequest` in `index.mjs`.

## Reproduction

`./test-schemas.sh` sends a tool definition containing each restricted keyword to Gemini 2.5 Pro and reports which keywords trigger a 400. Baseline schema (plain `type: object`) should always succeed; everything else should fail without the provider fix.

## Impact

Without this fix, virtually any opencode tool with a Zod schema (most of them — Zod compiles nested types to `$ref`/`$defs`) instantly fails with a Vertex AI validation error.
