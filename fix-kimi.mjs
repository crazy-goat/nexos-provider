export function isKimiModel(model) {
  return typeof model === "string" && model.toLowerCase().includes("kimi");
}

export function fixKimiStream(text) {
  return text;
}

export async function bufferKimiStream(response, fixStreamChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const chunks = [];
  let lastChunk = null;
  let sawDone = false;
  let sawUsage = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: {")) {
        try {
          const jsonStr = line.slice(6);
          const parsed = JSON.parse(jsonStr);
          if (parsed.id) lastChunk = parsed;
          if (parsed.usage) sawUsage = true;
        } catch {}
      }
      if (line.includes("[DONE]")) sawDone = true;
    }
    const fixed = fixStreamChunk ? fixStreamChunk(text) : text;
    chunks.push(fixed);
  }

  let suffix = "";

  if (!sawUsage && lastChunk) {
    const usageChunk = {
      object: "chat.completion.chunk",
      id: lastChunk.id,
      created: lastChunk.created,
      model: lastChunk.model,
      choices: [],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
    suffix += `data: ${JSON.stringify(usageChunk)}\n\n`;
  }

  if (!sawDone) {
    suffix += "data: [DONE]\n\n";
  }

  const allData = chunks.join("") + suffix;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(allData));
      controller.close();
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
