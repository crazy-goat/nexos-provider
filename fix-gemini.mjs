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

export function isGeminiModel(model) {
  return typeof model === "string" && model.toLowerCase().includes("gemini");
}

export function fixGeminiRequest(body) {
  if (body.tools) {
    body = fixToolSchemas(body);
  }
  return body;
}

export function fixGeminiThinkingRequest(body) {
  if (!body.thinking) return { body, hadThinking: false };
  if (body.thinking.type === "disabled") {
    const { thinking, ...rest } = body;
    return { body: rest, hadThinking: true };
  }
  const thinking = { ...body.thinking };
  if (thinking.budgetTokens !== undefined && thinking.budget_tokens === undefined) {
    thinking.budget_tokens = thinking.budgetTokens;
    delete thinking.budgetTokens;
  }
  const result = { ...body, thinking };
  if (thinking.budget_tokens && result.max_tokens && result.max_tokens <= thinking.budget_tokens) {
    result.max_tokens = thinking.budget_tokens + 4096;
  }
  return { body: result, hadThinking: true };
}

export function fixGeminiStream(text) {
  return text.replace(/data: ({.*})\n/g, (match, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr);
      let changed = false;
      if (parsed.choices) {
        for (const choice of parsed.choices) {
          if (choice.finish_reason === "STOP") {
            choice.finish_reason = "stop";
            changed = true;
          }
          if (choice.finish_reason === "stop" && choice.delta?.tool_calls?.length) {
            choice.finish_reason = "tool_calls";
            changed = true;
          }
          const blocks = choice.delta?.content_blocks;
          if (blocks?.length) {
            for (const block of blocks) {
              if (block.delta?.thinking) {
                choice.delta.reasoning_content = block.delta.thinking;
                changed = true;
              }
            }
            delete choice.delta.content_blocks;
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
