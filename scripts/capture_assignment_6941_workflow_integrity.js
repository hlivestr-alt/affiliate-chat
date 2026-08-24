"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "n8n", "exports", "assignment-6941-recovery-20260821");
const IDS = ["AffWaReply2026", "AffWaDelivery2026", "AffWaWebhook2026", "AffWaStatus2026", "ecBB2oa6xeY2knFu"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const index = line.indexOf("="); return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ["", ""]; }).filter(([key]) => key));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
(async () => {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const summary = { captured_at: new Date().toISOString(), workflows: [] };
  for (const id of IDS) {
    const response = await fetch(`https://n8n.proyaofficial.com/api/v1/workflows/${id}`, { headers: { "X-N8N-API-KEY": env.N8N_API_KEY } });
    const body = await response.text();
    if (!response.ok) throw new Error(`workflow_read_${id}_${response.status}:${body.slice(0, 300)}`);
    const workflow = JSON.parse(body);
    const definition = { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings };
    const sha256 = crypto.createHash("sha256").update(JSON.stringify(stable(definition))).digest("hex");
    fs.writeFileSync(path.join(OUTPUT, `${id}.json`), JSON.stringify(workflow, null, 2) + "\n");
    summary.workflows.push({ id, name: workflow.name, active: workflow.active, version_id: workflow.versionId, active_version_id: workflow.activeVersionId || "", updated_at: workflow.updatedAt, definition_sha256: sha256, caller_policy: workflow.settings?.callerPolicy || "", caller_ids: workflow.settings?.callerIds || "" });
  }
  fs.writeFileSync(path.join(OUTPUT, "workflow-integrity.json"), JSON.stringify(summary, null, 2) + "\n");
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
