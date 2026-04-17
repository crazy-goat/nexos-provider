#!/usr/bin/env node
// Tests whether sending `thinking: {type: "disabled"}` (as opencode's no-thinking
// variant does) survives the AI SDK round-trip without provider stripping.
//
// Approach: bypass fixClaudeRequest by adding `thinking: {type: "disabled"}`
// to every outgoing request body, then see if AI SDK completes.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

const API_KEY = process.env.NEXOS_API_KEY;
if (!API_KEY) { console.error("ERROR: NEXOS_API_KEY not set"); process.exit(1); }

const TIMEOUT_MS = 20000;

async function testModel(model) {
  const fetchWithDisabledThinking = async (url, init) => {
    if (init?.body && typeof init.body === "string") {
      const body = JSON.parse(init.body);
      body.thinking = { type: "disabled" };
      init = { ...init, body: JSON.stringify(body) };
    }
    return fetch(url, init);
  };

  const nexos = createOpenAICompatible({
    name: "nexos-ai",
    apiKey: API_KEY,
    baseURL: "https://api.nexos.ai/v1/",
    fetch: fetchWithDisabledThinking,
  });

  const t0 = Date.now();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const result = streamText({
      model: nexos(model),
      prompt: "Say hi in 3 words",
      maxOutputTokens: 30,
      abortSignal: controller.signal,
    });

    let content = "";
    let finishReason = null;
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") content += part.text || "";
      if (part.type === "finish") finishReason = part.finishReason;
      if (part.type === "error") throw part.error;
    }
    clearTimeout(timeoutHandle);
    const ms = Date.now() - t0;
    console.log(`✅ ${model.padEnd(22)} finish=${String(finishReason).padEnd(10)} content="${content.slice(0, 40)}" (${ms}ms)`);
  } catch (e) {
    clearTimeout(timeoutHandle);
    const ms = Date.now() - t0;
    const msg = String(e.message || e).slice(0, 70);
    console.log(`❌ ${model.padEnd(22)} ERROR: ${msg} (${ms}ms)`);
  }
}

console.log("=== Claude thinking:{type:disabled} via AI SDK (no provider stripping) ===");
console.log("(bypasses fixClaudeRequest — demonstrates opencode impact of no-thinking variant)");
console.log("");
console.log("  MODEL                 RESULT");
console.log("  --------------------- ----------------------------------------");

for (const model of ["Claude Sonnet 4.5", "Claude Sonnet 4.6", "Claude Opus 4.6", "Claude Opus 4.7"]) {
  await testModel(model);
}

console.log("");
console.log("Legend:");
console.log("  ❌ ERROR  = bug reproduced (upstream or AI SDK rejects disabled type)");
console.log("  ✅ finish = upstream + AI SDK tolerate it — provider strip may be redundant");
