import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isGeminiModel, fixGeminiRequest, fixGeminiThinkingRequest, fixGeminiStream } from "./fix-gemini.mjs";
import { fixClaudeRequest, fixClaudeStream } from "./fix-claude.mjs";
import { fixChatGPTRequest, fixChatGPTStream } from "./fix-chatgpt.mjs";
import { isCodestralModel, fixCodestralRequest, fixCodestralStream } from "./fix-codestral.mjs";

function fixStreamChunk(text) {
  text = fixGeminiStream(text);
  text = fixClaudeStream(text);
  text = fixChatGPTStream(text);
  text = fixCodestralStream(text);
  return text;
}

function appendDoneToStream() {
  const encoder = new TextEncoder();
  let sawDone = false;

  return new TransformStream({
    transform(chunk, controller) {
      let text =
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      if (text.includes("[DONE]")) sawDone = true;
      text = fixStreamChunk(text);
      controller.enqueue(encoder.encode(text));
    },
    flush(controller) {
      if (!sawDone) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
    },
  });
}

function createNexosFetch(baseFetch) {
  const realFetch = baseFetch || globalThis.fetch;

  return async function nexosFetch(url, init) {
    let requestBody;
    try {
      requestBody = init?.body ? JSON.parse(init.body) : {};
    } catch {
      requestBody = {};
    }

    const gemini = isGeminiModel(requestBody.model);
    const codestral = isCodestralModel(requestBody.model);
    let needsStreamFix = gemini;
    let bodyChanged = false;

    if (gemini) {
      requestBody = fixGeminiRequest(requestBody);
      const geminiThinking = fixGeminiThinkingRequest(requestBody);
      requestBody = geminiThinking.body;
      if (geminiThinking.hadThinking) needsStreamFix = true;
      bodyChanged = true;
    }

    if (codestral) {
      requestBody = fixCodestralRequest(requestBody);
      bodyChanged = true;
    }

    const claudeResult = fixClaudeRequest(requestBody);
    requestBody = claudeResult.body;
    if (claudeResult.hadThinking) needsStreamFix = true;

    const beforeChatGPT = requestBody;
    requestBody = fixChatGPTRequest(requestBody);
    const chatgptChanged = requestBody !== beforeChatGPT;

    if (gemini || codestral || claudeResult.hadThinking || chatgptChanged) {
      init = { ...init, body: JSON.stringify(requestBody) };
    }

    const response = await realFetch(url, init);

    if (needsStreamFix && requestBody.stream) {
      const fixedBody = response.body.pipeThrough(appendDoneToStream());
      return new Response(fixedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return response;
  };
}

export function createNexosAI(options = {}) {
  return createOpenAICompatible({
    ...options,
    name: options.name || "nexos-ai",
    fetch: createNexosFetch(options.fetch),
  });
}
