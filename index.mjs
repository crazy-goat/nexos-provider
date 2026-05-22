import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { isGeminiModel, fixGeminiRequest, fixGeminiThinkingRequest, fixGeminiStream } from "./fix-gemini.mjs";
import { isClaudeModel } from "./fix-claude.mjs";
import { isChatGPTModel, fixChatGPTRequest, fixChatGPTTemperature, fixChatGPTStream } from "./fix-chatgpt.mjs";
import { isMistralModel, fixMistralRequest, fixMistralStream } from "./fix-mistral.mjs";
import { isCodexModel, convertChatToResponsesRequest, createResponsesStreamConverter } from "./fix-codex.mjs";
import { isKimiModel, createKimiStreamTransform } from "./fix-kimi.mjs";

function fixStreamChunk(text) {
  text = fixGeminiStream(text);
  text = fixChatGPTStream(text);
  text = fixMistralStream(text);
  return text;
}

function appendDoneToStream() {
  const encoder = new TextEncoder();
  let sawDone = false;
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        if (part.includes("[DONE]")) sawDone = true;
        const fixed = fixStreamChunk(part + "\n");
        controller.enqueue(encoder.encode(fixed + "\n"));
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        if (buffer.includes("[DONE]")) sawDone = true;
        const fixed = fixStreamChunk(buffer + "\n");
        controller.enqueue(encoder.encode(fixed + "\n"));
      }
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

    const codex = isCodexModel(requestBody.model);
    if (codex) {
      const responsesBody = convertChatToResponsesRequest(requestBody);
      const responsesUrl = url.replace(/\/chat\/completions\/?$/, "/responses");
      const responsesInit = { ...init, body: JSON.stringify(responsesBody) };
      const response = await realFetch(responsesUrl, responsesInit);

      if (responsesBody.stream && response.body) {
        const converter = createResponsesStreamConverter(
          "chatcmpl-" + Date.now(),
          requestBody.model,
        );
        const fixedBody = response.body.pipeThrough(converter);
        return new Response(fixedBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      const respJson = await response.json();
      const hasToolCalls = respJson.output?.some((o) => o.type === "function_call");
      const message = { role: "assistant", content: null, tool_calls: [] };

      for (const item of respJson.output || []) {
        if (item.type === "message") {
          message.content = item.content
            ?.map((c) => c.text || "")
            .join("") || null;
        }
        if (item.type === "function_call") {
          message.tool_calls.push({
            id: item.call_id,
            type: "function",
            function: { name: item.name, arguments: item.arguments },
          });
        }
      }
      if (!message.tool_calls.length) delete message.tool_calls;

      const chatResponse = {
        id: respJson.id,
        object: "chat.completion",
        created: respJson.created_at,
        model: respJson.model,
        choices: [{
          index: 0,
          message,
          finish_reason: hasToolCalls ? "tool_calls" : "stop",
        }],
        usage: respJson.usage ? {
          prompt_tokens: respJson.usage.input_tokens || 0,
          completion_tokens: respJson.usage.output_tokens || 0,
          total_tokens: respJson.usage.total_tokens || 0,
          prompt_tokens_details: {
            cached_tokens: respJson.usage.input_tokens_details?.cached_tokens || 0,
          },
          completion_tokens_details: {
            reasoning_tokens: respJson.usage.output_tokens_details?.reasoning_tokens || 0,
          },
        } : undefined,
      };

      return new Response(JSON.stringify(chatResponse), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const gemini = isGeminiModel(requestBody.model);
    const mistral = isMistralModel(requestBody.model);
    const kimi = isKimiModel(requestBody.model);
    let needsStreamFix = gemini;
    let bodyChanged = false;

    if (gemini) {
      requestBody = fixGeminiRequest(requestBody);
      const geminiThinking = fixGeminiThinkingRequest(requestBody);
      requestBody = geminiThinking.body;
      if (geminiThinking.hadThinking) needsStreamFix = true;
      bodyChanged = true;
    }

    if (mistral) {
      requestBody = fixMistralRequest(requestBody);
      bodyChanged = true;
    }

    const beforeChatGPT = requestBody;
    requestBody = fixChatGPTRequest(requestBody);
    const chatgptChanged = requestBody !== beforeChatGPT;

    const chatgpt = isChatGPTModel(requestBody.model);
    if (chatgpt && !codex) {
      requestBody = fixChatGPTTemperature(requestBody);
    }

    if (gemini || mistral || kimi || chatgptChanged || chatgpt) {
      init = { ...init, body: JSON.stringify(requestBody) };
    }

    const response = await realFetch(url, init);

    if (kimi && requestBody.stream) {
      const fixedBody = response.body.pipeThrough(createKimiStreamTransform(fixStreamChunk));
      return new Response(fixedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

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

function isOpus47Plus(model) {
  if (typeof model !== "string") return false;
  const m = model.toLowerCase();
  if (!m.includes("opus")) return false;
  const match = m.match(/(\d+)[.\-](\d+)/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  return major > 4 || (major === 4 && minor >= 7);
}

function createAnthropicFetch(baseFetch) {
  const realFetch = baseFetch || globalThis.fetch;

  return async function anthropicFetch(url, init) {
    let body;
    try {
      body = init?.body ? JSON.parse(init.body) : {};
    } catch {
      return realFetch(url, init);
    }

    if (isOpus47Plus(body.model) && body.temperature !== undefined) {
      const { temperature, ...rest } = body;
      body = rest;
    }

    if (Array.isArray(body.system) && body.system.length > 0) {
      const first = body.system[0];
      if (first?.type === "text") {
        let text = first.text;
        if (Array.isArray(text) && text.length > 0 && text[0]?.type === "text") {
          text = text[0].text;
        }
        if (typeof text === "string") {
          body = { ...body, system: text };
        }
      }
    } else if (typeof body.system === "object" && body.system !== null && body.system?.type === "text") {
      let text = body.system.text;
      if (Array.isArray(text) && text.length > 0 && text[0]?.type === "text") {
        text = text[0].text;
      }
      if (typeof text === "string") {
        body = { ...body, system: text };
      }
    }

    if (!body.cache_control && body.system) {
      const systemText = typeof body.system === "string" ? body.system : "";
      const systemLength = systemText.length;
      if (systemLength > 3000) {
        body = { ...body, cache_control: { type: "ephemeral" } };
      }
    }

    init = { ...init, body: JSON.stringify(body) };
    return realFetch(url, init);
  };
}

export function createNexosAI(options = {}) {
  const openaiProvider = createOpenAICompatible({
    ...options,
    name: options.name || "nexos-ai",
    fetch: createNexosFetch(options.fetch),
  });

  const anthropicProvider = createAnthropic({
    baseURL: "https://api.nexos.ai/v1",
    authToken: options.apiKey,
    fetch: createAnthropicFetch(options.fetch),
  });

  return {
    specificationVersion: "v3",
    languageModel(modelId) {
      if (isClaudeModel(modelId)) {
        return anthropicProvider.languageModel(modelId);
      }
      return openaiProvider.languageModel(modelId);
    },
    chatModel(modelId) {
      if (isClaudeModel(modelId)) {
        return anthropicProvider.chat(modelId);
      }
      return openaiProvider.chatModel(modelId);
    },
    completionModel(modelId) {
      return openaiProvider.completionModel(modelId);
    },
    embeddingModel(modelId) {
      return openaiProvider.embeddingModel(modelId);
    },
    imageModel(modelId) {
      return openaiProvider.imageModel(modelId);
    },
    textEmbeddingModel(modelId) {
      return openaiProvider.textEmbeddingModel(modelId);
    },
  };
}
