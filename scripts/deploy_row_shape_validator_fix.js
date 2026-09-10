"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "n8n", "exports", "row-shape-recovery-6942-6943-20260824");
const API = "http://localhost:5678/api/v1";
const ID = "AffWaDelivery2026";
const APPLY = process.argv.includes("--apply");
const EXPECTED_BEFORE_VERSION = "7485fa25-19d2-478e-8fe5-2895be15297f";
const EXPECTED_BEFORE_HASH = "533d078865fa60a062d2e16a63fcc181477d2acdf105dbcbe7810c8cc66c28af";
const TARGETS = {
  "Validate Immediate Successful Send": path.join(ROOT, "n8n", "code", "validate-immediate-successful-send.js"),
  "Confirm Successful Clip Durable": path.join(ROOT, "n8n", "code", "confirm-successful-clip-durable.js"),
};
const ALLOWED_SETTINGS = ["saveExecutionProgress","saveManualExecutions","saveDataErrorExecution","saveDataSuccessExecution","executionTimeout","errorWorkflow","timezone","executionOrder","callerPolicy","callerIds","timeSavedPerExecution","redactionPolicy","availableInMCP","customTelemetryTags"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const index = line.indexOf("="); return index > 0 ? [line.slice(0,index).trim(), line.slice(index + 1)] : ["",""]; }).filter(([key]) => key));
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value; }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function definition(workflow) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings }; }
function nodeDefinition(node) { return { type:node.type,typeVersion:node.typeVersion,parameters:node.parameters,credentials:node.credentials,retryOnFail:node.retryOnFail,maxTries:node.maxTries,waitBetweenTries:node.waitBetweenTries,continueOnFail:node.continueOnFail,onError:node.onError,disabled:node.disabled }; }
function payload(workflow) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(ALLOWED_SETTINGS.filter((key) => Object.hasOwn(workflow.settings || {}, key)).map((key) => [key, workflow.settings[key]])) }; }
async function api(route, options = {}) { const response = await fetch(`${API}${route}`, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n_${response.status}:${route}:${body.slice(0,500)}`); return body ? JSON.parse(body) : {}; }

(async () => {
  if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY missing");
  fs.mkdirSync(OUT, { recursive: true });
  const before = await api(`/workflows/${ID}`);
  if (before.versionId !== EXPECTED_BEFORE_VERSION || hash(definition(before)) !== EXPECTED_BEFORE_HASH) throw new Error("active_delivery_changed_since_phase0");
  if (!before.active || before.activeVersionId !== before.versionId) throw new Error("delivery_not_active_on_phase0_version");
  const proposed = structuredClone(before);
  const beforeNodeHashes = Object.fromEntries(before.nodes.map((node) => [node.name, hash(nodeDefinition(node))]));
  for (const [name, file] of Object.entries(TARGETS)) {
    const node = proposed.nodes.find((candidate) => candidate.name === name);
    if (!node || node.type !== "n8n-nodes-base.code") throw new Error(`validator_node_missing:${name}`);
    node.parameters.jsCode = fs.readFileSync(file, "utf8");
  }
  const proposedNodeHashes = Object.fromEntries(proposed.nodes.map((node) => [node.name, hash(nodeDefinition(node))]));
  const changedNodes = Object.keys(beforeNodeHashes).filter((name) => beforeNodeHashes[name] !== proposedNodeHashes[name]);
  if (JSON.stringify(changedNodes.sort()) !== JSON.stringify(Object.keys(TARGETS).sort())) throw new Error(`unexpected_proposed_nodes:${changedNodes.join(",")}`);
  if (hash(before.connections) !== hash(proposed.connections) || hash(before.settings) !== hash(proposed.settings)) throw new Error("connections_or_settings_changed_in_proposal");
  let after = before;
  if (APPLY) {
    await api(`/workflows/${ID}`, { method: "PUT", body: JSON.stringify(payload(proposed)) });
    await api(`/workflows/${ID}/activate`, { method: "POST" });
    after = await api(`/workflows/${ID}`);
  }
  const afterNodeHashes = Object.fromEntries(after.nodes.map((node) => [node.name, hash(nodeDefinition(node))]));
  const liveChangedNodes = Object.keys(beforeNodeHashes).filter((name) => beforeNodeHashes[name] !== afterNodeHashes[name]);
  const otherNodesUnchanged = Object.keys(beforeNodeHashes).filter((name) => !Object.hasOwn(TARGETS, name)).every((name) => beforeNodeHashes[name] === afterNodeHashes[name]);
  const credentialsUnchanged = hash(before.nodes.map((node) => ({ name: node.name, credentials: node.credentials || {} }))) === hash(after.nodes.map((node) => ({ name: node.name, credentials: node.credentials || {} })));
  const verification = {
    active: after.active,
    active_version_id: after.activeVersionId || "",
    version_id: after.versionId,
    definition_sha256: hash(definition(after)),
    changed_nodes: liveChangedNodes,
    other_nodes_unchanged: otherNodesUnchanged,
    connections_unchanged: hash(before.connections) === hash(after.connections),
    settings_unchanged: hash(before.settings) === hash(after.settings),
    caller_permissions_unchanged: before.settings?.callerPolicy === after.settings?.callerPolicy && String(before.settings?.callerIds || "") === String(after.settings?.callerIds || ""),
    credentials_unchanged: credentialsUnchanged,
  };
  if (APPLY && (!verification.active || after.activeVersionId !== after.versionId || JSON.stringify(liveChangedNodes.sort()) !== JSON.stringify(Object.keys(TARGETS).sort()) || !otherNodesUnchanged || !verification.connections_unchanged || !verification.settings_unchanged || !verification.caller_permissions_unchanged || !credentialsUnchanged)) throw new Error("post_deploy_integrity_failed");
  fs.writeFileSync(path.join(OUT, "AffWaDelivery2026.after-validator-fix.json"), `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 });
  const report = { mode: APPLY ? "applied" : "dry_run", captured_at: new Date().toISOString(), before: { version_id: before.versionId, active_version_id: before.activeVersionId, definition_sha256: hash(definition(before)) }, proposed: { definition_sha256: hash(definition(proposed)), changed_nodes: changedNodes }, after: verification, node_hashes: { before: Object.fromEntries(Object.keys(TARGETS).map((name) => [name, beforeNodeHashes[name]])), after: Object.fromEntries(Object.keys(TARGETS).map((name) => [name, afterNodeHashes[name]])) } };
  fs.writeFileSync(path.join(OUT, "validator-deployment-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
