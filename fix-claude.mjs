export function isClaudeModel(model) {
  return typeof model === "string" && model.toLowerCase().includes("claude");
}

export function fixClaudeCacheControl(body) {
  if (!body.messages?.length) return body;
  const messages = body.messages.map((msg, i) => {
    if (msg.role !== "system") return msg;
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
      if (changed) {
        return "data: " + JSON.stringify(parsed) + "\n";
      }
    } catch {}
    return match;
  });
}
