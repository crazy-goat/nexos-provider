export function isCodexModel(model) {
  return typeof model === "string" && /codex/i.test(model);
}

export function convertChatToResponsesRequest(body) {
  const result = { model: body.model, stream: !!body.stream };

  if (body.tools?.length) {
    result.tools = body.tools.map((tool) => {
      if (tool.type !== "function" || !tool.function) return tool;
      return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description || "",
        parameters: tool.function.parameters || {},
      };
    });
  }

  if (body.tool_choice) result.tool_choice = body.tool_choice;
  if (body.max_tokens) result.max_output_tokens = body.max_tokens;
  if (body.max_completion_tokens) result.max_output_tokens = body.max_completion_tokens;
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.parallel_tool_calls !== undefined) result.parallel_tool_calls = body.parallel_tool_calls;
  if (body.reasoning_effort && body.reasoning_effort !== "none") {
    result.reasoning = { effort: body.reasoning_effort };
  }

  const input = [];
  let instructions = null;

  for (const msg of body.messages || []) {
    if (msg.role === "system" || msg.role === "developer") {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p) => p.text || "").join("\n")
          : "";
      instructions = instructions ? instructions + "\n" + text : text;
      continue;
    }

    if (msg.role === "user") {
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p) => p.text || "").join("\n")
          : "";
      input.push({ type: "message", role: "user", content });
      continue;
    }

    if (msg.role === "assistant") {
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          input.push({
            type: "function_call",
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
      }
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p) => p.text || "").join("")
          : null;
      if (content) {
        input.push({ type: "message", role: "assistant", content });
      }
      continue;
    }

    if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: msg.tool_call_id,
        output: typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
      });
      continue;
    }
  }

  if (instructions) result.instructions = instructions;
  result.input = input;

  return result;
}

function buildChatCompletionsChunk(id, model, delta, finishReason, usage) {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: delta || {},
        finish_reason: finishReason || null,
      },
    ],
  };
  if (usage) chunk.usage = usage;
  return chunk;
}

export function createResponsesStreamConverter(requestId, model) {
  const encoder = new TextEncoder();
  let sentRole = false;
  let currentToolCalls = {};
  let toolCallIndex = 0;
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part.split("\n");
        let jsonStr = null;
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            jsonStr = line.slice(6).trim();
          }
        }
        if (!jsonStr || jsonStr === "[DONE]") continue;

        let event;
        try {
          event = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const type = event.type;

        if (type === "response.output_item.added" && event.item?.type === "message" && !sentRole) {
          const cc = buildChatCompletionsChunk(requestId, model, { role: "assistant", content: "" }, null);
          controller.enqueue(encoder.encode("data: " + JSON.stringify(cc) + "\n\n"));
          sentRole = true;
        }

        if (type === "response.output_text.delta") {
          if (!sentRole) {
            const roleChunk = buildChatCompletionsChunk(requestId, model, { role: "assistant", content: "" }, null);
            controller.enqueue(encoder.encode("data: " + JSON.stringify(roleChunk) + "\n\n"));
            sentRole = true;
          }
          const cc = buildChatCompletionsChunk(requestId, model, { content: event.delta }, null);
          controller.enqueue(encoder.encode("data: " + JSON.stringify(cc) + "\n\n"));
        }

        if (type === "response.output_item.added" && event.item?.type === "function_call") {
          const idx = toolCallIndex++;
          currentToolCalls[event.item.id] = idx;
          const cc = buildChatCompletionsChunk(requestId, model, {
            tool_calls: [{
              index: idx,
              id: event.item.call_id,
              type: "function",
              function: { name: event.item.name, arguments: "" },
            }],
          }, null);
          controller.enqueue(encoder.encode("data: " + JSON.stringify(cc) + "\n\n"));
        }

        if (type === "response.function_call_arguments.delta") {
          const idx = currentToolCalls[event.item_id] ?? 0;
          const cc = buildChatCompletionsChunk(requestId, model, {
            tool_calls: [{
              index: idx,
              function: { arguments: event.delta },
            }],
          }, null);
          controller.enqueue(encoder.encode("data: " + JSON.stringify(cc) + "\n\n"));
        }

        if (type === "response.completed") {
          const resp = event.response;
          const hasToolCalls = resp?.output?.some((o) => o.type === "function_call");
          const finishReason = hasToolCalls ? "tool_calls" : "stop";

          const usage = resp?.usage ? {
            prompt_tokens: resp.usage.input_tokens || 0,
            completion_tokens: resp.usage.output_tokens || 0,
            total_tokens: resp.usage.total_tokens || 0,
            prompt_tokens_details: {
              cached_tokens: resp.usage.input_tokens_details?.cached_tokens || 0,
            },
            completion_tokens_details: {
              reasoning_tokens: resp.usage.output_tokens_details?.reasoning_tokens || 0,
            },
          } : undefined;

          const cc = buildChatCompletionsChunk(requestId, model, {}, finishReason, usage);
          controller.enqueue(encoder.encode("data: " + JSON.stringify(cc) + "\n\n"));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === "response.completed") {
              const resp = event.response;
              const hasToolCalls = resp?.output?.some((o) => o.type === "function_call");
              const finishReason = hasToolCalls ? "tool_calls" : "stop";
              const usage = resp?.usage ? {
                prompt_tokens: resp.usage.input_tokens || 0,
                completion_tokens: resp.usage.output_tokens || 0,
                total_tokens: resp.usage.total_tokens || 0,
              } : undefined;
              const cc = buildChatCompletionsChunk(requestId, model, {}, finishReason, usage);
              controller.enqueue(encoder.encode("data: " + JSON.stringify(cc) + "\n\n"));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            }
          } catch {}
        }
      }
    },
  });
}
