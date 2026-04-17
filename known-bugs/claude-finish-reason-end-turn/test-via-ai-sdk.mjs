#!/usr/bin/env node
// Tests whether `end_turn` finish_reason reaches AI SDK and breaks the client.
//
// Approach: bypass the provider's fixClaudeStream by intercepting the response
// stream and re-injecting `end_turn` wherever nexos.ai emits `stop`, then see
// if AI SDK completes, errors, or hangs.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

const API_KEY = process.env.NEXOS_API_KEY;
if (!API_KEY) { console.error("ERROR: NEXOS_API_KEY not set"); process.exit(1); }

const TIMEOUT_MS = 20000;

function injectEndTurnStream(upstreamBody) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return upstreamBody.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const rewritten = text.replace(/"finish_reason":"stop"/g, '"finish_reason":"end_turn"');
      controller.enqueue(encoder.encode(rewritten));
    },
  }));
}

async function testModel(model) {
  const fetchThatInjectsEndTurn = async (url, init) => {
    const resp = await fetch(url, init);
    if (!resp.body) return resp;
    return new Response(injectEndTurnStream(resp.body), {
      status: resp.status, statusText: resp.statusText, headers: resp.headers,
    });
  };

  const nexos = createOpenAICompatible({
    name: "nexos-ai",
    apiKey: API_KEY,
    baseURL: "https://api.nexos.ai/v1/",
    fetch: fetchThatInjectsEndTurn,
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
    const icon = finishReason === "unknown" || finishReason === "other" ? "❌" : "⚠️";
    console.log(`${icon} ${model.padEnd(22)} finish=${String(finishReason).padEnd(10)} content="${content.slice(0, 40)}" (${ms}ms)`);
  } catch (e) {
    clearTimeout(timeoutHandle);
    const ms = Date.now() - t0;
    const msg = String(e.message || e).slice(0, 60);
    const icon = msg.includes("abort") ? "❌" : "❌";
    console.log(`${icon} ${model.padEnd(22)} ERROR: ${msg} (${ms}ms)`);
  }
}

console.log("=== Claude end_turn via AI SDK (end_turn injected into response stream) ===");
console.log("(bypasses provider's fixClaudeStream — demonstrates opencode impact)");
console.log("");
console.log("  MODEL                 RESULT");
console.log("  --------------------- ----------------------------------------");

for (const model of ["Claude Sonnet 4.5", "Claude Sonnet 4.6", "Claude Opus 4.6", "Claude Opus 4.7"]) {
  await testModel(model);
}

console.log("");
console.log("Legend:");
console.log("  ❌ finish=unknown/other or timeout = bug reproduced (AI SDK can't interpret end_turn)");
console.log("  ⚠️  finish=stop                    = AI SDK tolerated it unexpectedly");
