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
