"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const values = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match) values[match[1].trim()] = match[2]; }
async function api(pathname, options = {}) { const response = await fetch(API + pathname, { ...options, headers: { "X-N8N-API-KEY": values.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`API ${response.status} ${pathname}: ${body.slice(0, 500)}`); return body ? JSON.parse(body) : {}; }
function payload(workflow, settings) { const allowed = ["saveExecutionProgress","saveManualExecutions","saveDataErrorExecution","saveDataSuccessExecution","executionTimeout","errorWorkflow","timezone","executionOrder","callerPolicy","callerIds","timeSavedPerExecution","redactionPolicy","availableInMCP","customTelemetryTags"]; return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(allowed.filter((name) => Object.hasOwn(settings || {}, name)).map((name) => [name, settings[name]])) }; }
async function main() {
  const listing = await api("/workflows?limit=100");
  const temporary = (listing.data || listing).filter((workflow) => workflow.name === "Temporary Allowlisted Delivery Recovery");
  for (const workflow of temporary) { try { await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" }); } catch {} await api(`/workflows/${workflow.id}`, { method: "DELETE" }); }
  const delivery = await api("/workflows/AffWaDelivery2026");
  const paused = process.argv.includes("--pause-callers");
  const settings = { ...(delivery.settings || {}), callerPolicy: "workflowsFromAList", callerIds: paused ? "__delivery_recovery_paused__" : "AffWaReply2026" };
  await api("/workflows/AffWaDelivery2026", { method: "PUT", body: JSON.stringify(payload(delivery, settings)) });
  if (delivery.active) await api("/workflows/AffWaDelivery2026/activate", { method: "POST" });
  const verified = await api("/workflows/AffWaDelivery2026");
  process.stdout.write(`${JSON.stringify({ temporary_workflows_removed: temporary.map((workflow) => workflow.id), delivery_active: verified.active, caller_ids: verified.settings?.callerIds, paused }, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
