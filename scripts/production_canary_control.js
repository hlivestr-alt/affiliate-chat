"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WORKFLOW_ID = "AffWaDelivery2026";
const EXPECTED_VERSION = "9900c0a2-5f14-4ee2-8a6e-adcf0f0a7b37";
const EXPECTED_HASH = "47f0450e2346166d2ce5ce8649af75317e06006c08caac205c0e06caebd51423";
const ENABLED_HASH = "043d8a45996c95ffe88c7e89152d4ac46f4285944a34c65c3c017032a976d593";
const PAUSED_CALLER = "__delivery_recovery_paused__";
const NORMAL_CALLER = "AffWaReply2026";
const OUT = path.join(ROOT, "n8n", "exports", "production-canary-20260828");
const ALLOWED_SETTINGS = [
  "saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution",
  "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone",
  "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution",
  "redactionPolicy", "availableInMCP", "customTelemetryTags"
];

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8")
  .split(/\r?\n/)
  .map((line) => { const index = line.indexOf("="); return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1)] : ["", ""]; })
  .filter(([key]) => key));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function definition(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings };
}

function payload(workflow, settings) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: Object.fromEntries(ALLOWED_SETTINGS.filter((key) => Object.hasOwn(settings, key)).map((key) => [key, settings[key]]))
  };
}

async function api(route, options = {}) {
  const response = await fetch(API + route, {
    ...options,
    headers: {
      "X-N8N-API-KEY": env.N8N_API_KEY,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n_${response.status}:${route}:${body.slice(0, 800)}`);
  return body ? JSON.parse(body) : {};
}

function node(workflow, name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  if (!result) throw new Error(`missing_node:${name}`);
  return result;
}

function inspect(workflow) {
  const doneEdges = (workflow.connections?.["Done: Delivery Send Attempt"]?.main || []).flat();
  const validateCode = String(node(workflow, "Validate Immediate Successful Send").parameters?.jsCode || "");
  const targetCode = String(node(workflow, "Prepare Successful Clip Read-Back Target").parameters?.jsCode || "");
  const confirmCode = String(node(workflow, "Confirm Successful Clip Durable").parameters?.jsCode || "");
  const claimCode = String(node(workflow, "Prepare In-Flight Send Claim").parameters?.jsCode || "");
  const reservationCode = String(node(workflow, "Select and Prepare Batch Reservation").parameters?.jsCode || "");
  const readbackUrl = String(node(workflow, "Read Back Persisted Successful Clip").parameters?.url || "");
  const upload = node(workflow, "Upload Video to WhatsApp");
  const send = node(workflow, "Send WhatsApp Video");
  const checks = {
    active_known_version: workflow.active === true && workflow.versionId === EXPECTED_VERSION && workflow.activeVersionId === EXPECTED_VERSION,
    known_definition_hash: [EXPECTED_HASH, ENABLED_HASH].includes(hash(definition(workflow))),
    repaired_edge: doneEdges.length === 1 && doneEdges[0].node === "Prepare Assignment Final Log" && doneEdges[0].index === 0,
    separate_delivery_state: reservationCode.includes("delivery_state") && node(workflow, "Update Final Send State").parameters?.method === "POST",
    column_scoped_writes: String(node(workflow, "Update Final Send State").parameters?.jsonBody || "").includes("WhatsApp Leads!P{row}:U{row}") && String(node(workflow, "Update Final Send State").parameters?.jsonBody || "").includes("WhatsApp Leads!AF{row}:AF{row}"),
    outcome_uncertain: claimCode.includes("outcome_uncertain"),
    immediate_wamid_persistence: validateCode.includes("whatsapp_message_id") && node(workflow, "Persist Successful Clip Immediately").type === "n8n-nodes-base.httpRequest",
    exact_row_readback: targetCode.includes("delivery_log_row_number") && targetCode.includes("successful_clip_readback_url") && readbackUrl.includes("$json.successful_clip_readback_url"),
    trailing_blank_normalization: confirmCode.includes("while (row.length < 18) row.push(\"\")"),
    missing_row_number_fail_closed: targetCode.includes("successful_clip_readback_row_number_invalid"),
    identical_wamid_idempotency: validateCode.includes("alreadyDurable") && validateCode.includes("existingMessageId === text(source.whatsapp_message_id)"),
    conflicting_wamid_protection: validateCode.includes("successful_message_id_conflict") && validateCode.includes("successful_message_log_id_conflict"),
    meta_credentials_present: Boolean(upload.credentials?.httpHeaderAuth?.id) && upload.credentials?.httpHeaderAuth?.id === send.credentials?.httpHeaderAuth?.id,
    meta_node_types_unchanged: upload.type === "n8n-nodes-base.httpRequest" && send.type === "n8n-nodes-base.httpRequest",
    caller_policy_unchanged: workflow.settings?.callerPolicy === "workflowsFromAList"
  };
  return { checks, all_passed: Object.values(checks).every(Boolean), definition_sha256: hash(definition(workflow)), node_sha256: hash(workflow.nodes), connection_sha256: hash(workflow.connections), settings_sha256: hash(workflow.settings), meta: { upload_sha256: hash(upload), send_sha256: hash(send), credential_id: upload.credentials.httpHeaderAuth.id } };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mode = process.argv[2] || "preflight";
  const before = await api(`/workflows/${WORKFLOW_ID}`);
  const inspection = inspect(before);
  if (!inspection.all_passed) throw new Error(`preflight_failed:${JSON.stringify(inspection.checks)}`);
  const expectedCaller = mode === "unpause" ? PAUSED_CALLER : (mode === "pause" ? NORMAL_CALLER : before.settings?.callerIds);
  if (before.settings?.callerIds !== expectedCaller) throw new Error(`unexpected_caller_state:${before.settings?.callerIds}`);
  let after = before;
  if (mode === "unpause" || mode === "pause") {
    const callerIds = mode === "unpause" ? NORMAL_CALLER : PAUSED_CALLER;
    const settings = { ...before.settings, callerIds };
    await api(`/workflows/${WORKFLOW_ID}`, { method: "PUT", body: JSON.stringify(payload(before, settings)) });
    if (before.active) await api(`/workflows/${WORKFLOW_ID}/activate`, { method: "POST" });
    after = await api(`/workflows/${WORKFLOW_ID}`);
    if (!after.active || after.activeVersionId !== after.versionId) throw new Error("workflow_not_active_after_control_change");
    if (after.settings?.callerIds !== callerIds) throw new Error("caller_control_change_not_persisted");
    if (hash(after.nodes) !== inspection.node_sha256 || hash(after.connections) !== inspection.connection_sha256) throw new Error("workflow_definition_changed_beyond_operational_control");
    if (after.settings?.callerPolicy !== before.settings?.callerPolicy) throw new Error("caller_policy_changed");
  }
  const report = {
    mode,
    recorded_at: new Date().toISOString(),
    before: { version_id: before.versionId, active_version_id: before.activeVersionId, active: before.active, caller_policy: before.settings?.callerPolicy, caller_ids: before.settings?.callerIds, ...inspection },
    after: { version_id: after.versionId, active_version_id: after.activeVersionId, active: after.active, caller_policy: after.settings?.callerPolicy, caller_ids: after.settings?.callerIds, definition_sha256: hash(definition(after)), node_sha256: hash(after.nodes), connection_sha256: hash(after.connections) },
    only_operational_caller_control_changed: hash(before.nodes) === hash(after.nodes) && hash(before.connections) === hash(after.connections)
  };
  const file = path.join(OUT, `${new Date().toISOString().replace(/[:.]/g, "-")}-${mode}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify({ file, ...report }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
