"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const NAME = "Temporary Recovery Test - Mark Stage 3 Pending";
const QUEUE_ID = "delivery:wa:6285178246723:TEST15-20260805:15869";

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

async function main() {
  const key = env().N8N_API_KEY;
  const recovery = await api("/workflows/p24kmXRNibNLZovt", key);
  const sourceUpdate = recovery.nodes.find((node) => node.name === "Update Recovery Queue Rows");
  if (!sourceUpdate) throw new Error("Recovery queue update node missing");
  const now = new Date().toISOString();
  const route = `codex-stage3-pending-${crypto.randomBytes(8).toString("hex")}`;
  const trigger = {
    id: crypto.randomUUID(), name: "Mark Pending Trigger",
    type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-300, 0],
    parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} },
    webhookId: crypto.randomUUID()
  };
  const update = JSON.parse(JSON.stringify(sourceUpdate));
  update.id = crypto.randomUUID();
  update.name = "Mark Existing Stage 3 Queue Pending";
  update.position = [-40, 0];
  update.continueOnFail = false;
  update.parameters.filters.conditions[0].keyValue = QUEUE_ID;
  update.parameters.columns.value = {
    status: "pending",
    updated_at: now,
    attempts: "1",
    last_error: "controlled_recovery_verification"
  };
  const desired = {
    name: NAME,
    nodes: [trigger, update],
    connections: { [trigger.name]: { main: [[{ node: update.name, type: "main", index: 0 }]] } },
    settings: { executionOrder: "v1", saveDataErrorExecution: "all", saveDataSuccessExecution: "all" }
  };
  const list = await api("/workflows?limit=250", key);
  const previous = (list.data || []).find((workflow) => workflow.name === NAME);
  if (previous?.active) await api(`/workflows/${previous.id}/deactivate`, key, { method: "POST" });
  const saved = previous
    ? await api(`/workflows/${previous.id}`, key, { method: "PUT", body: JSON.stringify(desired) })
    : await api("/workflows", key, { method: "POST", body: JSON.stringify(desired) });
  await api(`/workflows/${saved.id}/activate`, key, { method: "POST" });
  let status;
  let responseBody;
  try {
    const response = await fetch(`http://localhost:5678/webhook/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    status = response.status;
    responseBody = await response.text();
  } finally {
    await api(`/workflows/${saved.id}/deactivate`, key, { method: "POST" });
  }
  process.stdout.write(JSON.stringify({
    workflow_id: saved.id,
    queue_id: QUEUE_ID,
    marked_at_utc: now,
    http_status: status,
    response: responseBody || ""
  }, null, 2) + "\n");
  if (status < 200 || status >= 300) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
