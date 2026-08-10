"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => {
  const i = line.indexOf("=");
  return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""];
}).filter(([key]) => key));
const targets = new Map([
  ["D9sdgcKxnhHp2IND", "Temporary Zero-Remaining Exact Logic Fixtures"],
  ["5X6uxX1pzbI1Trsv", "Temporary Zero-Remaining Exact Logic Fixtures"],
  ["fM8j6ISGtqr4Cc6Q", "Temporary Zero-Recovery Persistence Failure"],
]);

async function api(route, options = {}) {
  const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 700)}`);
  return body ? JSON.parse(body) : {};
}

(async () => {
  const removed = [];
  for (const [workflowId, expectedName] of targets) {
    const workflow = await api(`/workflows/${workflowId}`);
    if (workflow.name !== expectedName || workflow.active) {
      throw new Error(`refusing cleanup for ${workflowId}: name=${workflow.name}, active=${workflow.active}`);
    }
    await api(`/workflows/${workflowId}`, { method: "DELETE" });
    removed.push({ workflow_id: workflowId, name: workflow.name });
  }
  const output = { removed, production_workflow_untouched: "AffWaDelivery2026" };
  const outPath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "zero-recovery-test-cleanup.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
