import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fixChatGPTRequest, fixChatGPTStream } from "./fix-chatgpt.mjs";

describe("fixChatGPTRequest", () => {
  it("strips reasoning_effort when value is none", () => {
    const body = { model: "GPT 5", reasoning_effort: "none", messages: [] };
    const result = fixChatGPTRequest(body);
    assert.equal(result.reasoning_effort, undefined);
    assert.equal(result.model, "GPT 5");
  });

  it("preserves reasoning_effort when value is low", () => {
    const body = { model: "GPT 5", reasoning_effort: "low", messages: [] };
    const result = fixChatGPTRequest(body);
    assert.equal(result.reasoning_effort, "low");
  });

  it("preserves reasoning_effort when value is high", () => {
    const body = { model: "GPT 5", reasoning_effort: "high", messages: [] };
    const result = fixChatGPTRequest(body);
    assert.equal(result.reasoning_effort, "high");
  });

  it("passes through body without reasoning_effort", () => {
    const body = { model: "GPT 5", messages: [] };
    const result = fixChatGPTRequest(body);
    assert.deepEqual(result, body);
  });
});

describe("fixChatGPTStream", () => {
  it("passes through text unchanged", () => {
    const input = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n';
    assert.equal(fixChatGPTStream(input), input);
  });
});
