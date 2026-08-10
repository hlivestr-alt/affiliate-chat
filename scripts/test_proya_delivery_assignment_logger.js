"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const LOGGER_NAME = "PROYA WhatsApp Delivery Log Writer";
const SPREADSHEET_ID = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8")
  .split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; })
  .filter(([key]) => key));
const key = env.N8N_API_KEY;

async function api(route, options = {}) {
  const response = await fetch(`${API}${route}`, { ...options, headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

function id() { return crypto.randomUUID(); }
function connect(name) { return { main: [[{ node: name, type: "main", index: 0 }]] }; }

async function main() {
  const list = await api("/workflows?limit=250");
  const loggerSummary = (list.data || []).find((workflow) => workflow.name === LOGGER_NAME);
  if (!loggerSummary) throw new Error("Logger workflow not found");
  const logger = await api(`/workflows/${loggerSummary.id}`);
  const credential = logger.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  const route = `proya-assignment-logger-test-${crypto.randomUUID()}`;
  const trigger = { id: id(), name: "Controlled Logger Test", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-500, 0], webhookId: id(), parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} } };
  const guard = { id: id(), name: "Guard Controlled Test Data", type: "n8n-nodes-base.code", typeVersion: 2, position: [-280, 0], parameters: { jsCode: `const s=$json.body||$json;if(s.username!=="codex_logger_test"||!String(s.assignment_key||"").startsWith("test:"))throw new Error("controlled_logger_test_guard_rejected");return[{json:s}];` } };
  const call = { id: id(), name: "Call Production Assignment Logger Only", type: "n8n-nodes-base.executeWorkflow", typeVersion: 1.3, position: [-60, 0], parameters: { source: "database", workflowId: { __rl: true, value: logger.id, mode: "list", cachedResultName: LOGGER_NAME }, mode: "once", options: { waitForSubWorkflow: true } } };
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({ name: "Temporary - Controlled PROYA Logger Test", nodes: [trigger, guard, call], connections: { [trigger.name]: connect(guard.name), [guard.name]: connect(call.name) }, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  const loggerCallerIds = logger.settings?.callerIds || "";
  logger.settings.callerPolicy = "workflowsFromAList";
  logger.settings.callerIds = [...new Set(loggerCallerIds.split(",").filter(Boolean).concat(workflow.id))].join(",");
  const allowed = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];
  const payload = { name: logger.name, nodes: logger.nodes, connections: logger.connections, settings: Object.fromEntries(allowed.filter((name) => Object.hasOwn(logger.settings || {}, name)).map((name) => [name, logger.settings[name]])) };
  await api(`/workflows/${logger.id}`, { method: "PUT", body: JSON.stringify(payload) });
  await api(`/workflows/${logger.id}/activate`, { method: "POST" });
  await api(`/workflows/${workflow.id}/activate`, { method: "POST" });

  const base = { username: "codex_logger_test", whatsapp_number: "6200000000000", expected_clips: 15 };
  const scenarios = [];
  async function invoke(name, event, expectedOk = true) {
    const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) });
    const body = await response.text();
    scenarios.push({ name, ok: response.ok, status_code: response.status, response: body.slice(0, 800) });
    if (response.ok !== expectedOk) throw new Error(`${name} expected HTTP ${expectedOk ? "success" : "failure"}, got ${response.status}: ${body.slice(0, 300)}`);
  }

  try {
    await invoke("success_start", { ...base, assignment_key: "test:success", numbered_folder: "900001", assignment_timestamp: "2026-08-06T01:00:00Z", clips_sent_count: 0, status: "Sending", phase: "start" });
    await invoke("success_complete", { ...base, assignment_key: "test:success", numbered_folder: "900001", assignment_timestamp: "2026-08-06T01:00:00Z", clips_sent_count: 15, status: "Complete", phase: "final" });
    await invoke("success_idempotent_retry", { ...base, assignment_key: "test:success", numbered_folder: "900001", assignment_timestamp: "2026-08-06T01:00:00Z", clips_sent_count: 15, status: "Complete", phase: "retry" });
    await invoke("partial", { ...base, assignment_key: "test:partial", numbered_folder: "900002", assignment_timestamp: "2026-08-06T01:10:00Z", clips_sent_count: 7, status: "Partial", error: "Controlled failure after 7 successful message IDs", phase: "final" });
    await invoke("failed", { ...base, assignment_key: "test:failed", numbered_folder: "900003", assignment_timestamp: "2026-08-06T01:20:00Z", clips_sent_count: 0, status: "Failed", error: "Controlled complete media-send failure", phase: "final" });
    await invoke("google_failure_visible", { ...base, assignment_key: "test:log-failure", numbered_folder: "900004", assignment_timestamp: "2026-08-06T01:30:00Z", clips_sent_count: 5, status: "Partial", error: "Controlled logging failure", phase: "final", simulate_sheet_failure: true }, false);
    await invoke("logging_only_retry", { ...base, assignment_key: "test:log-failure", numbered_folder: "900004", assignment_timestamp: "2026-08-06T01:30:00Z", clips_sent_count: 5, status: "Partial", error: "Controlled partial result", phase: "retry" });
    await invoke("folder_original", { ...base, assignment_key: "test:folder-preserved", numbered_folder: "900005", assignment_timestamp: "2026-08-06T02:42:18Z", clips_sent_count: 15, status: "Complete", phase: "final" });
    await invoke("folder_renamed_retry", { ...base, assignment_key: "test:folder-preserved", numbered_folder: "renamed-affiliate-folder", assignment_timestamp: "2026-08-06T02:42:18Z", clips_sent_count: 15, status: "Complete", phase: "retry" });

    const auditRoute = `proya-assignment-logger-audit-${crypto.randomUUID()}`;
    const auditTrigger = { id: id(), name: "Audit Trigger", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-300, 0], webhookId: id(), parameters: { httpMethod: "GET", path: auditRoute, responseMode: "lastNode", options: {} } };
    const read = { id: id(), name: "Read Test Rows", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-80, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/%27Delivery%20Log%27!A%3AG`, options: {} } };
    const audit = { id: id(), name: "Return Test Rows", type: "n8n-nodes-base.code", typeVersion: 2, position: [140, 0], parameters: { jsCode: `const values=$json.values||[],h=values[0]||[];return[{json:{headers:h,rows:values.slice(1).map((r,i)=>({row_number:i+2,...Object.fromEntries(h.map((n,c)=>[n,r[c]??""]))})).filter(r=>r.Username==="codex_logger_test")}}];` } };
    const auditWorkflow = await api("/workflows", { method: "POST", body: JSON.stringify({ name: "Temporary - Audit PROYA Logger Tests", nodes: [auditTrigger, read, audit], connections: { [auditTrigger.name]: connect(read.name), [read.name]: connect(audit.name) }, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
    try {
      await api(`/workflows/${auditWorkflow.id}/activate`, { method: "POST" });
      const auditResponse = await fetch(`http://localhost:5678/webhook/${auditRoute}`);
      const auditBody = await auditResponse.text();
      if (!auditResponse.ok) throw new Error(`test audit ${auditResponse.status}: ${auditBody.slice(0, 300)}`);
      const sheet = JSON.parse(auditBody);
      const rows = sheet.rows || [];
      const byFolder = new Map(rows.map((row) => [String(row["Numbered Folder"]), row]));
      const checks = {
        one_row_per_test_assignment: rows.length === 5,
        success_complete: byFolder.get("900001")?.["Clips Sent"] === "15/15" && byFolder.get("900001")?.Status === "Complete",
        partial: byFolder.get("900002")?.["Clips Sent"] === "7/15" && byFolder.get("900002")?.Status === "Partial",
        failed: byFolder.get("900003")?.["Clips Sent"] === "0/15" && byFolder.get("900003")?.Status === "Failed",
        logging_retry_without_duplicate: byFolder.get("900004")?.["Clips Sent"] === "5/15" && rows.filter((row) => row["Numbered Folder"] === "900004").length === 1,
        original_folder_preserved: Boolean(byFolder.get("900005")) && !byFolder.has("renamed-affiliate-folder"),
        jakarta_timestamp: byFolder.get("900005")?.["Sent At"] === "2026-08-06 09:42:18 WIB"
      };
      if (!Object.values(checks).every(Boolean)) throw new Error(`Controlled logger checks failed: ${JSON.stringify(checks)}`);
      const output = { tested_at: new Date().toISOString(), spreadsheet_id: SPREADSHEET_ID, logger_workflow_id: logger.id, harness_workflow_id: workflow.id, scenarios, sheet_rows: rows, checks };
      const outputPath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "logger-test-results.json");
      fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ scenarios: scenarios.map(({ name, ok, status_code }) => ({ name, ok, status_code })), checks, sheet_rows: rows }, null, 2)}\n`);
    } finally {
      try { await api(`/workflows/${auditWorkflow.id}/deactivate`, { method: "POST" }); } catch {}
      await api(`/workflows/${auditWorkflow.id}`, { method: "DELETE" });
    }
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" }); } catch {}
    await api(`/workflows/${workflow.id}`, { method: "DELETE" });
    const refreshed = await api(`/workflows/${logger.id}`);
    refreshed.settings.callerIds = loggerCallerIds;
    const restorePayload = { name: refreshed.name, nodes: refreshed.nodes, connections: refreshed.connections, settings: Object.fromEntries(allowed.filter((name) => Object.hasOwn(refreshed.settings || {}, name)).map((name) => [name, refreshed.settings[name]])) };
    await api(`/workflows/${logger.id}`, { method: "PUT", body: JSON.stringify(restorePayload) });
    await api(`/workflows/${logger.id}/activate`, { method: "POST" });
  }
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
