import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCodexModel, convertChatToResponsesRequest } from "./fix-codex.mjs";

describe("isCodexModel", () => {
  it("detects Codex models", () => {
    assert.equal(isCodexModel("GPT 5.3 Codex"), true);
    assert.equal(isCodexModel("codex-mini"), true);
  });

  it("rejects non-Codex models", () => {
    assert.equal(isCodexModel("GPT 5"), false);
    assert.equal(isCodexModel("GPT 5.3 Instant"), false);
    assert.equal(isCodexModel("Claude Sonnet 4.5"), false);
  });

  it("handles non-string input", () => {
    assert.equal(isCodexModel(null), false);
    assert.equal(isCodexModel(undefined), false);
  });
});

describe("convertChatToResponsesRequest", () => {
  it("converts basic chat request to responses format", () => {
    const body = {
      model: "GPT 5.3 Codex",
      stream: true,
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ],
      max_tokens: 4096,
    };

    const result = convertChatToResponsesRequest(body);
    assert.equal(result.model, "GPT 5.3 Codex");
    assert.equal(result.stream, true);
    assert.equal(result.instructions, "You are helpful");
    assert.equal(result.max_output_tokens, 4096);
    assert.equal(result.input.length, 1);
    assert.equal(result.input[0].type, "message");
    assert.equal(result.input[0].role, "user");
    assert.equal(result.input[0].content, "Hello");
  });

  it("converts tool calls in assistant messages", () => {
    const body = {
      model: "GPT 5.3 Codex",
      messages: [
        { role: "user", content: "List files" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "bash", arguments: '{"cmd":"ls"}' },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: "file1.txt\nfile2.txt",
        },
      ],
    };

    const result = convertChatToResponsesRequest(body);
    assert.equal(result.input.length, 3);
    assert.equal(result.input[0].type, "message");
    assert.equal(result.input[1].type, "function_call");
    assert.equal(result.input[1].call_id, "call_1");
    assert.equal(result.input[1].name, "bash");
    assert.equal(result.input[2].type, "function_call_output");
    assert.equal(result.input[2].call_id, "call_1");
    assert.equal(result.input[2].output, "file1.txt\nfile2.txt");
  });

  it("converts tools to responses format", () => {
    const body = {
      model: "GPT 5.3 Codex",
      messages: [{ role: "user", content: "Hi" }],
      tools: [{
        type: "function",
        function: {
          name: "bash",
          description: "Run a command",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
        },
      }],
    };

    const result = convertChatToResponsesRequest(body);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].type, "function");
    assert.equal(result.tools[0].name, "bash");
    assert.equal(result.tools[0].description, "Run a command");
  });

  it("strips reasoning_effort none", () => {
    const body = {
      model: "GPT 5.3 Codex",
      messages: [{ role: "user", content: "Hi" }],
      reasoning_effort: "none",
    };

    const result = convertChatToResponsesRequest(body);
    assert.equal(result.reasoning, undefined);
  });

  it("converts reasoning_effort to reasoning object", () => {
    const body = {
      model: "GPT 5.3 Codex",
      messages: [{ role: "user", content: "Hi" }],
      reasoning_effort: "high",
    };

    const result = convertChatToResponsesRequest(body);
    assert.deepEqual(result.reasoning, { effort: "high" });
  });

  it("merges multiple system messages", () => {
    const body = {
      model: "GPT 5.3 Codex",
      messages: [
        { role: "system", content: "Line 1" },
        { role: "developer", content: "Line 2" },
        { role: "user", content: "Hello" },
      ],
    };

    const result = convertChatToResponsesRequest(body);
    assert.equal(result.instructions, "Line 1\nLine 2");
  });
});
