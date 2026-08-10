"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API_BASE = "http://localhost:5678/api/v1";
const WEBHOOK_BASE = "http://localhost:5678/webhook";
const SETUP_ID = "AffDistSetup2026";
const SETUP_PATH = "setup-affiliate-distribution-2026";
const LIVE_PROCESSOR_ID = "AfDriveReady2026";

const WORKFLOW_FILES = Object.freeze([
  "affiliate-whatsapp-opt-in.json",
  "affiliate-whatsapp-webhook-verification.json",
  "affiliate-whatsapp-webhook-router.json",
  "affiliate-whatsapp-status.json",
  "affiliate-whatsapp-reply-status.json",
  "affiliate-whatsapp-file-delivery.json",
  "affiliate-human-queue.json",
  "affiliate-distribution-setup.json"
]);

const ALLOWED_SETTINGS = Object.freeze([
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
]);

function readEnv(filePath) {
  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
}

async function request(pathname, apiKey, options = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": apiKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `n8n API ${response.status} ${pathname}: ${responseText.slice(0, 800)}`
    );
  }
  return responseText ? JSON.parse(responseText) : null;
}

function payload(workflow) {
  const settings = Object.fromEntries(
    ALLOWED_SETTINGS
      .filter((name) =>
        Object.prototype.hasOwnProperty.call(workflow.settings || {}, name)
      )
      .map((name) => [name, workflow.settings[name]])
  );
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings
  };
}

async function updateInactiveWorkflows(apiKey) {
  const results = [];
  for (const fileName of WORKFLOW_FILES) {
    const workflow = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n", "imports", fileName), "utf8")
    );
    const current = await request(`/workflows/${workflow.id}`, apiKey);
    if (current.active) {
      await request(`/workflows/${workflow.id}/deactivate`, apiKey, {
        method: "POST"
      });
    }
    await request(`/workflows/${workflow.id}`, apiKey, {
      method: "PUT",
      body: JSON.stringify(payload(workflow))
    });
    const verified = await request(`/workflows/${workflow.id}`, apiKey);
    if (verified.active) {
      throw new Error(`${workflow.name} must remain inactive during staging`);
    }
    results.push({
      id: verified.id,
      name: verified.name,
      active: verified.active,
      node_count: verified.nodes.length
    });
  }
  return results;
}

async function runSheetSetup(apiKey) {
  const before = await request(`/workflows/${SETUP_ID}`, apiKey);
  let activated = false;
  try {
    if (!before.active) {
      await request(`/workflows/${SETUP_ID}/activate`, apiKey, {
        method: "POST"
      });
      activated = true;
    }
    const response = await fetch(`${WEBHOOK_BASE}/${SETUP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Setup webhook ${response.status}: ${responseText.slice(0, 1000)}`
      );
    }
    const result = responseText ? JSON.parse(responseText) : {};
    if (!result.ready) {
      throw new Error(`Sheet setup verification failed: ${responseText}`);
    }
    return result;
  } finally {
    if (activated) {
      await request(`/workflows/${SETUP_ID}/deactivate`, apiKey, {
        method: "POST"
      });
    }
  }
}

async function assertLiveHandoffUntouched(apiKey) {
  const workflow = await request(`/workflows/${LIVE_PROCESSOR_ID}`, apiKey);
  const hasDistributionHandoff = (workflow.nodes || []).some(
    (item) => item.name === "Dispatch WhatsApp Opt-in"
  );
  return {
    id: workflow.id,
    active: workflow.active,
    distribution_handoff_installed: hasDistributionHandoff
  };
}

async function main() {
  const env = readEnv(path.join(ROOT, ".env"));
  if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY is missing from .env");
  const args = new Set(process.argv.slice(2));
  const result = {};
  if (args.has("--refresh-inactive")) {
    result.workflows = await updateInactiveWorkflows(env.N8N_API_KEY);
  }
  if (args.has("--setup-sheets")) {
    result.sheet_setup = await runSheetSetup(env.N8N_API_KEY);
  }
  result.live_handoff = await assertLiveHandoffUntouched(env.N8N_API_KEY);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
