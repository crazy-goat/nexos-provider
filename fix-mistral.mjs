export function isMistralModel(model) {
  return typeof model === "string" && 
    (model.toLowerCase().includes("mistral") || 
     model.toLowerCase().includes("codestral"));
}

export function fixMistralRequest(body) {
  if (!body.tools?.length) return body;
  return {
    ...body,
    tools: body.tools.map((tool) => {
      if (tool.type !== "function" || !tool.function) return tool;
      const fn = { ...tool.function };
      if (fn.strict === null || fn.strict === undefined) {
        fn.strict = false;
      }
      return { ...tool, function: fn };
    }),
  };
}

export function fixMistralStream(text) {
  return text;
}
