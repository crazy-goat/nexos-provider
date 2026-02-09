import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isGeminiModel, fixGeminiRequest, fixGeminiStream } from "./fix-gemini.mjs";
import { fixClaudeRequest, fixClaudeStream } from "./fix-claude.mjs";
import { fixChatGPTRequest, fixChatGPTStream } from "./fix-chatgpt.mjs";

function fixStreamChunk(text) {
  text = fixGeminiStream(text);
  text = fixClaudeStream(text);
  text = fixChatGPTStream(text);
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
    let needsStreamFix = gemini;

    if (gemini) {
      requestBody = fixGeminiRequest(requestBody);
    }

    const claudeResult = fixClaudeRequest(requestBody);
    requestBody = claudeResult.body;
    if (claudeResult.hadThinking) needsStreamFix = true;

    requestBody = fixChatGPTRequest(requestBody);

    if (gemini || claudeResult.hadThinking) {
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
