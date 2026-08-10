"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WORKFLOW_ID = "AffWaDelivery2026";
const ALLOWED_SETTINGS = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 700)}`); return body ? JSON.parse(body) : {}; }
function payload(workflow) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(ALLOWED_SETTINGS.filter((name) => Object.hasOwn(workflow.settings || {}, name)).map((name) => [name, workflow.settings[name]])) }; }

(async () => {
  const workflow = await api(`/workflows/${WORKFLOW_ID}`);
  const beforeVersion = workflow.versionId;
  const prepare = workflow.nodes.find((node) => node.name === "Prepare Resumable Delivery Items");
  const finalize = workflow.nodes.find((node) => node.name === "Prepare Zero-Remaining Recovery Finalization");
  if (!prepare || !finalize) throw new Error("recovery nodes missing");
  prepare.parameters.jsCode = String(prepare.parameters.jsCode)
    .replace("/^wamid.[A-Za-z0-9_+=/-]{12,}$/", "/^wamid\\.[A-Za-z0-9_+=\\/-]{12,}$/")
    .replaceAll("replace(/D/g", "replace(/\\D/g")
    .replace("/^d+$/", "/^\\d+$/");
  finalize.parameters.jsCode = String(finalize.parameters.jsCode).replaceAll("replace(/D/g", "replace(/\\D/g");
  await api(`/workflows/${WORKFLOW_ID}`, { method: "PUT", body: JSON.stringify(payload(workflow)) });
  if (workflow.active) await api(`/workflows/${WORKFLOW_ID}/activate`, { method: "POST" });
  const after = await api(`/workflows/${WORKFLOW_ID}`);
  const p = after.nodes.find((node) => node.name === prepare.name).parameters.jsCode;
  const f = after.nodes.find((node) => node.name === finalize.name).parameters.jsCode;
  if (!p.includes("/^wamid\\.") || !p.includes("replace(/\\D/g") || !p.includes("/^\\d+$/") || !f.includes("replace(/\\D/g")) throw new Error("regex serialization correction verification failed");
  process.stdout.write(JSON.stringify({ workflow_id: after.id, active: after.active, before_version: beforeVersion, after_version: after.versionId, corrected_nodes: [prepare.name, finalize.name] }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
