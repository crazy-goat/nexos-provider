export function isChatGPTModel(model) {
  return typeof model === "string" && /^(gpt|chatgpt)/i.test(model);
}

export function fixChatGPTRequest(body) {
  let result = body;
  if (result.reasoning_effort === "none") {
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
