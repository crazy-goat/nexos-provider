const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$defs", "definitions", "$ref", "ref", "$schema",
  "exclusiveMinimum", "exclusiveMaximum",
  "patternProperties", "if", "then", "else", "not",
  "contentMediaType", "contentEncoding",
  "$id", "$anchor", "$comment",
]);

function resolveRefs(schema, defs, seen) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((s) => resolveRefs(s, defs, seen));

  if (schema.$ref || schema.ref) {
    const refName = (schema.$ref || schema.ref)
      .replace(/^#\/\$defs\//, "")
      .replace(/^#\/definitions\//, "");
    const resolving = seen || new Set();
    if (resolving.has(refName)) return {};
    resolving.add(refName);
    const resolved = defs?.[refName];
    if (resolved) {
      const merged = { ...resolveRefs(resolved, defs, resolving) };
      if (schema.description) merged.description = schema.description;
      if (schema.default !== undefined) merged.default = schema.default;
      return merged;
    }
  }

  const result = {};
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(k)) continue;
    result[k] = resolveRefs(v, defs, seen);
  }
  if (schema.exclusiveMinimum !== undefined && result.minimum === undefined) {
    result.minimum = schema.exclusiveMinimum;
  }
  if (schema.exclusiveMaximum !== undefined && result.maximum === undefined) {
    result.maximum = schema.exclusiveMaximum;
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

function isGemini3(model) {
  if (typeof model !== "string") return false;
  const m = model.toLowerCase();
  return m.includes("gemini") && (m.includes("3 ") || m.includes("3."));
}

function rewriteToolCallHistory(body) {
  if (!body.messages?.length) return body;
  const messages = [];
  let pendingToolCalls = {};
  for (const msg of body.messages) {
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        pendingToolCalls[tc.id] = tc.function;
      }
      const text = msg.content || "OK";
      messages.push({ role: "assistant", content: text });
    } else if (msg.role === "tool") {
      const fn = pendingToolCalls[msg.tool_call_id];
      const toolContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      if (fn) {
        let args = fn.arguments;
        try { args = JSON.stringify(JSON.parse(args)); } catch {}
        messages.push({ role: "user", content: `<tool_result name="${fn.name}" arguments='${args}'>\n${toolContent}\n</tool_result>` });
      } else {
        messages.push({ role: "user", content: toolContent });
      }
    } else {
      messages.push(msg);
    }
  }
  return { ...body, messages };
}

export function fixGeminiRequest(body) {
  if (body.tools) {
    body = fixToolSchemas(body);
  }
  if (isGemini3(body.model)) {
    body = rewriteToolCallHistory(body);
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
