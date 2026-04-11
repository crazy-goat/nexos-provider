import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isKimiModel, createKimiStreamTransform } from "./fix-kimi.mjs";

function makeSSEStream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function pipeThrough(chunks, fixStreamChunk) {
  const stream = makeSSEStream(chunks);
  const transform = createKimiStreamTransform(fixStreamChunk);
  const result = stream.pipeThrough(transform);
  const reader = result.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("isKimiModel", () => {
  it("detects Kimi models case-insensitively", () => {
    assert.equal(isKimiModel("Kimi K2.5"), true);
    assert.equal(isKimiModel("kimi-k2"), true);
    assert.equal(isKimiModel("KIMI"), true);
  });

  it("rejects non-Kimi models", () => {
    assert.equal(isKimiModel("Claude Sonnet 4.5"), false);
    assert.equal(isKimiModel("GPT 5"), false);
    assert.equal(isKimiModel("Gemini 2.5 Pro"), false);
  });

  it("handles non-string input", () => {
    assert.equal(isKimiModel(null), false);
    assert.equal(isKimiModel(undefined), false);
    assert.equal(isKimiModel(42), false);
  });
});

describe("createKimiStreamTransform", () => {
  it("adds [DONE] when missing", async () => {
    const text = await pipeThrough([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"4"}}]}\n\n',
    ]);
    assert.ok(text.includes("data: [DONE]"));
  });

  it("does not duplicate [DONE] when already present", async () => {
    const text = await pipeThrough([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"4"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const doneCount = (text.match(/\[DONE\]/g) || []).length;
    assert.equal(doneCount, 1);
  });

  it("adds usage chunk when missing", async () => {
    const text = await pipeThrough([
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1234,"model":"kimi-k2","choices":[{"delta":{"content":"4"}}]}\n\n',
    ]);
    assert.ok(text.includes('"usage"'));
    assert.ok(text.includes('"prompt_tokens"'));
  });

  it("does not add usage chunk when already present", async () => {
    const text = await pipeThrough([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"4"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
    ]);
    const usageCount = (text.match(/"usage"/g) || []).length;
    assert.equal(usageCount, 1);
  });

  it("applies fixStreamChunk when provided", async () => {
    let fixCalled = false;
    const mockFix = (text) => { fixCalled = true; return text.replace("test", "fixed"); };

    const text = await pipeThrough([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"test"}}]}\n\n',
    ], mockFix);

    assert.ok(fixCalled);
    assert.ok(text.includes("fixed"));
  });

  it("handles multi-chunk streaming correctly", async () => {
    const text = await pipeThrough([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"The"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":" answer"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":" is 4"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"finish_reason":"stop","delta":{}}]}\n\n',
    ]);
    assert.ok(text.includes('"content":"The"'));
    assert.ok(text.includes('"content":" answer"'));
    assert.ok(text.includes("[DONE]"));
    const theCount = (text.match(/"content":"The"/g) || []).length;
    assert.equal(theCount, 1);
  });

  it("handles empty stream", async () => {
    const text = await pipeThrough([]);
    assert.ok(text.includes("[DONE]"));
  });

  it("uses last chunk metadata for usage chunk", async () => {
    const text = await pipeThrough([
      'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":9999,"model":"kimi-k2.5","choices":[{"delta":{"content":"x"}}]}\n\n',
    ]);
    const lines = text.split("\n").filter((l) => l.startsWith("data: {"));
    const usageLine = lines.find((l) => l.includes('"usage"'));
    assert.ok(usageLine);
    const parsed = JSON.parse(usageLine.slice(6));
    assert.equal(parsed.id, "chatcmpl-abc");
    assert.equal(parsed.model, "kimi-k2.5");
  });
});
