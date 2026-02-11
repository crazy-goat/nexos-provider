#!/usr/bin/env node

import { execSync } from "child_process";

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_FILE = join(__dirname, "check-all.mjs");

const API_URL = "https://api.nexos.ai/v1";
const API_KEY = process.env.NEXOS_API_KEY;
const PROVIDER = "nexos-ai";

if (!API_KEY) {
  console.error("ERROR: NEXOS_API_KEY not set");
  process.exit(1);
}

async function fetchModels() {
  const res = await fetch(`${API_URL}/models`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const data = await res.json();
  return data.data
    .map((m) => m.id)
    .filter((id) => !id.toLowerCase().includes("no pii"))
    .filter((id) => !id.toLowerCase().includes("embedding"))
    .sort();
}

function sleep(ms) {
  execSync(`sleep ${ms / 1000}`);
}

function runOpencode(model, prompt, timeout = 60000, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = execSync(
        `opencode run "${prompt}" -m "${PROVIDER}/${model}"`,
        { timeout, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      return { ok: true, output: result };
    } catch (e) {
      const msg = e.stderr?.slice(0, 80) || e.message?.slice(0, 80) || "unknown";
      if (attempt < retries) {
        process.stdout.write(`(retry ${attempt + 1}) `);
        sleep(5000);
        continue;
      }
      return { ok: false, error: msg };
    }
  }
}

function testSimple(model) {
  return runOpencode(model, "Say just the word hello");
}

function testToolCall(model) {
  const result = runOpencode(model, `Execute this bash command and show me the output: head -1 ${TEST_FILE}`, 90000);
  if (!result.ok) return { ...result, output: result.output || result.error };
  if (result.output.includes("#!/usr/bin/env node")) {
    return { ok: true };
  }
  return { ok: false, error: "tool not used correctly", output: result.output };
}

async function main() {
  const singleModel = process.argv[2];

  if (singleModel) {
    console.log(`Testing single model: ${singleModel}\n`);

    console.log("=== Simple test ===");
    const simple = testSimple(singleModel);
    console.log(`Status: ${simple.ok ? "✅ OK" : "❌ FAIL"}`);
    if (!simple.ok) console.log(`Error: ${simple.error}`);
    if (simple.output) console.log(`Output:\n${simple.output}`);

    console.log("\n=== Tool calling test ===");
    const tools = testToolCall(singleModel);
    console.log(`Status: ${tools.ok ? "✅ OK" : "❌ FAIL"}`);
    if (!tools.ok) console.log(`Error: ${tools.error}`);
    if (tools.output) console.log(`Output:\n${tools.output}`);
    return;
  }

  console.log("Fetching model list from nexos.ai...");
  const models = await fetchModels();
  console.log(`Found ${models.length} models (excluding 'no pii')\n`);

  const results = [];

  for (const model of models) {
    process.stdout.write(`Testing ${model.padEnd(40)} `);

    const simple = testSimple(model);
    const simpleStatus = simple.ok ? "✅" : "❌";
    process.stdout.write(`simple: ${simpleStatus}  `);

    const tools = testToolCall(model);
    const toolsStatus = tools.ok ? "✅" : "❌";
    console.log(`tools: ${toolsStatus}`);
    if (!tools.ok && tools.output) {
      console.log(`  -> ${tools.error}: ${tools.output.slice(0, 100).replace(/\n/g, " ")}`);
    }

    results.push({
      model,
      simple: simple.ok ? "OK" : simple.error,
      tools: tools.ok ? "OK" : tools.error,
      toolsOutput: tools.output || null,
    });
  }

  const md = generateMarkdown(results);
  const fs = await import("fs");
  fs.writeFileSync("checks.md", md);
  console.log("\nResults saved to checks.md");

  const simpleOk = results.filter((r) => r.simple === "OK").length;
  const toolsOk = results.filter((r) => r.tools === "OK").length;
  console.log(`\n=== Summary ===`);
  console.log(`Simple prompts: ${simpleOk}/${results.length} working`);
  console.log(`Tool calling: ${toolsOk}/${results.length} working`);
}

function generateMarkdown(results) {
  const date = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const simpleOk = results.filter((r) => r.simple === "OK").length;
  const toolsOk = results.filter((r) => r.tools === "OK").length;

  let md = `# Model Compatibility Check (opencode)

Generated: ${date}

## Summary

| Test | Working | Broken | Total |
|------|---------|--------|-------|
| Simple prompts | ${simpleOk} | ${results.length - simpleOk} | ${results.length} |
| Tool calling | ${toolsOk} | ${results.length - toolsOk} | ${results.length} |

## Results

| Model | Simple | Tools | Notes |
|-------|--------|-------|-------|
`;

  for (const r of results) {
    const simpleIcon = r.simple === "OK" ? "✅" : "❌";
    const toolsIcon = r.tools === "OK" ? "✅" : "❌";
    const notes =
      r.simple !== "OK"
        ? r.simple.replace(/\|/g, "\\|").slice(0, 60)
        : r.tools !== "OK"
          ? r.tools.replace(/\|/g, "\\|").slice(0, 60)
          : "";
    md += `| ${r.model} | ${simpleIcon} | ${toolsIcon} | ${notes} |\n`;
    if (r.tools !== "OK" && r.toolsOutput) {
      md += `\n<details><summary>${r.model} tools output</summary>\n\n\`\`\`\n${r.toolsOutput}\n\`\`\`\n</details>\n\n`;
    }
  }

  return md;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
