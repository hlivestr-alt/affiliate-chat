"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const STAMP = process.argv.find((arg) => arg.startsWith("--stamp="))?.slice(8) || "20260821T1725CST";
const OUTPUT = path.join(ROOT, "n8n", "exports", "live-backups", `before-state-model-separation-${STAMP}`);
const API = "https://n8n.proyaofficial.com/api/v1";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const index = line.indexOf("="); return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ["", ""]; }).filter(([key]) => key));
const KEYWORDS = ["WhatsApp Leads", "last_intent", "delivery_in_progress", "files_sent", "files_delivered", "awaiting_username", "distribution_pending", "waiting_for_affiliate_message"];
const MANDATORY_IDS = new Set(["AfDriveReady2026","AffDistSetup2026","AffWaQueue2026","AffWaDelivery2026","AffWaObservability2026","AffWaOptIn2026","AffWaReply2026","AffWaStatus2026","AffWaWebhook2026","p24kmXRNibNLZovt","ecBB2oa6xeY2knFu","m1KBWKOLjwxbtFPP"]);

async function api(route) {
  const response = await fetch(API + route, { headers: { "X-N8N-API-KEY": env.N8N_API_KEY } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n_api_${response.status}_${route}:${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : {};
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function definition(workflow) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings }; }
function snippets(text) {
  const lines = text.split(/\r?\n/);
  return lines.map((line, index) => ({ line: index + 1, text: line.trim() })).filter((entry) => KEYWORDS.some((keyword) => entry.text.includes(keyword))).slice(0, 200);
}

(async () => {
  fs.mkdirSync(path.join(OUTPUT, "workflows"), { recursive: true });
  let cursor = "";
  const listed = [];
  do {
    const page = await api(`/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    listed.push(...(page.data || []));
    cursor = page.nextCursor || "";
  } while (cursor);
  const matched = [];
  for (const item of listed) {
    const workflow = await api(`/workflows/${item.id}`);
    const serialized = JSON.stringify(definition(workflow));
    if (!MANDATORY_IDS.has(workflow.id) && !KEYWORDS.some((keyword) => serialized.includes(keyword))) continue;
    const core = definition(workflow);
    const sha256 = crypto.createHash("sha256").update(JSON.stringify(stable(core))).digest("hex");
    fs.writeFileSync(path.join(OUTPUT, "workflows", `${workflow.id}.json`), JSON.stringify(workflow, null, 2) + "\n");
    const nodes = workflow.nodes.map((node) => {
      const parameterText = JSON.stringify(node.parameters || {}, null, 2);
      return { name: node.name, type: node.type, keyword_matches: KEYWORDS.filter((keyword) => parameterText.includes(keyword)), snippets: snippets(node.parameters?.jsCode || parameterText) };
    }).filter((node) => node.keyword_matches.length);
    matched.push({ id: workflow.id, name: workflow.name, active: workflow.active, version_id: workflow.versionId, active_version_id: workflow.activeVersionId || "", updated_at: workflow.updatedAt, definition_sha256: sha256, caller_policy: workflow.settings?.callerPolicy || "", caller_ids: workflow.settings?.callerIds || "", nodes });
  }
  const output = { captured_at: new Date().toISOString(), searched_workflow_count: listed.length, matched_workflow_count: matched.length, keywords: KEYWORDS, workflows: matched };
  fs.writeFileSync(path.join(OUTPUT, "state-usage-workflow-inventory.json"), JSON.stringify(output, null, 2) + "\n");
  fs.writeFileSync(path.join(OUTPUT, "workflow-hashes.json"), JSON.stringify({ captured_at: output.captured_at, workflows: matched.map(({ id,name,active,version_id,active_version_id,updated_at,definition_sha256,caller_policy,caller_ids }) => ({ id,name,active,version_id,active_version_id,updated_at,definition_sha256,caller_policy,caller_ids })) }, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ output: OUTPUT, searched_workflow_count: listed.length, matched_workflow_count: matched.length, matched: matched.map((workflow) => ({ id: workflow.id, name: workflow.name, node_count: workflow.nodes.length, sha256: workflow.definition_sha256 })) }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
