export function isClaudeModel(model) {
  return typeof model === "string" && model.toLowerCase().includes("claude");
}

function isSonnet46(model) {
  if (typeof model !== "string") return false;
  const m = model.toLowerCase();
  return m.includes("sonnet") && (m.includes("4.6") || m.includes("4-6"));
}

function isOpus47(model) {
  if (typeof model !== "string") return false;
  const m = model.toLowerCase();
  return m.includes("opus") && (m.includes("4.7") || m.includes("4-7"));
}

export function fixClaudeCacheControl(body) {
  if (!body.messages?.length) return body;
  const skipUserBreakpoints = isSonnet46(body.model);
  const systemIndices = [];
  for (let i = 0; i < body.messages.length; i++) {
    if (body.messages[i].role === "system") {
      systemIndices.push(i);
    }
  }
  if (systemIndices.length === 0) return body;
  const lastSystemIndex = systemIndices[systemIndices.length - 1];
  let messages = body.messages.map((msg, i) => {
    if (msg.role !== "system" || i !== lastSystemIndex) return msg;
    if (typeof msg.content === "string") {
      return {
        ...msg,
        content: [
          {
            type: "text",
            text: msg.content,
            cache_control: { type: "ephemeral" },
          },
        ],
      };
    }
    if (Array.isArray(msg.content) && msg.content.length > 0) {
      const parts = [...msg.content];
      const last = { ...parts[parts.length - 1] };
      if (!last.cache_control) {
        last.cache_control = { type: "ephemeral" };
        parts[parts.length - 1] = last;
        return { ...msg, content: parts };
      }
    }
    return msg;
  });
  const nonAssistantIndices = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "system" && messages[i].role !== "assistant") {
      nonAssistantIndices.push(i);
    }
  }
  const lastNonAssistantIndex = nonAssistantIndices.length > 0 ? nonAssistantIndices[nonAssistantIndices.length - 1] : -1;
  const prevNonAssistantIndex = nonAssistantIndices.length > 1 ? nonAssistantIndices[nonAssistantIndices.length - 2] : -1;
  if (!skipUserBreakpoints && lastNonAssistantIndex >= 0) {
    messages = [...messages];
    const msg = messages[lastNonAssistantIndex];
    if (typeof msg.content === "string" && msg.content.length > 0) {
      messages[lastNonAssistantIndex] = {
        ...msg,
        content: [
          {
            type: "text",
            text: msg.content,
            cache_control: { type: "ephemeral" },
          },
        ],
      };
    } else if (Array.isArray(msg.content) && msg.content.length > 0) {
      const parts = [...msg.content];
      const last = { ...parts[parts.length - 1] };
      const isEmpty =
        (last.type === "text" && (!last.text || last.text.length === 0)) ||
        (last.type === "tool_result" &&
          Array.isArray(last.content) &&
          last.content.length > 0 &&
          last.content.every((c) => c.type === "text" && (!c.text || c.text.length === 0)));
      if (!last.cache_control && !isEmpty) {
        last.cache_control = { type: "ephemeral" };
        parts[parts.length - 1] = last;
        messages[lastNonAssistantIndex] = { ...msg, content: parts };
      }
    }
  }
  if (!skipUserBreakpoints && prevNonAssistantIndex >= 0) {
    messages = [...messages];
    const msg = messages[prevNonAssistantIndex];
    if (typeof msg.content === "string" && msg.content.length > 0) {
      messages[prevNonAssistantIndex] = {
        ...msg,
        content: [
          {
            type: "text",
            text: msg.content,
            cache_control: { type: "ephemeral" },
          },
        ],
      };
    } else if (Array.isArray(msg.content) && msg.content.length > 0) {
      const parts = [...msg.content];
      const last = { ...parts[parts.length - 1] };
      if (!last.cache_control) {
        last.cache_control = { type: "ephemeral" };
        parts[parts.length - 1] = last;
        messages[prevNonAssistantIndex] = { ...msg, content: parts };
      }
    }
  }
  let result = { ...body, messages };
  if (result.tools?.length) {
    const tools = [...result.tools];
    const lastTool = { ...tools[tools.length - 1] };
    if (lastTool.function) {
      lastTool.function = {
        ...lastTool.function,
        cache_control: { type: "ephemeral" },
      };
      tools[tools.length - 1] = lastTool;
      result = { ...result, tools };
    }
  }
  return result;
}

export function fixClaudeRequest(body) {
  if (isOpus47(body.model) && body.temperature !== undefined) {
    const { temperature, ...rest } = body;
    body = rest;
  }
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
  const { temperature, ...bodyWithoutTemp } = body;
  const result = { ...bodyWithoutTemp, thinking };
  if (thinking.budget_tokens && result.max_tokens && result.max_tokens <= thinking.budget_tokens) {
    result.max_tokens = thinking.budget_tokens + 4096;
  }
  return { body: result, hadThinking: true };
}

export function fixClaudeStream(text) {
  return text.replace(/data: ({.*})\n/g, (match, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr);
      let changed = false;
      if (parsed.choices) {
        for (const choice of parsed.choices) {
          if (choice.finish_reason === "end_turn") {
            choice.finish_reason = "stop";
            changed = true;
          }
        }
      }
      if (parsed.usage) {
        const cachedTokens = parsed.usage.prompt_tokens_details?.cached_tokens || 0;
        if (cachedTokens > 0) {
          parsed.usage.prompt_tokens = (parsed.usage.prompt_tokens || 0) + cachedTokens;
          changed = true;
        }
      }
      if (changed) {
        return "data: " + JSON.stringify(parsed) + "\n";
      }
    } catch {}
    return match;
  });
}

