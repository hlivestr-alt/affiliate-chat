"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WORKFLOW_ID = "AffWaDelivery2026";
const FILE = path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-file-delivery.json");
const ALLOWED_SETTINGS = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];

function env() {
  const result = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) result[match[1].trim()] = match[2];
  }
  return result;
}
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function api(pathname, key, options = {}) {
  const response = await fetch(API + pathname, { ...options, headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${pathname}: ${body.slice(0, 800)}`);
  return body ? JSON.parse(body) : {};
}
function payload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: Object.fromEntries(ALLOWED_SETTINGS.filter((name) => Object.hasOwn(workflow.settings || {}, name)).map((name) => [name, workflow.settings[name]])),
  };
}
function assertSafe(workflow) {
  if (workflow.id !== WORKFLOW_ID) throw new Error("delivery_workflow_id_mismatch");
  const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
  for (const name of ["Restore and Validate Delivery Context", "Validate Assigned Folder", "Read Message Log for Resume", "Prepare Batch Send Claims", "Batch Write Pre-Send Claims", "Guard Cached Media Upload", "Guard Cached Clip Send", "Prepare Batched Delivery Tracking", "Batch Write Delivery Results", "Append Message Results Batch"]) {
    if (!byName.has(name)) throw new Error(`required_delivery_node_missing:${name}`);
  }
  const selector = byName.get("Read Assigned MP4 Files")?.parameters?.fileSelector || "";
  if (!selector.includes("Restore and Validate Delivery Context") || selector.includes("$json.batch_number")) throw new Error("unsafe_delivery_file_selector");
  const serialized = JSON.stringify(workflow);
  if (/type\\?"?:\\s*\\?"template|affiliate_clip_opt_in_v1/i.test(serialized)) throw new Error("template_node_present_in_delivery");
  if (!serialized.includes("ZERO_CHARGE_MODE") || !serialized.includes("window_expires_at")) throw new Error("delivery_guards_missing");
  if (byName.get("Send WhatsApp Video")?.retryOnFail !== false || byName.get("Upload Video to WhatsApp")?.retryOnFail !== false) throw new Error("automatic_meta_retry_present");
  if (byName.has("Read Leads Immediately Before Media Upload") || byName.has("Read Leads Immediately Before Clip Send") || byName.has("Reread Delivery Log after Pre-Send Claim")) throw new Error("per_clip_sheet_read_present");
  if (byName.get("Batch Write Delivery Results")?.continueOnFail !== true || byName.get("Append Message Results Batch")?.continueOnFail !== true) throw new Error("post_send_sheet_failure_not_isolated");
  for (const name of ["Batch Write Pre-Send Claims", "Batch Write Delivery Results", "Append Message Results Batch"]) if (byName.get(name)?.maxTries !== 8) throw new Error(`sheet_429_retry_missing:${name}`);
}

async function main() {
  const key = env().N8N_API_KEY;
  if (!key) throw new Error("N8N_API_KEY is missing");
  const desired = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (process.argv.includes("--pause-callers")) {
    desired.settings = { ...(desired.settings || {}), callerPolicy: "workflowsFromAList", callerIds: "__delivery_recovery_paused__" };
  }
  assertSafe(desired);
  const before = await api(`/workflows/${WORKFLOW_ID}`, key);
  const report = {
    id: WORKFLOW_ID,
    dry_run: process.argv.includes("--dry-run"),
    active_before: Boolean(before.active),
    version_before: before.versionId,
    active_version_before: before.activeVersionId,
    nodes_before: before.nodes.length,
    hash_before: hash({ nodes: before.nodes, connections: before.connections, settings: before.settings }),
    desired_nodes: desired.nodes.length,
    desired_hash: hash(payload(desired)),
  };
  if (!report.dry_run) {
    await api(`/workflows/${WORKFLOW_ID}`, key, { method: "PUT", body: JSON.stringify(payload(desired)) });
    if (report.active_before) await api(`/workflows/${WORKFLOW_ID}/activate`, key, { method: "POST" });
    const after = await api(`/workflows/${WORKFLOW_ID}`, key);
    assertSafe(after);
    if (Boolean(after.active) !== report.active_before) throw new Error("delivery_active_state_changed");
    if (after.nodes.length !== desired.nodes.length) throw new Error("delivery_node_count_mismatch_after_deploy");
    Object.assign(report, {
      active_after: Boolean(after.active), version_after: after.versionId, active_version_after: after.activeVersionId,
      nodes_after: after.nodes.length, hash_after: hash({ nodes: after.nodes, connections: after.connections, settings: after.settings }),
    });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
