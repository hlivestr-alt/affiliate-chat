"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WORKFLOW_ID = "AffWaDelivery2026";
const NODE_NAME = "Update Final Send State";
const ALLOWED_SETTINGS = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 800)}`); return body ? JSON.parse(body) : {}; }
function payload(workflow) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(ALLOWED_SETTINGS.filter((name) => Object.hasOwn(workflow.settings || {}, name)).map((name) => [name, workflow.settings[name]])) }; }

(async () => {
  const before = await api(`/workflows/${WORKFLOW_ID}`);
  const wasActive = before.active;
  const node = before.nodes.find((item) => item.name === NODE_NAME);
  const summary = before.nodes.find((item) => item.name === "Prepare Cached Delivery Summary");
  if (!node || !summary) throw new Error("final-state nodes missing");
  if (!String(summary.parameters?.jsCode || "").includes("lead_row_values")) throw new Error("summary no longer emits lead_row_values");
  if (!String(node.parameters?.jsonBody || "").includes("$json.row_values")) throw new Error("expected defective row_values mapping not found");
  const beforeVersion = before.versionId;
  node.parameters.jsonBody = String(node.parameters.jsonBody).replaceAll("$json.row_values", "$json.lead_row_values");
  delete node.continueOnFail;
  await api(`/workflows/${WORKFLOW_ID}`, { method: "PUT", body: JSON.stringify(payload(before)) });
  if (wasActive) await api(`/workflows/${WORKFLOW_ID}/activate`, { method: "POST" });
  const after = await api(`/workflows/${WORKFLOW_ID}`);
  const verified = after.nodes.find((item) => item.name === NODE_NAME);
  if (after.active !== wasActive || !String(verified?.parameters?.jsonBody || "").includes("$json.lead_row_values") || verified?.continueOnFail === true) throw new Error("final-state mapping deployment verification failed");
  const result = { workflow_id: WORKFLOW_ID, workflow_name: after.name, node: NODE_NAME, active: after.active, before_version: beforeVersion, after_version: after.versionId, body_mapping: "lead_row_values", failure_behavior: "stop workflow", changed_nodes: 1 };
  const outPath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "live-finalization-fix.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
