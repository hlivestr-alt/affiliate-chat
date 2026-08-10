"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const BACKUP = path.join(ROOT, "n8n", "exports", "live-backups", "before-zero-remaining-recovery-fix-20260806T1310CST", "AffWaDelivery2026.json");
const OUT = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "zero-recovery-final-deployment-verification.json");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => {
  const i = line.indexOf("=");
  return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""];
}).filter(([key]) => key));
const critical = [
  "Prepare Batch Send Claims", "Upload Video to WhatsApp",
  "Parse Media Upload", "Send WhatsApp Video", "Parse Video Send", "Batch Write Delivery Results",
  "Append Message Results Batch", "Prepare Assignment Start Log",
  "Prepare Assignment Final Log", "Update Final Send State",
];
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function api(route) {
  const response = await fetch(API + route, { headers: { "X-N8N-API-KEY": env.N8N_API_KEY } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status}: ${body.slice(0, 700)}`);
  return JSON.parse(body);
}

(async () => {
  const saved = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
  const before = Array.isArray(saved) ? saved[0] : saved;
  const after = await api("/workflows/AffWaDelivery2026");
  const comparisons = critical.map((name) => {
    const oldNode = before.nodes.find((node) => node.name === name);
    const newNode = after.nodes.find((node) => node.name === name);
    return { name, unchanged: Boolean(oldNode && newNode && digest(oldNode) === digest(newNode)), before_hash: oldNode && digest(oldNode), after_hash: newNode && digest(newNode) };
  });
  const prepare = after.nodes.find((node) => node.name === "Prepare Resumable Delivery Items");
  const writer = after.nodes.find((node) => node.name === "Update Final Send State");
  const result = {
    workflow_id: after.id,
    workflow_active: after.active,
    version_id: after.versionId,
    node_count_before: before.nodes.length,
    node_count_after: after.nodes.length,
    added_nodes_present: ["IF Zero-Remaining Recovery", "Prepare Zero-Remaining Recovery Finalization", "IF Final-State Write Required"].every((name) => after.nodes.some((node) => node.name === name)),
    prepare_has_zero_recovery: Boolean(prepare?.parameters?.jsCode?.includes("zero_remaining_recovery")),
    final_writer_uses_lead_row_values: Boolean(writer?.parameters?.jsonBody?.includes("$json.lead_row_values")),
    final_writer_continue_on_fail: Boolean(writer?.continueOnFail || writer?.onError === "continueRegularOutput" || writer?.onError === "continueErrorOutput"),
    critical_nodes: comparisons,
    all_critical_nodes_unchanged: comparisons.every((entry) => entry.unchanged),
    caller_policy: after.settings?.callerPolicy,
    caller_ids: after.settings?.callerIds || [],
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
