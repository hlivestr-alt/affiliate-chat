"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "n8n", "exports", "row-shape-recovery-6942-6943-20260824");
const API = "http://localhost:5678/api/v1";
const DELIVERY_ID = "AffWaDelivery2026";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => {
  const index = line.indexOf("=");
  return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1)] : ["", ""];
}).filter(([key]) => key));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function nodeDefinition(node) {
  return {
    type: node.type,
    typeVersion: node.typeVersion,
    parameters: node.parameters,
    credentials: node.credentials,
    retryOnFail: node.retryOnFail,
    maxTries: node.maxTries,
    waitBetweenTries: node.waitBetweenTries,
    continueOnFail: node.continueOnFail,
    onError: node.onError,
    disabled: node.disabled,
  };
}
async function api(route) {
  const response = await fetch(`${API}${route}`, { headers: { "X-N8N-API-KEY": env.N8N_API_KEY } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n_${response.status}:${route}:${body.slice(0, 500)}`);
  return JSON.parse(body);
}

(async () => {
  if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY missing");
  fs.mkdirSync(OUT, { recursive: true });
  const workflow = await api(`/workflows/${DELIVERY_ID}`);
  const definition = { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings };
  const groups = {
    validators: ["Validate Immediate Successful Send", "Confirm Successful Clip Durable"],
    media_upload: ["Upload Video to WhatsApp", "Parse Media Upload", "IF Media Upload Succeeded"],
    meta_send: ["Send WhatsApp Video", "Parse Video Send", "IF File Send Succeeded"],
    authorization_guards: ["Guard Cached Media Upload", "IF Cached Media Upload Authorized", "Guard Cached Clip Send", "IF Cached Clip Send Authorized"],
    clip_selection: ["Select and Prepare Batch Reservation", "Restore and Validate Delivery Context", "Prepare Resumable Delivery Items", "Prepare Batch Send Claims", "Prepare In-Flight Send Claim"],
    conversation_delivery_state: ["Prepare Batched Delivery Tracking", "Prepare Cached Delivery Summary", "Update Final Send State", "Prepare Zero-Remaining Recovery Finalization"],
    simple_log: ["Prepare Assignment Start Log", "Log Assignment Start (Nonblocking)", "Prepare Assignment Final Log", "Log Assignment Final (Nonblocking)"],
  };
  const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const missing = Object.values(groups).flat().filter((name) => !nodeByName.has(name));
  if (missing.length) throw new Error(`phase0_node_missing:${missing.join(",")}`);
  const nodeHashes = Object.fromEntries(Object.entries(groups).map(([group, names]) => [group, Object.fromEntries(names.map((name) => [name, hash(nodeDefinition(nodeByName.get(name)))]))]));
  const credentialReferences = workflow.nodes.flatMap((node) => Object.entries(node.credentials || {}).map(([type, value]) => ({ node: node.name, type, id: value.id || "", name: value.name || "" })));
  const manifest = {
    captured_at: new Date().toISOString(),
    workflow: {
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      version_id: workflow.versionId,
      active_version_id: workflow.activeVersionId || "",
      updated_at: workflow.updatedAt,
      definition_sha256: hash(definition),
      api_payload_sha256: hash({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings }),
      caller_policy: workflow.settings?.callerPolicy || "",
      caller_ids: workflow.settings?.callerIds || "",
    },
    node_hashes: nodeHashes,
    credential_references: credentialReferences,
  };
  fs.writeFileSync(path.join(OUT, "AffWaDelivery2026.before.json"), `${JSON.stringify(workflow, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(OUT, "phase0-workflow-integrity.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output: OUT, ...manifest }, null, 2)}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
