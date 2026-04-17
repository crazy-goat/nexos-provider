export function isChatGPTModel(model) {
  return typeof model === "string" && /^(gpt|chatgpt)/i.test(model);
}

// Non-reasoning GPT variants (reject reasoning_effort with "Reasoning is not enabled").
// Modern GPT 5/5.2/5.4 reasoning models accept reasoning_effort:"none" natively.
export function isLegacyChatGPTModel(model) {
  if (typeof model !== "string") return false;
  if (/gpt[-\s]?4/i.test(model)) return true;
  if (/\bchat\b/i.test(model)) return true;
  if (/\binstant\b/i.test(model)) return true;
  if (/gpt-?oss/i.test(model)) return true;
  return false;
}

export function fixChatGPTRequest(body) {
  let result = body;
  if (result.reasoning_effort === "none" && isLegacyChatGPTModel(result.model)) {
    const { reasoning_effort, ...rest } = result;
    result = rest;
  }
  // Only strip temperature if it's false (invalid value), not for all values
  if (result.temperature === false) {
    const { temperature, ...rest } = result;
    result = rest;
  }
  return result;
}

export function fixChatGPTTemperature(body) {
  // GPT models through nexos.ai only support default temperature (1)
  // Strip any custom temperature values
  if (body.temperature !== undefined) {
    const { temperature, ...rest } = body;
    return rest;
  }
  return body;
}

export function fixChatGPTStream(text) {
  return text;
}
