#!/usr/bin/env node

const baseURL = process.env.NEXOS_BASE_URL || "https://api.nexos.ai/v1";
const apiKey = process.env.NEXOS_API_KEY;

if (!apiKey) {
  console.error("Error: NEXOS_API_KEY environment variable is not set");
  process.exit(1);
}

const res = await fetch(`${baseURL}/models`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});

if (!res.ok) {
  console.error(`Error: ${res.status} ${res.statusText}`);
  const body = await res.text();
  if (body) console.error(body);
  process.exit(1);
}

const data = await res.json();
const models = (data.data || data.models || []).sort((a, b) =>
  (a.id || a.name || "").localeCompare(b.id || b.name || "")
);

if (models.length === 0) {
  console.log("No models found.");
  process.exit(0);
}

console.log(`\nAvailable models (${models.length}):\n`);

for (const m of models) {
  const id = m.id || m.name;
  console.log(`  - ${id}`);
}

console.log("\nTo use a model in opencode.json, add it under provider.models:");
console.log(`
  "models": {
    "<model-id>": {
      "name": "<model-id>",
      "limit": { "context": 128000, "output": 64000 }
    }
  }
`);
