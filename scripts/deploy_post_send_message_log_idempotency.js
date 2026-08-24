"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "n8n", "exports", "post-send-persistence-20260822");
const workflowId = "AffWaDelivery2026";
const allowedSettings = ["saveExecutionProgress","saveManualExecutions","saveDataErrorExecution","saveDataSuccessExecution","executionTimeout","errorWorkflow","timezone","executionOrder","callerPolicy","callerIds","timeSavedPerExecution","redactionPolicy","availableInMCP","customTelemetryTags"];
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).map((line) => { const index = line.indexOf("="); return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1)] : ["", ""]; }).filter(([key]) => key));
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nodeHash = (node) => hash({ type: node.type, typeVersion: node.typeVersion, parameters: node.parameters, credentials: node.credentials, retryOnFail: node.retryOnFail, maxTries: node.maxTries, waitBetweenTries: node.waitBetweenTries, continueOnFail: node.continueOnFail, onError: node.onError });
async function api(route, options = {}) { const response = await fetch(`http://localhost:5678/api/v1${route}`, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n_${response.status}:${route}:${body.slice(0, 400)}`); return body ? JSON.parse(body) : {}; }
const payload = (workflow) => ({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(allowedSettings.filter((name) => Object.hasOwn(workflow.settings || {}, name)).map((name) => [name, workflow.settings[name]])) });

(async () => {
  const current = await api(`/workflows/${workflowId}`);
  const desired = JSON.parse(fs.readFileSync(path.join(root, "n8n", "imports", "affiliate-whatsapp-file-delivery.json"), "utf8"));
  if (!current.active || current.nodes.some((node) => node.type === "n8n-nodes-base.dataTable")) throw new Error("unexpected_live_delivery_state");
  const changed = ["Validate Immediate Successful Send", "Prepare Batched Delivery Tracking"];
  const protectedNames = ["Upload Video to WhatsApp", "Send WhatsApp Video", "Select and Prepare Batch Reservation", "Prepare Resumable Delivery Items", "Guard Cached Media Upload", "Guard Cached Clip Send", "Update Final Send State"];
  const beforeProtected = Object.fromEntries(protectedNames.map((name) => [name, nodeHash(current.nodes.find((node) => node.name === name))]));
  const beforeSettings = hash(current.settings || {});
  const proposed = structuredClone(current);
  for (const name of changed) {
    const liveNode = proposed.nodes.find((node) => node.name === name);
    const desiredNode = desired.nodes.find((node) => node.name === name);
    if (!liveNode || !desiredNode) throw new Error(`idempotency_node_missing:${name}`);
    liveNode.parameters.jsCode = desiredNode.parameters.jsCode;
  }
  fs.writeFileSync(path.join(out, "delivery-before-message-idempotency.json"), JSON.stringify(current, null, 2) + "\n");
  const updated = await api(`/workflows/${workflowId}`, { method: "PUT", body: JSON.stringify(payload(proposed)) });
  await api(`/workflows/${workflowId}/activate`, { method: "POST" });
  const after = await api(`/workflows/${workflowId}`);
  const afterProtected = Object.fromEntries(protectedNames.map((name) => [name, nodeHash(after.nodes.find((node) => node.name === name))]));
  const verification = {
    active: after.active,
    active_version_id: after.activeVersionId,
    changed_nodes_match_source: changed.every((name) => after.nodes.find((node) => node.name === name).parameters.jsCode === desired.nodes.find((node) => node.name === name).parameters.jsCode),
    protected_nodes_unchanged: JSON.stringify(beforeProtected) === JSON.stringify(afterProtected),
    settings_unchanged: hash(after.settings || {}) === beforeSettings,
    data_table_nodes: after.nodes.filter((node) => node.type === "n8n-nodes-base.dataTable").map((node) => node.name),
    caller_policy: after.settings?.callerPolicy,
    caller_ids: after.settings?.callerIds,
  };
  if (!verification.active || !verification.changed_nodes_match_source || !verification.protected_nodes_unchanged || !verification.settings_unchanged || verification.data_table_nodes.length || verification.caller_policy !== "workflowsFromAList" || String(verification.caller_ids) !== "AffWaReply2026") throw new Error("message_log_idempotency_deploy_verification_failed");
  fs.writeFileSync(path.join(out, "delivery-after.json"), JSON.stringify(after, null, 2) + "\n");
  const report = { applied_at: new Date().toISOString(), workflow_id: workflowId, before_version_id: current.versionId, after_version_id: after.versionId, active_version_id: after.activeVersionId, changed_nodes: changed, behavior: ["suppress Message Log append when the stable clip key already has the same WAMID", "fail on a different WAMID for the same stable clip key", "deduplicate identical successful clip results inside one batch"], verification };
  fs.writeFileSync(path.join(out, "message-log-idempotency-deployment-report.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
