"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW_ID = "AfDriveReady2026";
const API_BASE_URL = "http://localhost:5678/api/v1";
const TOKEN_PATTERN = /(tiktok_access_token\s*:\s*")[^"]+("\s*,?)/g;
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

function tokenOccurrences(workflow) {
  const occurrences = [];
  for (const node of workflow.nodes || []) {
    const code = node.parameters && node.parameters.jsCode;
    if (typeof code !== "string") continue;
    const matches = [...code.matchAll(TOKEN_PATTERN)];
    for (const match of matches) {
      occurrences.push({ node, token: match[0].slice(match[1].length, -match[2].length) });
    }
  }
  return occurrences;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function main() {
  const newToken = process.env.TIKTOK_NEW_ACCESS_TOKEN;
  if (!newToken || !newToken.startsWith("ROW_")) {
    throw new Error("TIKTOK_NEW_ACCESS_TOKEN is missing or has an unexpected format");
  }

  const env = readEnv(path.join(ROOT, ".env"));
  if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY is missing from .env");

  const live = await n8nRequest(`/workflows/${WORKFLOW_ID}`, env.N8N_API_KEY);
  const wasActive = Boolean(live.active);
  const before = tokenOccurrences(live);
  if (before.length === 0) throw new Error("No embedded TikTok access-token fields were found");

  const changedNodes = new Set();
  for (const { node } of before) {
    const code = node.parameters.jsCode;
    const updated = code.replace(TOKEN_PATTERN, `$1${newToken}$2`);
    if (updated !== code) {
      node.parameters.jsCode = updated;
      changedNodes.add(node.name);
    }
  }

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

  const verified = await n8nRequest(`/workflows/${WORKFLOW_ID}`, env.N8N_API_KEY);
  const after = tokenOccurrences(verified);
  if (after.length !== before.length || after.some(({ token }) => token !== newToken)) {
    throw new Error("Live verification failed: not every embedded token was updated");
  }
  if (Boolean(verified.active) !== wasActive) {
    throw new Error("The workflow active state changed unexpectedly");
  }

  process.stdout.write(JSON.stringify({
    workflowId: verified.id,
    workflowName: verified.name,
    active: verified.active,
    changedNodes: [...changedNodes],
    tokenFieldsVerified: after.length,
    tokenFingerprint: fingerprint(newToken),
    updatedAt: verified.updatedAt,
    versionId: verified.versionId,
    activeVersionId: verified.activeVersionId
  }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
