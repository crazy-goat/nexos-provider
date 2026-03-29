import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isKimiModel, fixKimiStream, bufferKimiStream } from "./fix-kimi.mjs";

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

function makeResponse(chunks, status = 200) {
  return new Response(makeSSEStream(chunks), {
    status,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/event-stream" }),
  });
}

async function readStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
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

describe("fixKimiStream", () => {
  it("passes through text unchanged", () => {
    const input = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n';
    assert.equal(fixKimiStream(input), input);
  });
});

describe("bufferKimiStream", () => {
  it("adds [DONE] when missing", async () => {
    const response = makeResponse([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"4"}}]}\n\n',
    ]);

    const fixed = await bufferKimiStream(response);
    const text = await readStream(fixed);

    assert.ok(text.includes("data: [DONE]"), "should contain [DONE]");
  });

  it("does not duplicate [DONE] when already present", async () => {
    const response = makeResponse([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"4"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const fixed = await bufferKimiStream(response);
    const text = await readStream(fixed);

    const doneCount = (text.match(/\[DONE\]/g) || []).length;
    assert.equal(doneCount, 1, "should have exactly one [DONE]");
  });

  it("adds usage chunk when missing", async () => {
    const response = makeResponse([
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1234,"model":"kimi-k2","choices":[{"delta":{"content":"4"}}]}\n\n',
    ]);

    const fixed = await bufferKimiStream(response);
    const text = await readStream(fixed);

    assert.ok(text.includes('"usage"'), "should contain usage chunk");
    assert.ok(text.includes('"prompt_tokens"'), "should have prompt_tokens");
    assert.ok(text.includes('"completion_tokens"'), "should have completion_tokens");
  });

  it("does not add usage chunk when already present", async () => {
    const response = makeResponse([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"4"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
    ]);

    const fixed = await bufferKimiStream(response);
    const text = await readStream(fixed);

    const usageCount = (text.match(/"usage"/g) || []).length;
    assert.equal(usageCount, 1, "should have exactly one usage chunk");
  });

  it("preserves response status and headers", async () => {
    const response = makeResponse([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"hi"}}]}\n\n',
    ]);

    const fixed = await bufferKimiStream(response);

    assert.equal(fixed.status, 200);
    assert.equal(fixed.headers.get("content-type"), "text/event-stream");
  });

  it("applies fixStreamChunk when provided", async () => {
    const response = makeResponse([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"test"}}]}\n\n',
    ]);

    let fixCalled = false;
    const mockFix = (text) => {
      fixCalled = true;
      return text.replace("test", "fixed");
    };

    const fixed = await bufferKimiStream(response, mockFix);
    const text = await readStream(fixed);

    assert.ok(fixCalled, "fixStreamChunk should be called");
    assert.ok(text.includes("fixed"), "should contain fixed text");
    assert.ok(!text.includes('"content":"test"'), "should not contain original text");
  });

  it("produces stream that is consumed exactly once", async () => {
    const response = makeResponse([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"4"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":""}}]}\n\n',
    ]);

    const fixed = await bufferKimiStream(response);
    const text = await readStream(fixed);

    const contentMatches = text.match(/"content":"4"/g) || [];
    assert.equal(contentMatches.length, 1, "content '4' should appear exactly once");
  });

  it("handles multi-chunk streaming correctly", async () => {
    const response = makeResponse([
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":"The"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":" answer"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":" is"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"delta":{"content":" 4"}}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","model":"kimi","choices":[{"finish_reason":"stop","delta":{}}]}\n\n',
    ]);

    const fixed = await bufferKimiStream(response);
    const text = await readStream(fixed);

    assert.ok(text.includes('"content":"The"'), "should have 'The'");
    assert.ok(text.includes('"content":" answer"'), "should have ' answer'");
    assert.ok(text.includes('"content":" is"'), "should have ' is'");
    assert.ok(text.includes('"content":" 4"'), "should have ' 4'");
    assert.ok(text.includes("[DONE]"), "should have [DONE]");

    const theCount = (text.match(/"content":"The"/g) || []).length;
    assert.equal(theCount, 1, "each content chunk should appear exactly once");
  });

  it("handles empty stream", async () => {
    const response = makeResponse([]);
    const fixed = await bufferKimiStream(response);
    const text = await readStream(fixed);

    assert.ok(text.includes("[DONE]"), "should still add [DONE]");
  });

  it("uses last chunk metadata for usage chunk", async () => {
    const response = makeResponse([
      'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":9999,"model":"kimi-k2.5","choices":[{"delta":{"content":"x"}}]}\n\n',
    ]);

    const fixed = await bufferKimiStream(response);
    const text = await readStream(fixed);

    const lines = text.split("\n").filter((l) => l.startsWith("data: {"));
    const usageLine = lines.find((l) => l.includes('"usage"'));
    assert.ok(usageLine, "should have usage line");

    const parsed = JSON.parse(usageLine.slice(6));
    assert.equal(parsed.id, "chatcmpl-abc");
    assert.equal(parsed.created, 9999);
    assert.equal(parsed.model, "kimi-k2.5");
  });
});
