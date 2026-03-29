import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isClaudeModel, fixClaudeCacheControl, fixClaudeRequest, fixClaudeStream, fixClaudeMessages } from "./fix-claude.mjs";

describe("isClaudeModel", () => {
  it("detects Claude models case-insensitively", () => {
    assert.equal(isClaudeModel("Claude Sonnet 4.5"), true);
    assert.equal(isClaudeModel("claude-opus-4.6"), true);
    assert.equal(isClaudeModel("CLAUDE 3.5"), true);
  });

  it("rejects non-Claude models", () => {
    assert.equal(isClaudeModel("Gemini 2.5 Pro"), false);
    assert.equal(isClaudeModel("GPT 5"), false);
    assert.equal(isClaudeModel("Kimi K2.5"), false);
  });

  it("handles non-string input", () => {
    assert.equal(isClaudeModel(null), false);
    assert.equal(isClaudeModel(undefined), false);
  });
});

describe("fixClaudeCacheControl", () => {
  it("adds cache_control to last system message string content", () => {
    const body = {
      messages: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello" },
      ],
    };

    const result = fixClaudeCacheControl(body);
    const sys = result.messages[0];
    assert.equal(Array.isArray(sys.content), true);
    assert.equal(sys.content[0].type, "text");
    assert.equal(sys.content[0].text, "You are a helpful assistant");
    assert.deepEqual(sys.content[0].cache_control, { type: "ephemeral" });
  });

  it("adds cache_control to last part of array system content", () => {
    const body = {
      messages: [
        {
          role: "system",
          content: [
            { type: "text", text: "Part 1" },
            { type: "text", text: "Part 2" },
          ],
        },
        { role: "user", content: "Hello" },
      ],
    };

    const result = fixClaudeCacheControl(body);
    const parts = result.messages[0].content;
    assert.equal(parts[0].cache_control, undefined);
    assert.deepEqual(parts[1].cache_control, { type: "ephemeral" });
  });

  it("adds cache_control to last non-assistant message", () => {
    const body = {
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User message" },
        { role: "assistant", content: "Response" },
      ],
    };

    const result = fixClaudeCacheControl(body);
    const user = result.messages[1];
    assert.equal(Array.isArray(user.content), true);
    assert.deepEqual(user.content[0].cache_control, { type: "ephemeral" });
  });

  it("adds cache_control to last tool function", () => {
    const body = {
      messages: [
        { role: "system", content: "System" },
        { role: "user", content: "Hello" },
      ],
      tools: [
        { type: "function", function: { name: "tool1" } },
        { type: "function", function: { name: "tool2" } },
      ],
    };

    const result = fixClaudeCacheControl(body);
    assert.equal(result.tools[0].function.cache_control, undefined);
    assert.deepEqual(result.tools[1].function.cache_control, { type: "ephemeral" });
  });

  it("passes through body without system messages", () => {
    const body = {
      messages: [{ role: "user", content: "Hello" }],
    };
    const result = fixClaudeCacheControl(body);
    assert.deepEqual(result, body);
  });

  it("passes through body without messages", () => {
    const body = { model: "Claude Sonnet 4.5" };
    const result = fixClaudeCacheControl(body);
    assert.deepEqual(result, body);
  });
});

describe("fixClaudeRequest", () => {
  it("passes through body without thinking", () => {
    const body = { model: "Claude Sonnet 4.5", messages: [] };
    const result = fixClaudeRequest(body);
    assert.deepEqual(result.body, body);
    assert.equal(result.hadThinking, false);
  });

  it("removes thinking when type is disabled", () => {
    const body = {
      model: "Claude Sonnet 4.5",
      thinking: { type: "disabled", budgetTokens: 1024 },
    };
    const result = fixClaudeRequest(body);
    assert.equal(result.body.thinking, undefined);
    assert.equal(result.hadThinking, true);
  });

  it("converts budgetTokens to budget_tokens", () => {
    const body = {
      model: "Claude Sonnet 4.5",
      thinking: { type: "enabled", budgetTokens: 32000 },
    };
    const result = fixClaudeRequest(body);
    assert.equal(result.body.thinking.budget_tokens, 32000);
    assert.equal(result.body.thinking.budgetTokens, undefined);
    assert.equal(result.hadThinking, true);
  });

  it("bumps max_tokens when <= budget_tokens", () => {
    const body = {
      model: "Claude Sonnet 4.5",
      thinking: { type: "enabled", budgetTokens: 32000 },
      max_tokens: 16000,
    };
    const result = fixClaudeRequest(body);
    assert.equal(result.body.max_tokens, 32000 + 4096);
  });
});

describe("fixClaudeStream", () => {
  it("converts end_turn to stop", () => {
    const input = 'data: {"choices":[{"finish_reason":"end_turn","delta":{}}]}\n';
    const result = fixClaudeStream(input);
    const parsed = JSON.parse(result.replace("data: ", "").trim());
    assert.equal(parsed.choices[0].finish_reason, "stop");
  });

  it("does not change stop finish_reason", () => {
    const input = 'data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n';
    const result = fixClaudeStream(input);
    assert.equal(result, input);
  });

  it("adds cached_tokens to prompt_tokens", () => {
    const input = 'data: {"usage":{"prompt_tokens":100,"prompt_tokens_details":{"cached_tokens":50}}}\n';
    const result = fixClaudeStream(input);
    const parsed = JSON.parse(result.replace("data: ", "").trim());
    assert.equal(parsed.usage.prompt_tokens, 150);
  });

  it("does not modify prompt_tokens when cached_tokens is 0", () => {
    const input = 'data: {"usage":{"prompt_tokens":100,"prompt_tokens_details":{"cached_tokens":0}}}\n';
    const result = fixClaudeStream(input);
    assert.equal(result, input);
  });

  it("passes through non-JSON data unchanged", () => {
    const input = "data: [DONE]\n";
    const result = fixClaudeStream(input);
    assert.equal(result, input);
  });
});

describe("fixClaudeMessages", () => {
  it("adds user message when last message is assistant", () => {
    const body = {
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    };

    const result = fixClaudeMessages(body);
    assert.equal(result.messages.length, 3);
    assert.equal(result.messages[2].role, "user");
    assert.equal(result.messages[2].content, ".");
  });

  it("does not modify when last message is user", () => {
    const body = {
      messages: [
        { role: "user", content: "Hello" },
      ],
    };

    const result = fixClaudeMessages(body);
    assert.equal(result.messages.length, 1);
    assert.deepEqual(result, body);
  });

  it("does not modify when last message is system", () => {
    const body = {
      messages: [
        { role: "system", content: "You are helpful" },
      ],
    };

    const result = fixClaudeMessages(body);
    assert.equal(result.messages.length, 1);
  });

  it("passes through body without messages", () => {
    const body = { model: "Claude Sonnet 4.5" };
    const result = fixClaudeMessages(body);
    assert.deepEqual(result, body);
  });

  it("passes through body with empty messages", () => {
    const body = { messages: [] };
    const result = fixClaudeMessages(body);
    assert.deepEqual(result, body);
  });

  it("preserves original messages array immutably", () => {
    const original = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ];
    const body = { messages: original };

    const result = fixClaudeMessages(body);
    assert.equal(original.length, 2, "original should not be modified");
    assert.equal(result.messages.length, 3);
  });
});
