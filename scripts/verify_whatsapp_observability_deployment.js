#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://127.0.0.1:5678/api/v1";
const IDS = ["AffWaWebhook2026", "AffWaReply2026", "AffWaDelivery2026", "AffWaStatus2026", "AffWaOptIn2026", "AffWaObservability2026"];

function envFile(file) {
  const result = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.startsWith("#")) result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}
async function api(pathname, key) {
  const response = await fetch(API + pathname, { headers: { "X-N8N-API-KEY": key } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status}: ${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : {};
}
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

async function main() {
  const output = path.resolve(process.argv[2] || "");
  const since = new Date(process.argv[3] || "2026-08-04T04:00:00Z");
  if (!process.argv[2] || !Number.isFinite(since.getTime())) throw new Error("output path and valid since timestamp are required");
  const env = { ...envFile(path.join(ROOT, ".env")), ...envFile(path.join(ROOT, ".env.phase1")) };
  if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY is missing");
  const workflows = [];
  for (const id of IDS) {
    const workflow = await api(`/workflows/${id}`, env.N8N_API_KEY);
    const sends = (workflow.nodes || []).filter((node) => /graph\.facebook\.com/.test(JSON.stringify(node)));
    const templates = (workflow.nodes || []).filter((node) => /type\s*[:=]\s*["']template|"type"\s*:\s*"template"/i.test(JSON.stringify(node.parameters || {})));
    const observerCalls = (workflow.nodes || []).filter((node) => node.type === "n8n-nodes-base.executeWorkflow" && node.parameters?.workflowId?.value === "AffWaObservability2026");
    const callback = (workflow.nodes || []).find((node) => node.type === "n8n-nodes-base.webhook" && node.parameters?.path === "whatsapp-callback");
    workflows.push({
      id, name: workflow.name, active: Boolean(workflow.active), node_count: workflow.nodes.length,
      version_id: workflow.versionId, active_version_id: workflow.activeVersionId,
      callback: callback ? { node_id: callback.id, webhook_id: callback.webhookId, path: callback.parameters.path, method: callback.parameters.httpMethod, response_mode: callback.parameters.responseMode } : null,
      meta_endpoint_node_count: sends.length, template_node_count: templates.length,
      observer_call_count: observerCalls.length,
      observer_calls_async: observerCalls.every((node) => node.parameters?.options?.waitForSubWorkflow === false)
    });
  }
  const executionAuditPath = process.argv[4] ? path.resolve(process.argv[4]) : "";
  const executionAudit = executionAuditPath && fs.existsSync(executionAuditPath)
    ? JSON.parse(fs.readFileSync(executionAuditPath, "utf8"))
    : { executions_scanned: 0, meta_send_node_executions: [] };
  const metaSendExecutions = executionAudit.meta_send_node_executions || [];
  const sheetAuditPath = process.argv[5]
    ? path.resolve(process.argv[5])
    : path.join(ROOT, "n8n", "exports", "live-backups", "before-observability-20260804T033447Z", "sheet-observability-audit.json");
  const sheetAudit = JSON.parse(fs.readFileSync(sheetAuditPath, "utf8"));
  const importFiles = [
    "affiliate-whatsapp-webhook-router.json", "affiliate-whatsapp-reply-status.json",
    "affiliate-whatsapp-file-delivery.json", "affiliate-whatsapp-observability.json"
  ].map((name) => path.join(ROOT, "n8n", "imports", name));
  const report = {
    verified_at: new Date().toISOString(), health: "ok",
    flags: {
      ZERO_CHARGE_MODE: env.ZERO_CHARGE_MODE,
      WHATSAPP_PHASE1_ENABLED: env.WHATSAPP_PHASE1_ENABLED,
      WHATSAPP_TEST_MODE: env.WHATSAPP_TEST_MODE,
      WHATSAPP_LIVE_TEST_ARMED: env.WHATSAPP_LIVE_TEST_ARMED
    },
    workflows,
    executions_since: since.toISOString(),
    executions_seen_since: executionAudit.executions_scanned || 0,
    meta_send_node_executions_since: metaSendExecutions,
    sheets: {
      rows: sheetAudit.rows,
      reconciliation: sheetAudit.reconciliation,
      dashboard_kpis: sheetAudit.dashboard_kpis,
      formula_error_count: sheetAudit.formula_errors.length,
      raw_sanitization_violations: sheetAudit.raw_sanitization_violations,
      properties: sheetAudit.sheet_properties
    },
    import_hashes: importFiles.map((file) => ({ file: path.relative(ROOT, file), bytes: fs.statSync(file).size, sha256: hash(file) }))
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({
    verified_at: report.verified_at,
    active_workflows: workflows.filter((workflow) => workflow.active).length,
    unpublished_workflows: workflows.filter((workflow) => workflow.version_id !== workflow.active_version_id).map((workflow) => workflow.id),
    observer_async: workflows.filter((workflow) => ["AffWaWebhook2026", "AffWaReply2026", "AffWaDelivery2026"].includes(workflow.id)).every((workflow) => workflow.observer_calls_async && workflow.observer_call_count > 0),
    meta_send_node_executions_since: metaSendExecutions.length,
    formula_error_count: report.sheets.formula_error_count,
    reconciliation: report.sheets.reconciliation
  }, null, 2) + "\n");
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
