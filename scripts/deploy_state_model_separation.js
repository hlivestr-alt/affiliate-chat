"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const BACKUP = path.join(ROOT, "n8n", "exports", "live-backups", "before-state-model-separation-20260821T1725CST", "workflows");
const STAGED = path.join(ROOT, "n8n", "exports", "state-model-separation-20260821", "staged-workflows");
const OUTPUT = path.join(ROOT, "n8n", "exports", "state-model-separation-20260821", "workflow-deployment-report.json");
const ORDER = ["PhFN97UOHrRz1Kwe", "TmpFinalize6911", "TmpReconcile6911Recovery", "AffWaDelivery2026", "AffWaReply2026", "AfDriveReady2026", "AffDistSetup2026"];
const ALLOWED_SETTINGS = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const index = line.indexOf("="); return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ["", ""]; }).filter(([key]) => key));

async function api(route, options = {}) {
  const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n ${response.status} ${route}: ${body.slice(0, 900)}`);
  return body ? JSON.parse(body) : {};
}
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value; }
function definition(workflow) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings }; }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function payload(workflow) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(ALLOWED_SETTINGS.filter((name) => Object.hasOwn(workflow.settings || {}, name)).map((name) => [name, workflow.settings[name]])) }; }
function node(workflow, name) { return workflow.nodes.find((item) => item.name === name); }
function protectedNodes(workflow) {
  return Object.fromEntries(workflow.nodes.filter((item) => /^(?:Send WhatsApp Video|Upload Video to WhatsApp|Send Non-template WhatsApp Text)$/.test(item.name)).map((item) => [item.name, hash(item)]));
}
function assertStaged(id, workflow) {
  const serialized = JSON.stringify(definition(workflow));
  if (!serialized.includes("delivery_state") || serialized.includes("WhatsApp%20Leads!A%3AAE")) throw new Error(`${id}: staged schema assertions failed`);
  if (id === "AffWaDelivery2026") {
    for (const name of ["Reserve Batch in Leads", "Update Final Send State"]) {
      const item = node(workflow, name);
      if (!item || !String(item.parameters.url).endsWith("/values:batchUpdate") || String(item.parameters.jsonBody).includes("H{row}") || String(item.parameters.jsonBody).includes("last_intent")) throw new Error(`${id}: delivery column isolation failed for ${name}`);
    }
  }
  if (id === "AffWaReply2026") {
    const item = node(workflow, "Refresh Existing WhatsApp Lead Window");
    if (!item || !String(item.parameters.url).endsWith("/values:batchUpdate") || String(item.parameters.jsonBody).includes("AF{row}") || String(item.parameters.jsonBody).includes("files_sent")) throw new Error(`${id}: conversation column isolation failed`);
  }
}

(async () => {
  const report = { deployed_at: new Date().toISOString(), whatsapp_requests: 0, sheet_writes_during_deploy: 0, workflows: [] };
  for (const id of ORDER) {
    const backup = JSON.parse(fs.readFileSync(path.join(BACKUP, `${id}.json`), "utf8"));
    const staged = JSON.parse(fs.readFileSync(path.join(STAGED, `${id}.json`), "utf8"));
    const live = await api(`/workflows/${id}`);
    const expectedHash = hash(definition(backup));
    const liveHash = hash(definition(live));
    const stagedHash = hash(definition(staged));
    const alreadyDeployed = liveHash === stagedHash;
    if (!alreadyDeployed && liveHash !== expectedHash) throw new Error(`${id}: live definition changed since backup (${liveHash} != ${expectedHash})`);
    assertStaged(id, staged);
    const protectedBefore = protectedNodes(live);
    const connectionsBefore = hash(live.connections);
    const settingsBefore = { callerPolicy: live.settings?.callerPolicy || "", callerIds: live.settings?.callerIds || "" };
    const wasActive = Boolean(live.active);
    if (!alreadyDeployed) {
      await api(`/workflows/${id}`, { method: "PUT", body: JSON.stringify(payload(staged)) });
      if (wasActive) await api(`/workflows/${id}/activate`, { method: "POST" });
    }
    const after = await api(`/workflows/${id}`);
    const protectedAfter = protectedNodes(after);
    const settingsAfter = { callerPolicy: after.settings?.callerPolicy || "", callerIds: after.settings?.callerIds || "" };
    if (after.nodes.length !== live.nodes.length) throw new Error(`${id}: node count changed`);
    if (Boolean(after.active) !== wasActive) throw new Error(`${id}: activation state changed`);
    if (hash(after.connections) !== connectionsBefore) throw new Error(`${id}: connections changed`);
    if (JSON.stringify(settingsAfter) !== JSON.stringify(settingsBefore)) throw new Error(`${id}: caller permissions changed`);
    if (JSON.stringify(protectedAfter) !== JSON.stringify(protectedBefore)) throw new Error(`${id}: protected Meta node changed`);
    assertStaged(id, after);
    report.workflows.push({
      id, active: after.active, node_count: after.nodes.length, already_deployed: alreadyDeployed, before_version_id: live.versionId,
      before_active_version_id: live.activeVersionId || "", before_definition_sha256: liveHash,
      after_version_id: after.versionId, after_active_version_id: after.activeVersionId || "",
      after_definition_sha256: hash(definition(after)), connections_sha256: hash(after.connections),
      caller_policy: settingsAfter.callerPolicy, caller_ids: settingsAfter.callerIds,
      protected_meta_nodes_sha256: protectedAfter
    });
  }
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
