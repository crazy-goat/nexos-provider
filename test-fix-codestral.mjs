import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCodestralModel, fixCodestralRequest, fixCodestralStream } from "./fix-codestral.mjs";

describe("isCodestralModel", () => {
  it("detects Codestral models", () => {
    assert.equal(isCodestralModel("codestral-2508"), true);
    assert.equal(isCodestralModel("Codestral Latest"), true);
  });

  it("rejects non-Codestral models", () => {
    assert.equal(isCodestralModel("GPT 5"), false);
    assert.equal(isCodestralModel("Claude Sonnet 4.5"), false);
  });

  it("handles non-string input", () => {
    assert.equal(isCodestralModel(null), false);
    assert.equal(isCodestralModel(undefined), false);
  });
});

describe("fixCodestralRequest", () => {
  it("sets strict to false when null", () => {
    const body = {
      tools: [{
        type: "function",
        function: { name: "test", strict: null },
      }],
    };
    const result = fixCodestralRequest(body);
    assert.equal(result.tools[0].function.strict, false);
  });

  it("sets strict to false when undefined", () => {
    const body = {
      tools: [{
        type: "function",
        function: { name: "test" },
      }],
    };
    const result = fixCodestralRequest(body);
    assert.equal(result.tools[0].function.strict, false);
  });

  it("preserves strict when already boolean", () => {
    const body = {
      tools: [{
        type: "function",
        function: { name: "test", strict: true },
      }],
    };
    const result = fixCodestralRequest(body);
    assert.equal(result.tools[0].function.strict, true);
  });

  it("passes through body without tools", () => {
    const body = { model: "codestral-2508", messages: [] };
    const result = fixCodestralRequest(body);
    assert.deepEqual(result, body);
  });
});

describe("fixCodestralStream", () => {
  it("passes through text unchanged", () => {
    const input = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n';
    assert.equal(fixCodestralStream(input), input);
  });
});
