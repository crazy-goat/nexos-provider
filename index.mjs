import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

function resolveRefs(schema, defs) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((s) => resolveRefs(s, defs));

  if (schema.$ref || schema.ref) {
    const refName = (schema.$ref || schema.ref)
      .replace(/^#\/\$defs\//, "")
      .replace(/^#\/definitions\//, "");
    const resolved = defs?.[refName];
    if (resolved) {
      const merged = { ...resolveRefs(resolved, defs) };
      if (schema.description) merged.description = schema.description;
      if (schema.default !== undefined) merged.default = schema.default;
      return merged;
    }
  }

  const result = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "$defs" || k === "definitions" || k === "$ref" || k === "ref")
      continue;
    result[k] = resolveRefs(v, defs);
  }
  return result;
}

function fixToolSchemas(body) {
  if (!body.tools?.length) return body;
  return {
    ...body,
    tools: body.tools.map((tool) => {
      if (tool.type !== "function" || !tool.function?.parameters) return tool;
      const params = tool.function.parameters;
      const defs = params.$defs || params.definitions || {};
      return {
        ...tool,
        function: {
          ...tool.function,
          parameters: resolveRefs(params, defs),
        },
      };
    }),
  };
}

function fixFinishReason(text) {
  return text.replace(/data: ({.*})\n/g, (match, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr);
      let changed = false;
      if (parsed.choices) {
        for (const choice of parsed.choices) {
          if (choice.finish_reason === "stop" && choice.delta?.tool_calls?.length) {
            choice.finish_reason = "tool_calls";
            changed = true;
          }
        }
      }
      if (changed) {
        return "data: " + JSON.stringify(parsed) + "\n";
      }
    } catch {}
    return match;
  });
}

function appendDoneToStream() {
  const encoder = new TextEncoder();
  let sawDone = false;

  return new TransformStream({
    transform(chunk, controller) {
      let text =
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      if (text.includes("[DONE]")) sawDone = true;
      text = fixFinishReason(text);
      controller.enqueue(encoder.encode(text));
    },
    flush(controller) {
      if (!sawDone) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
    },
  });
}

function isGeminiModel(model) {
  return typeof model === "string" && model.toLowerCase().includes("gemini");
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

    if (gemini) {
      if (requestBody.tools) {
        requestBody = fixToolSchemas(requestBody);
      }
      init = { ...init, body: JSON.stringify(requestBody) };
    }

    const response = await realFetch(url, init);

    if (gemini && requestBody.stream) {
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
