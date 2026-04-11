export function isKimiModel(model) {
  if (typeof model !== "string") return false;
  const m = model.toLowerCase();
  return m.includes("kimi") || m.includes("glm");
}

export function createKimiStreamTransform(fixStreamChunk) {
  const encoder = new TextEncoder();
  let buffer = "";
  let sawDone = false;
  let sawUsage = false;
  let lastChunk = null;

  return new TransformStream({
    transform(chunk, controller) {
      buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        if (part.includes("[DONE]")) sawDone = true;
        if (part.startsWith("data: {")) {
          try {
            const parsed = JSON.parse(part.slice(6));
            if (parsed.id) lastChunk = parsed;
            if (parsed.usage) sawUsage = true;
          } catch {}
        }
        const fixed = fixStreamChunk ? fixStreamChunk(part + "\n") : part + "\n";
        controller.enqueue(encoder.encode(fixed + "\n"));
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        if (buffer.includes("[DONE]")) sawDone = true;
        if (buffer.startsWith("data: {")) {
          try {
            const parsed = JSON.parse(buffer.slice(6));
            if (parsed.id) lastChunk = parsed;
            if (parsed.usage) sawUsage = true;
          } catch {}
        }
        const fixed = fixStreamChunk ? fixStreamChunk(buffer + "\n") : buffer + "\n";
        controller.enqueue(encoder.encode(fixed + "\n"));
      }
      if (!sawUsage && lastChunk) {
        const usageChunk = {
          object: "chat.completion.chunk",
          id: lastChunk.id,
          created: lastChunk.created,
          model: lastChunk.model,
          choices: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(usageChunk)}\n\n`));
      }
      if (!sawDone) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
    },
  });
}
