import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fixChatGPTRequest, fixChatGPTStream, isLegacyChatGPTModel } from "./fix-chatgpt.mjs";

describe("isLegacyChatGPTModel", () => {
  it("detects GPT 4.x as legacy", () => {
    for (const m of ["GPT 4.1", "GPT 4o", "gpt-4.1-mini-2025-04-14"]) {
      assert.equal(isLegacyChatGPTModel(m), true, `expected legacy: ${m}`);
    }
  });

  it("detects Chat / Instant / oss suffixes as legacy", () => {
    for (const m of ["GPT 5.2 Chat", "GPT 5.3 Instant", "gpt-oss-120b"]) {
      assert.equal(isLegacyChatGPTModel(m), true, `expected legacy: ${m}`);
    }
  });

  it("treats modern GPT 5/5.2/5.4 as non-legacy", () => {
    for (const m of ["GPT 5", "GPT 5.2", "GPT 5.4", "GPT 5.4 mini", "GPT 5.4 nano", "gpt-5-mini-2025-08-07"]) {
      assert.equal(isLegacyChatGPTModel(m), false, `expected modern: ${m}`);
    }
  });
});

describe("fixChatGPTRequest", () => {
  it("strips reasoning_effort=none for legacy models (GPT 4.x, Chat, Instant, oss)", () => {
    for (const model of ["GPT 4.1", "GPT 4o", "GPT 5.2 Chat", "GPT 5.3 Instant", "gpt-oss-120b"]) {
      const body = { model, reasoning_effort: "none", messages: [] };
      const result = fixChatGPTRequest(body);
      assert.equal(result.reasoning_effort, undefined, `should strip for ${model}`);
    }
  });

  it("preserves reasoning_effort=none for modern reasoning models (upstream accepts it)", () => {
    for (const model of ["GPT 5", "GPT 5.2", "GPT 5.4", "GPT 5.4 mini"]) {
      const body = { model, reasoning_effort: "none", messages: [] };
      const result = fixChatGPTRequest(body);
      assert.equal(result.reasoning_effort, "none", `should preserve for ${model}`);
    }
  });

  it("preserves reasoning_effort=low/high regardless of model", () => {
    for (const effort of ["low", "high"]) {
      for (const model of ["GPT 5", "GPT 4.1"]) {
        const body = { model, reasoning_effort: effort, messages: [] };
        const result = fixChatGPTRequest(body);
        assert.equal(result.reasoning_effort, effort);
      }
    }
  });

  it("strips temperature=false for any GPT model", () => {
    const body = { model: "GPT 5", temperature: false, messages: [] };
    const result = fixChatGPTRequest(body);
    assert.equal(result.temperature, undefined);
  });

  it("passes through body without reasoning_effort or temperature", () => {
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
