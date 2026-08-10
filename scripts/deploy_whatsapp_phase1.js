"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const FILES = [
  "affiliate-whatsapp-opt-in.json",
  "affiliate-whatsapp-webhook-router.json",
  "affiliate-whatsapp-status.json",
  "affiliate-whatsapp-reply-status.json",
  "affiliate-whatsapp-file-delivery.json",
  "affiliate-distribution-setup.json"
];
const ALLOWED_SETTINGS = [
  "saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution",
  "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone",
  "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution",
  "redactionPolicy", "availableInMCP", "customTelemetryTags"
];

function envFile() {
  const result = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

async function request(pathname, key, options = {}) {
  const response = await fetch(API + pathname, {
    ...options,
    headers: {
      "X-N8N-API-KEY": key,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${pathname}: ${body.slice(0, 600)}`);
  return body ? JSON.parse(body) : null;
}

function payload(desired, live) {
  const liveWebhooks = new Map((live.nodes || [])
    .filter((item) => item.type === "n8n-nodes-base.webhook")
    .map((item) => [item.name, item]));
  const nodes = desired.nodes.map((item) => {
    const existing = liveWebhooks.get(item.name);
    return existing
      ? { ...item, id: existing.id, webhookId: existing.webhookId, parameters: existing.parameters }
      : item;
  });
  const settings = Object.fromEntries(ALLOWED_SETTINGS
    .filter((name) => Object.prototype.hasOwnProperty.call(desired.settings || {}, name))
    .map((name) => [name, desired.settings[name]]));
  return { name: desired.name, nodes, connections: desired.connections, settings };
}

function callbackShape(workflow) {
  const node = workflow.nodes.find((item) =>
    item.type === "n8n-nodes-base.webhook" && item.parameters?.path === "whatsapp-callback"
  );
  return node ? {
    node_id: node.id,
    webhook_id: node.webhookId,
    method: node.parameters.httpMethod,
    path: node.parameters.path,
    response_mode: node.parameters.responseMode,
    raw_body: node.parameters.options?.rawBody === true
  } : null;
}

async function main() {
  const key = envFile().N8N_API_KEY;
  if (!key) throw new Error("N8N_API_KEY is missing");
  const results = [];
  for (const file of FILES) {
    const desired = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", file), "utf8"));
    const before = await request(`/workflows/${desired.id}`, key);
    const activeBefore = Boolean(before.active);
    const callbackBefore = callbackShape(before);
    await request(`/workflows/${desired.id}`, key, {
      method: "PUT", body: JSON.stringify(payload(desired, before))
    });
    if (activeBefore) {
      await request(`/workflows/${desired.id}/activate`, key, { method: "POST" });
    }
    const after = await request(`/workflows/${desired.id}`, key);
    if (Boolean(after.active) !== activeBefore) {
      throw new Error(`Active state changed for ${desired.id}`);
    }
    const callbackAfter = callbackShape(after);
    if (callbackBefore && JSON.stringify(callbackBefore) !== JSON.stringify(callbackAfter)) {
      throw new Error(`Webhook identity or behavior changed for ${desired.id}`);
    }
    results.push({
      id: after.id, name: after.name, active_before: activeBefore,
      active_after: Boolean(after.active), node_count: after.nodes.length,
      callback: callbackAfter
    });
  }
  const setup = results.find((item) => item.id === "AffDistSetup2026");
  if (!setup || setup.active_after) throw new Error("AffDistSetup2026 must remain inactive");
  process.stdout.write(`${JSON.stringify({ deployed_at: new Date().toISOString(), workflows: results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
