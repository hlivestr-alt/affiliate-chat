"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WORKFLOW_ID = "AffWaDelivery2026";
const ALLOWED_SETTINGS = [
  "saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution",
  "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone",
  "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution",
  "redactionPolicy", "availableInMCP", "customTelemetryTags"
];

function env() {
  const values = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) values[match[1].trim()] = match[2];
  }
  return values;
}

async function api(route, key, options = {}) {
  const response = await fetch(API + route, {
    ...options,
    headers: {
      "X-N8N-API-KEY": key,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

function payload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: Object.fromEntries(ALLOWED_SETTINGS
      .filter((name) => Object.hasOwn(workflow.settings || {}, name))
      .map((name) => [name, workflow.settings[name]]))
  };
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const key = env().N8N_API_KEY;
  if (!key) throw new Error("N8N_API_KEY missing");
  const workflow = await api(`/workflows/${WORKFLOW_ID}`, key);
  const wasActive = Boolean(workflow.active);
  const before = {
    versionId: workflow.versionId,
    activeVersionId: workflow.activeVersionId,
    nodeCount: workflow.nodes.length,
    hash: hash(payload(workflow))
  };

  const summary = workflow.nodes.find((node) => node.name === "Prepare Cached Delivery Summary");
  if (!summary) throw new Error("Prepare Cached Delivery Summary missing");
  const oldFragment = "files_expected: String(expected), files_sent: String(sent), files_delivered: String(delivered)";
  const newFragment = "files_expected: String(expected), files_sent: String(accepted), files_delivered: String(delivered)";
  const occurrences = summary.parameters.jsCode.split(oldFragment).length - 1;
  if (occurrences !== 1) throw new Error(`Expected one summary counter match, found ${occurrences}`);
  summary.parameters.jsCode = summary.parameters.jsCode.replace(oldFragment, newFragment);

  const statusConnections = workflow.connections["Prepare Durable Queue Status"]?.main?.[0];
  if (!Array.isArray(statusConnections)) throw new Error("Prepare Durable Queue Status connection missing");
  const withoutSummary = statusConnections.filter((edge) => edge.node !== "Prepare Cached Delivery Summary");
  workflow.connections["Prepare Durable Queue Status"].main[0] = [
    ...withoutSummary,
    { node: "Prepare Cached Delivery Summary", type: "main", index: 0 }
  ];
  workflow.connections["Update Durable Outbound Log Queue"] = { main: [[]] };

  await api(`/workflows/${WORKFLOW_ID}`, key, {
    method: "PUT",
    body: JSON.stringify(payload(workflow))
  });
  if (wasActive) await api(`/workflows/${WORKFLOW_ID}/activate`, key, { method: "POST" });
  const after = await api(`/workflows/${WORKFLOW_ID}`, key);
  const fanout = after.connections["Prepare Durable Queue Status"]?.main?.[0] || [];
  if (
    after.nodes.length !== before.nodeCount ||
    Boolean(after.active) !== wasActive ||
    !fanout.some((edge) => edge.node === "Update Durable Outbound Log Queue") ||
    !fanout.some((edge) => edge.node === "Prepare Cached Delivery Summary")
  ) throw new Error("Post-deploy final-state branch verification failed");

  process.stdout.write(JSON.stringify({
    workflowId: WORKFLOW_ID,
    active: after.active,
    before,
    after: {
      versionId: after.versionId,
      activeVersionId: after.activeVersionId,
      nodeCount: after.nodes.length,
      hash: hash(payload(after)),
      finalStateFanout: fanout
    },
    changes: [
      "Lead finalization no longer depends on Data Table update output",
      "files_sent records accepted outbound media count"
    ]
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
