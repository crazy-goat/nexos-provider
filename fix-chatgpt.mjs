export function fixChatGPTRequest(body) {
  if (body.reasoning_effort === "none") {
    const { reasoning_effort, ...rest } = body;
    return rest;
  }
  return body;
}

export function fixChatGPTStream(text) {
  return text;
}
