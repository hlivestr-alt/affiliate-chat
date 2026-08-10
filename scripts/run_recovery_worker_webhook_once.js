"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WORKFLOW_ID = "p24kmXRNibNLZovt";
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

async function main() {
  const key = env().N8N_API_KEY;
  const original = await api(`/workflows/${WORKFLOW_ID}`, key);
  const wasActive = Boolean(original.active);
  const route = `codex-recovery-once-${crypto.randomBytes(8).toString("hex")}`;
  const temporary = JSON.parse(JSON.stringify(original));
  const trigger = {
    id: crypto.randomUUID(), name: "Temporary Recovery Verification Webhook",
    type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-980, 180],
    parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} },
    webhookId: crypto.randomUUID()
  };
  temporary.nodes.push(trigger);
  temporary.connections[trigger.name] = {
    main: [[{ node: "Ensure Outbound Log Recovery Table", type: "main", index: 0 }]]
  };

  let status = 0;
  let responseBody = "";
  try {
    await api(`/workflows/${WORKFLOW_ID}`, key, {
      method: "PUT", body: JSON.stringify(payload(temporary))
    });
    await api(`/workflows/${WORKFLOW_ID}/activate`, key, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    status = response.status;
    responseBody = await response.text();
  } finally {
    try {
      await api(`/workflows/${WORKFLOW_ID}`, key, {
        method: "PUT", body: JSON.stringify(payload(original))
      });
      if (wasActive) await api(`/workflows/${WORKFLOW_ID}/activate`, key, { method: "POST" });
      else await api(`/workflows/${WORKFLOW_ID}/deactivate`, key, { method: "POST" });
    } catch (restoreError) {
      process.stderr.write(`RESTORE FAILED: ${restoreError.stack || restoreError.message}\n`);
      process.exitCode = 2;
    }
  }
  const restored = await api(`/workflows/${WORKFLOW_ID}`, key);
  process.stdout.write(JSON.stringify({
    workflow_id: WORKFLOW_ID,
    http_status: status,
    response: responseBody ? JSON.parse(responseBody) : {},
    restored: {
      active: restored.active,
      node_count: restored.nodes.length,
      temporary_trigger_present: restored.nodes.some((node) => node.name === trigger.name)
    }
  }, null, 2) + "\n");
  if (status < 200 || status >= 300) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
