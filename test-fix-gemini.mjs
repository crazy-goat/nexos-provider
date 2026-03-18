import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isGeminiModel, fixGeminiRequest, fixGeminiThinkingRequest, fixGeminiStream } from "./fix-gemini.mjs";

describe("isGeminiModel", () => {
  it("detects Gemini models case-insensitively", () => {
    assert.equal(isGeminiModel("Gemini 2.5 Pro"), true);
    assert.equal(isGeminiModel("gemini-2.5-flash"), true);
    assert.equal(isGeminiModel("GEMINI 3 Pro Preview"), true);
  });

  it("rejects non-Gemini models", () => {
    assert.equal(isGeminiModel("Claude Sonnet 4.5"), false);
    assert.equal(isGeminiModel("GPT 5"), false);
    assert.equal(isGeminiModel("Kimi K2.5"), false);
  });

  it("handles non-string input", () => {
    assert.equal(isGeminiModel(null), false);
    assert.equal(isGeminiModel(undefined), false);
    assert.equal(isGeminiModel(42), false);
  });
});

describe("fixGeminiRequest - $ref inlining", () => {
  it("inlines $ref references in tool schemas", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            $defs: {
              MyType: { type: "string", description: "A string type" },
            },
            properties: {
              field: { $ref: "#/$defs/MyType" },
            },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    const props = result.tools[0].function.parameters.properties;
    assert.equal(props.field.type, "string");
    assert.equal(props.field.description, "A string type");
    assert.equal(props.field.$ref, undefined);
  });

  it("removes $defs after inlining", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            $defs: { Foo: { type: "number" } },
            properties: { x: { $ref: "#/$defs/Foo" } },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    assert.equal(result.tools[0].function.parameters.$defs, undefined);
  });

  it("passes through tools without parameters", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{ type: "function", function: { name: "noparams" } }],
    };
    const result = fixGeminiRequest(body);
    assert.deepEqual(result.tools, body.tools);
  });

  it("passes through body without tools", () => {
    const body = { model: "Gemini 2.5 Pro", messages: [] };
    const result = fixGeminiRequest(body);
    assert.deepEqual(result, body);
  });
});

describe("fixGeminiRequest - unsupported JSON Schema keywords", () => {
  it("strips exclusiveMinimum and converts to minimum", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            properties: {
              age: { type: "integer", exclusiveMinimum: 0 },
            },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    const age = result.tools[0].function.parameters.properties.age;
    assert.equal(age.exclusiveMinimum, undefined);
    assert.equal(age.minimum, 0);
  });

  it("strips exclusiveMaximum and converts to maximum", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            properties: {
              score: { type: "number", exclusiveMaximum: 100 },
            },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    const score = result.tools[0].function.parameters.properties.score;
    assert.equal(score.exclusiveMaximum, undefined);
    assert.equal(score.maximum, 100);
  });

  it("does not overwrite existing minimum when stripping exclusiveMinimum", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            properties: {
              val: { type: "number", minimum: 5, exclusiveMinimum: 0 },
            },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    const val = result.tools[0].function.parameters.properties.val;
    assert.equal(val.minimum, 5);
    assert.equal(val.exclusiveMinimum, undefined);
  });

  it("does not overwrite existing maximum when stripping exclusiveMaximum", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            properties: {
              val: { type: "number", maximum: 50, exclusiveMaximum: 100 },
            },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    const val = result.tools[0].function.parameters.properties.val;
    assert.equal(val.maximum, 50);
    assert.equal(val.exclusiveMaximum, undefined);
  });

  it("strips patternProperties", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            patternProperties: { "^S_": { type: "string" } },
            properties: { name: { type: "string" } },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    assert.equal(result.tools[0].function.parameters.patternProperties, undefined);
    assert.equal(result.tools[0].function.parameters.properties.name.type, "string");
  });

  it("strips if/then/else", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            if: { properties: { type: { const: "a" } } },
            then: { required: ["x"] },
            else: { required: ["y"] },
            properties: { type: { type: "string" } },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    const params = result.tools[0].function.parameters;
    assert.equal(params.if, undefined);
    assert.equal(params.then, undefined);
    assert.equal(params.else, undefined);
    assert.equal(params.properties.type.type, "string");
  });

  it("strips $schema, $id, $anchor, $comment", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            $id: "test-schema",
            $anchor: "root",
            $comment: "This is a test",
            type: "object",
            properties: { x: { type: "string" } },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    const params = result.tools[0].function.parameters;
    assert.equal(params.$schema, undefined);
    assert.equal(params.$id, undefined);
    assert.equal(params.$anchor, undefined);
    assert.equal(params.$comment, undefined);
    assert.equal(params.type, "object");
  });

  it("strips not keyword", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            properties: {
              val: { type: "string", not: { enum: ["bad"] } },
            },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    assert.equal(result.tools[0].function.parameters.properties.val.not, undefined);
    assert.equal(result.tools[0].function.parameters.properties.val.type, "string");
  });

  it("strips contentMediaType and contentEncoding", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            properties: {
              data: {
                type: "string",
                contentMediaType: "application/json",
                contentEncoding: "base64",
              },
            },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    const data = result.tools[0].function.parameters.properties.data;
    assert.equal(data.contentMediaType, undefined);
    assert.equal(data.contentEncoding, undefined);
    assert.equal(data.type, "string");
  });

  it("handles deeply nested schemas with unsupported keywords", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      tools: [{
        type: "function",
        function: {
          name: "test",
          parameters: {
            type: "object",
            properties: {
              nested: {
                type: "object",
                properties: {
                  deep: {
                    type: "array",
                    items: {
                      type: "integer",
                      exclusiveMinimum: 0,
                      exclusiveMaximum: 100,
                    },
                  },
                },
              },
            },
          },
        },
      }],
    };

    const result = fixGeminiRequest(body);
    const items = result.tools[0].function.parameters.properties.nested.properties.deep.items;
    assert.equal(items.exclusiveMinimum, undefined);
    assert.equal(items.exclusiveMaximum, undefined);
    assert.equal(items.minimum, 0);
    assert.equal(items.maximum, 100);
    assert.equal(items.type, "integer");
  });
});

describe("fixGeminiThinkingRequest", () => {
  it("passes through body without thinking", () => {
    const body = { model: "Gemini 2.5 Pro", messages: [] };
    const result = fixGeminiThinkingRequest(body);
    assert.deepEqual(result.body, body);
    assert.equal(result.hadThinking, false);
  });

  it("removes thinking when type is disabled", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      thinking: { type: "disabled", budgetTokens: 1024 },
    };
    const result = fixGeminiThinkingRequest(body);
    assert.equal(result.body.thinking, undefined);
    assert.equal(result.hadThinking, true);
  });

  it("converts budgetTokens to budget_tokens", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      thinking: { type: "enabled", budgetTokens: 8192 },
    };
    const result = fixGeminiThinkingRequest(body);
    assert.equal(result.body.thinking.budget_tokens, 8192);
    assert.equal(result.body.thinking.budgetTokens, undefined);
    assert.equal(result.hadThinking, true);
  });

  it("bumps max_tokens when <= budget_tokens", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      thinking: { type: "enabled", budgetTokens: 8192 },
      max_tokens: 4096,
    };
    const result = fixGeminiThinkingRequest(body);
    assert.equal(result.body.max_tokens, 8192 + 4096);
  });

  it("does not bump max_tokens when > budget_tokens", () => {
    const body = {
      model: "Gemini 2.5 Pro",
      thinking: { type: "enabled", budgetTokens: 1024 },
      max_tokens: 8192,
    };
    const result = fixGeminiThinkingRequest(body);
    assert.equal(result.body.max_tokens, 8192);
  });
});

describe("fixGeminiStream", () => {
  it("converts STOP to stop", () => {
    const input = 'data: {"choices":[{"finish_reason":"STOP","delta":{"content":"hi"}}]}\n';
    const result = fixGeminiStream(input);
    const parsed = JSON.parse(result.replace("data: ", "").trim());
    assert.equal(parsed.choices[0].finish_reason, "stop");
  });

  it("converts stop to tool_calls when tool_calls present", () => {
    const input = 'data: {"choices":[{"finish_reason":"stop","delta":{"tool_calls":[{"id":"1"}]}}]}\n';
    const result = fixGeminiStream(input);
    const parsed = JSON.parse(result.replace("data: ", "").trim());
    assert.equal(parsed.choices[0].finish_reason, "tool_calls");
  });

  it("does not change stop without tool_calls", () => {
    const input = 'data: {"choices":[{"finish_reason":"stop","delta":{"content":"done"}}]}\n';
    const result = fixGeminiStream(input);
    assert.equal(result, input);
  });

  it("passes through non-JSON data unchanged", () => {
    const input = "data: [DONE]\n";
    const result = fixGeminiStream(input);
    assert.equal(result, input);
  });

  it("extracts thinking from content_blocks", () => {
    const input = 'data: {"choices":[{"delta":{"content_blocks":[{"delta":{"thinking":"let me think"}}]}}]}\n';
    const result = fixGeminiStream(input);
    const parsed = JSON.parse(result.replace("data: ", "").trim());
    assert.equal(parsed.choices[0].delta.reasoning_content, "let me think");
    assert.equal(parsed.choices[0].delta.content_blocks, undefined);
  });
});
