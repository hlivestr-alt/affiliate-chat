"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const DELIVERY_ID = "AffWaDelivery2026";
const EVIDENCE = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "live-production-assignment-sheet-evidence.json");
const ALLOWED_SETTINGS = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
const id = () => crypto.randomUUID();
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 800)}`); return body ? JSON.parse(body) : {}; }
function payload(workflow, settings = workflow.settings) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(ALLOWED_SETTINGS.filter((name) => Object.hasOwn(settings || {}, name)).map((name) => [name, settings[name]])) }; }

(async () => {
  const sheet = JSON.parse(fs.readFileSync(EVIDENCE, "utf8"));
  const lead = sheet.lead_rows?.[0];
  const details = sheet.delivery_rows || [];
  if (!lead || lead.conversation_id !== "wa:6281120262823" || lead.batch_number !== "6916") throw new Error("canonical live lead evidence mismatch");
  if (details.length !== 15 || new Set(details.map((row) => row.file_name)).size !== 15 || new Set(details.map((row) => row.whatsapp_message_id).filter(Boolean)).size !== 15 || details.some((row) => row.last_error || Number(row.attempts) !== 1)) throw new Error("resumable safety precondition failed");
  const delivery = await api(`/workflows/${DELIVERY_ID}`);
  const finalNode = delivery.nodes.find((node) => node.name === "Update Final Send State");
  if (!String(finalNode?.parameters?.jsonBody || "").includes("$json.lead_row_values") || finalNode?.continueOnFail === true) throw new Error("final-state fix is not active");
  const source = { conversation_id: lead.conversation_id, username: lead.username, whatsapp_number: lead.whatsapp_number, wa_id: lead.wa_id, assignment_timestamp: lead.delivery_started_at, action: "resumable_finalization_only" };
  const route = `resume-live-finalization-${id()}`;
  const trigger = { id: id(), name: "Approved Resumable Finalization", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-440, 0], webhookId: id(), parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} } };
  const build = { id: id(), name: "Build Existing Assignment Context", type: "n8n-nodes-base.code", typeVersion: 2, position: [-220, 0], parameters: { jsCode: `return[{json:${JSON.stringify(source)}}];` } };
  const call = { id: id(), name: "Resume Existing Delivery Child", type: "n8n-nodes-base.executeWorkflow", typeVersion: 1.3, position: [0, 0], parameters: { source: "database", workflowId: { __rl: true, value: DELIVERY_ID, mode: "list", cachedResultName: DELIVERY_ID }, mode: "once", options: { waitForSubWorkflow: true } } };
  const result = { id: id(), name: "Return Resumable Result", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 0], parameters: { jsCode: `return[{json:{resumed:true,conversation_id:${JSON.stringify(lead.conversation_id)},batch_number:${JSON.stringify(lead.batch_number)},delivery_output:$json}}];` } };
  const edge = (node) => ({ main: [[{ node, type: "main", index: 0 }]] });
  const controller = await api("/workflows", { method: "POST", body: JSON.stringify({ name: "Temporary Resumable Live Assignment Finalization", nodes: [trigger, build, call, result], connections: { [trigger.name]: edge(build.name), [build.name]: edge(call.name), [call.name]: edge(result.name) }, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  const originalSettings = { ...(delivery.settings || {}) };
  const responses = [];
  try {
    const temporarySettings = { ...originalSettings, callerPolicy: "workflowsFromAList", callerIds: [originalSettings.callerIds, controller.id].filter(Boolean).join(","), saveDataSuccessExecution: "all", saveDataErrorExecution: "all" };
    await api(`/workflows/${DELIVERY_ID}`, { method: "PUT", body: JSON.stringify(payload(delivery, temporarySettings)) });
    await api(`/workflows/${DELIVERY_ID}/activate`, { method: "POST" });
    await api(`/workflows/${controller.id}/activate`, { method: "POST" });
    const requestedAttempts = Number(process.env.RECOVERY_ATTEMPTS || 2);
    const attemptCount = Number.isInteger(requestedAttempts) && requestedAttempts > 0 ? requestedAttempts : 2;
    for (let attempt = 1; attempt <= attemptCount; attempt++) {
      const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const responseBody = await response.text();
      responses.push({ attempt, http_status: response.status, response: response.ok ? JSON.parse(responseBody) : responseBody.slice(0, 1000) });
      if (!response.ok) throw new Error(`resumable finalization attempt ${attempt} ${response.status}: ${responseBody.slice(0, 1000)}`);
    }
  } finally {
    try { await api(`/workflows/${controller.id}/deactivate`, { method: "POST" }); } catch {}
    try { await api(`/workflows/${controller.id}`, { method: "DELETE" }); } catch {}
    const current = await api(`/workflows/${DELIVERY_ID}`);
    await api(`/workflows/${DELIVERY_ID}`, { method: "PUT", body: JSON.stringify(payload(current, originalSettings)) });
    await api(`/workflows/${DELIVERY_ID}/activate`, { method: "POST" });
  }
  const output = { controller_workflow_id: controller.id, responses, safety_precondition: { existing_files: 15, existing_message_ids: 15, prior_attempts_each: 1 } };
  const outPath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "live-resumable-finalization-launch.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
