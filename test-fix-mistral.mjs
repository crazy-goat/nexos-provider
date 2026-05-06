import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMistralModel, fixMistralRequest, fixMistralStream } from "./fix-mistral.mjs";

describe("isMistralModel", () => {
  it("detects Codestral models", () => {
    assert.equal(isMistralModel("codestral-2508"), true);
    assert.equal(isMistralModel("Codestral Latest"), true);
  });

  it("detects Mistral models", () => {
    assert.equal(isMistralModel("Mistral Medium 3.5"), true);
    assert.equal(isMistralModel("Mistral Small 4"), true);
    assert.equal(isMistralModel("mistral-large"), true);
  });

  it("rejects non-Mistral models", () => {
    assert.equal(isMistralModel("GPT 5"), false);
    assert.equal(isMistralModel("Claude Sonnet 4.5"), false);
    assert.equal(isMistralModel("Gemini 2.5 Pro"), false);
  });

  it("handles non-string input", () => {
    assert.equal(isMistralModel(null), false);
    assert.equal(isMistralModel(undefined), false);
  });
});

describe("fixMistralRequest", () => {
  it("sets strict to false when null", () => {
    const body = {
      tools: [{
        type: "function",
        function: { name: "test", strict: null },
      }],
    };
    const result = fixMistralRequest(body);
    assert.equal(result.tools[0].function.strict, false);
  });

  it("sets strict to false when undefined", () => {
    const body = {
      tools: [{
        type: "function",
        function: { name: "test" },
      }],
    };
    const result = fixMistralRequest(body);
    assert.equal(result.tools[0].function.strict, false);
  });

  it("preserves strict when already boolean", () => {
    const body = {
      tools: [{
        type: "function",
        function: { name: "test", strict: true },
      }],
    };
    const result = fixMistralRequest(body);
    assert.equal(result.tools[0].function.strict, true);
  });

  it("passes through body without tools", () => {
    const body = { model: "Mistral Medium 3.5", messages: [] };
    const result = fixMistralRequest(body);
    assert.deepEqual(result, body);
  });
});

describe("fixMistralStream", () => {
  it("passes through text unchanged", () => {
    const input = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n';
    assert.equal(fixMistralStream(input), input);
  });
});
