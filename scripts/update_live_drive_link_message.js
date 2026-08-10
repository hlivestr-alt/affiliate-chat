"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW_ID = "AfDriveReady2026";
const TARGET_NODE_NAMES = ["Select Assignment", "Build Assigned State"];
const API_BASE_URL = "http://localhost:5678/api/v1";
const UPDATABLE_SETTING_NAMES = [
  "saveExecutionProgress",
  "saveManualExecutions",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "executionTimeout",
  "errorWorkflow",
  "timezone",
  "executionOrder",
  "callerPolicy",
  "callerIds",
  "timeSavedPerExecution",
  "redactionPolicy",
  "availableInMCP",
  "customTelemetryTags"
];

function readEnv(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return values;
}

async function n8nRequest(pathname, apiKey, options = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": apiKey,
      ...(options.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      ...options.headers
    }
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`n8n API ${response.status}: ${responseText.slice(0, 1000)}`);
  }
  return responseText ? JSON.parse(responseText) : null;
}

function nodeByName(workflow, name) {
  return (workflow.nodes || []).find((node) => node.name === name);
}

async function main() {
  const env = readEnv(path.join(ROOT, ".env"));
  if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY is missing from .env");

  const generated = JSON.parse(fs.readFileSync(
    path.join(ROOT, "n8n", "imports", "affiliate-drive-rename-handoff-ready.json"),
    "utf8"
  ));
  const live = await n8nRequest(`/workflows/${WORKFLOW_ID}`, env.N8N_API_KEY);
  const wasActive = Boolean(live.active);
  let changedNodes = 0;

  for (const name of TARGET_NODE_NAMES) {
    const generatedNode = nodeByName(generated, name);
    const liveNode = nodeByName(live, name);
    if (!generatedNode || !liveNode) throw new Error(`Missing target node: ${name}`);

    const generatedCode = generatedNode.parameters && generatedNode.parameters.jsCode;
    if (
      typeof generatedCode !== "string" ||
      !generatedCode.includes("Halo Kak, terima kasih sudah bergabung sebagai Affiliate PROYA! 😊") ||
      !generatedCode.includes("Semoga video Kakak mendapatkan hasil yang bagus")
    ) {
      throw new Error(`Generated node does not contain the approved message: ${name}`);
    }

    if (liveNode.parameters.jsCode !== generatedCode) {
      liveNode.parameters.jsCode = generatedCode;
      changedNodes += 1;
    }
  }

  if (changedNodes > 0) {
    const settings = Object.fromEntries(
      UPDATABLE_SETTING_NAMES
        .filter((name) => Object.prototype.hasOwnProperty.call(live.settings || {}, name))
        .map((name) => [name, live.settings[name]])
    );
    const payload = {
      name: live.name,
      nodes: live.nodes,
      connections: live.connections,
      settings
    };
    if (live.staticData != null) payload.staticData = live.staticData;

    await n8nRequest(`/workflows/${WORKFLOW_ID}`, env.N8N_API_KEY, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  const verified = await n8nRequest(`/workflows/${WORKFLOW_ID}`, env.N8N_API_KEY);
  for (const name of TARGET_NODE_NAMES) {
    const generatedCode = nodeByName(generated, name).parameters.jsCode;
    const verifiedCode = nodeByName(verified, name)?.parameters?.jsCode;
    if (verifiedCode !== generatedCode) {
      throw new Error(`Live verification failed for node: ${name}`);
    }
  }
  if (Boolean(verified.active) !== wasActive) {
    throw new Error("The workflow active state changed unexpectedly");
  }

  process.stdout.write(JSON.stringify({
    workflowId: verified.id,
    workflowName: verified.name,
    active: verified.active,
    changedNodes,
    verifiedNodes: TARGET_NODE_NAMES,
    updatedAt: verified.updatedAt
  }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
