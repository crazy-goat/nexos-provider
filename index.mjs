import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isGeminiModel, fixGeminiRequest, fixGeminiThinkingRequest, fixGeminiStream } from "./fix-gemini.mjs";
import { isClaudeModel, fixClaudeCacheControl, fixClaudeRequest, fixClaudeStream } from "./fix-claude.mjs";
import { fixChatGPTRequest, fixChatGPTStream } from "./fix-chatgpt.mjs";
import { isCodestralModel, fixCodestralRequest, fixCodestralStream } from "./fix-codestral.mjs";
import { isCodexModel, convertChatToResponsesRequest, createResponsesStreamConverter } from "./fix-codex.mjs";

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

    const claude = isClaudeModel(requestBody.model);
    if (claude) {
      requestBody = fixClaudeCacheControl(requestBody);
      needsStreamFix = true;
      bodyChanged = true;
    }

    const claudeResult = fixClaudeRequest(requestBody);
    requestBody = claudeResult.body;

    const beforeChatGPT = requestBody;
    requestBody = fixChatGPTRequest(requestBody);
    const chatgptChanged = requestBody !== beforeChatGPT;

    if (gemini || codestral || claude || claudeResult.hadThinking || chatgptChanged) {
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
