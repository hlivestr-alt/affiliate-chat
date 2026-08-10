"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API_BASE_URL = "http://localhost:5678/api/v1";
const WEBHOOK_BASE_URL = "http://localhost:5678/webhook";
const PROCESSOR_WORKFLOW_ID = "AfDriveReady2026";
const ROUTER_WORKFLOW_ID = "AfDriveRouter2026";
const SETUP_WORKFLOW_NAME = "WhatsApp Leads - Setup Sheet";
const SETUP_WEBHOOK_PATH = "setup-whatsapp-leads-2026-f3c90e";
const ALLOWED_SETTINGS = [
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
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function parseArgs(argv) {
  return {
    setupOnly: argv.includes("--setup-only"),
    processorOnly: argv.includes("--processor-only")
  };
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
    throw new Error(
      `n8n API ${response.status} ${pathname}: ${responseText.slice(0, 1000)}`
    );
  }
  return responseText ? JSON.parse(responseText) : null;
}

function workflowPayload(workflow) {
  const settings = Object.fromEntries(
    ALLOWED_SETTINGS
      .filter((name) =>
        Object.prototype.hasOwnProperty.call(workflow.settings || {}, name)
      )
      .map((name) => [name, workflow.settings[name]])
  );
  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings
  };
  if (workflow.staticData != null) payload.staticData = workflow.staticData;
  return payload;
}

function workflowIdValue(value) {
  return value && typeof value === "object" ? value.value : value;
}

function assertProcessorSafety(workflow) {
  if (workflow.id !== PROCESSOR_WORKFLOW_ID) {
    throw new Error("Generated processor does not preserve the live workflow ID");
  }
  if ((workflow.nodes || []).length >= 30) {
    throw new Error("Generated processor is unexpectedly large");
  }
  if (workflow.settings?.saveDataSuccessExecution !== "none") {
    throw new Error("Processor must not retain successful execution data");
  }
  if (workflow.settings?.callerIds !== ROUTER_WORKFLOW_ID) {
    throw new Error("Processor caller policy no longer points at the live router");
  }

  for (const item of workflow.nodes || []) {
    const serialized = JSON.stringify(item);
    if (/googleDrive|Search Clips|Drive Folder|Send .*TikTok/i.test(serialized)) {
      throw new Error(`Forbidden legacy node or credential remains: ${item.name}`);
    }
    const method = String(item.parameters?.method || "GET").toUpperCase();
    const url = String(item.parameters?.url || "");
    if (
      method === "POST" &&
      /tiktokglobalshop|affiliate_seller\/.*\/messages/i.test(url)
    ) {
      throw new Error(`TikTok send request remains: ${item.name}`);
    }
  }
}

function assertRouterSafety(workflow) {
  if (workflow.id !== ROUTER_WORKFLOW_ID) {
    throw new Error("Generated router does not preserve the live workflow ID");
  }
  if (workflow.settings?.saveDataSuccessExecution !== "none") {
    throw new Error("Router must not retain successful lead execution data");
  }
  if ((workflow.nodes || []).length >= 30) {
    throw new Error("Generated router is unexpectedly large");
  }
  const webhook = (workflow.nodes || []).find(
    (item) => item.name === "Affiliate Message Webhook"
  );
  if (!webhook || webhook.parameters?.path !== "tiktok-message") {
    throw new Error("Production TikTok webhook is missing");
  }
  const executeNode = (workflow.nodes || []).find(
    (item) => item.name === "Process Real Unread Message"
  );
  if (
    !executeNode ||
    workflowIdValue(executeNode.parameters?.workflowId) !== PROCESSOR_WORKFLOW_ID ||
    executeNode.parameters?.options?.waitForSubWorkflow !== false
  ) {
    throw new Error("Router-to-processor handoff is misconfigured");
  }

  for (const item of workflow.nodes || []) {
    const serialized = JSON.stringify(item);
    if (/googleDrive|Search Clips|Drive Folder|Send .*TikTok/i.test(serialized)) {
      throw new Error(`Forbidden legacy node or credential remains: ${item.name}`);
    }
    const method = String(item.parameters?.method || "GET").toUpperCase();
    const url = String(item.parameters?.url || "");
    if (
      method === "POST" &&
      /tiktokglobalshop|affiliate_seller\/.*\/messages/i.test(url)
    ) {
      throw new Error(`TikTok send request remains: ${item.name}`);
    }
  }
}

async function listWorkflows(apiKey) {
  const workflows = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await n8nRequest(`/workflows?${query}`, apiKey);
    workflows.push(...(response.data || []));
    cursor = response.nextCursor || "";
  } while (cursor);
  return workflows;
}

async function ensureSetupWorkflow(generated, apiKey) {
  const existing = (await listWorkflows(apiKey)).find(
    (workflow) => workflow.name === SETUP_WORKFLOW_NAME
  );
  if (existing) {
    await n8nRequest(`/workflows/${existing.id}`, apiKey, {
      method: "PUT",
      body: JSON.stringify(workflowPayload(generated))
    });
    return existing.id;
  }
  const created = await n8nRequest("/workflows", apiKey, {
    method: "POST",
    body: JSON.stringify(workflowPayload(generated))
  });
  return created.id;
}

async function setupSheet(generated, apiKey) {
  const workflowId = await ensureSetupWorkflow(generated, apiKey);
  let activated = false;
  try {
    const current = await n8nRequest(`/workflows/${workflowId}`, apiKey);
    if (!current.active) {
      await n8nRequest(`/workflows/${workflowId}/activate`, apiKey, {
        method: "POST"
      });
      activated = true;
    }

    const response = await fetch(
      `${WEBHOOK_BASE_URL}/${SETUP_WEBHOOK_PATH}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      }
    );
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Sheet setup webhook ${response.status}: ${responseText.slice(0, 1000)}`
      );
    }
    const result = responseText ? JSON.parse(responseText) : {};
    if (!result.ready) {
      throw new Error(`WhatsApp Leads sheet verification failed: ${responseText}`);
    }
    return { workflowId, ...result };
  } finally {
    if (activated) {
      await n8nRequest(`/workflows/${workflowId}/deactivate`, apiKey, {
        method: "POST"
      });
    }
  }
}

async function deployProcessor(generated, apiKey) {
  assertProcessorSafety(generated);
  const liveBefore = await n8nRequest(
    `/workflows/${PROCESSOR_WORKFLOW_ID}`,
    apiKey
  );
  if (!liveBefore.active) {
    throw new Error("Live processor is unexpectedly inactive");
  }

  await n8nRequest(`/workflows/${PROCESSOR_WORKFLOW_ID}`, apiKey, {
    method: "PUT",
    body: JSON.stringify(workflowPayload(generated))
  });
  let verified = await n8nRequest(
    `/workflows/${PROCESSOR_WORKFLOW_ID}`,
    apiKey
  );
  if (!verified.active) {
    await n8nRequest(
      `/workflows/${PROCESSOR_WORKFLOW_ID}/activate`,
      apiKey,
      { method: "POST" }
    );
    verified = await n8nRequest(
      `/workflows/${PROCESSOR_WORKFLOW_ID}`,
      apiKey
    );
  }
  assertProcessorSafety(verified);
  if (!verified.active) throw new Error("Processor is not active after deployment");
  if (
    verified.name !== generated.name ||
    verified.nodes.length !== generated.nodes.length
  ) {
    throw new Error("Live processor does not match the generated workflow");
  }

  return {
    workflowId: verified.id,
    name: verified.name,
    active: verified.active,
    nodeCount: verified.nodes.length,
    versionId: verified.versionId,
    activeVersionId: verified.activeVersionId,
    previousVersionId: liveBefore.versionId
  };
}

async function deployRouter(generated, apiKey) {
  assertRouterSafety(generated);
  const live = await n8nRequest(`/workflows/${ROUTER_WORKFLOW_ID}`, apiKey);
  if (!live.active) throw new Error("Live router is unexpectedly inactive");
  const liveWebhook = (live.nodes || []).find(
    (item) => item.name === "Affiliate Message Webhook"
  );
  const deployment = structuredClone(generated);
  const generatedWebhook = (deployment.nodes || []).find(
    (item) => item.name === "Affiliate Message Webhook"
  );
  if (!liveWebhook || !generatedWebhook) {
    throw new Error("Cannot preserve the live webhook identity");
  }
  generatedWebhook.id = liveWebhook.id;
  generatedWebhook.webhookId = liveWebhook.webhookId;

  await n8nRequest(`/workflows/${ROUTER_WORKFLOW_ID}`, apiKey, {
    method: "PUT",
    body: JSON.stringify(workflowPayload(deployment))
  });
  const verified = await n8nRequest(
    `/workflows/${ROUTER_WORKFLOW_ID}`,
    apiKey
  );
  const verifiedWebhook = (verified.nodes || []).find(
    (item) => item.name === "Affiliate Message Webhook"
  );
  assertRouterSafety(verified);
  if (
    !verified.active ||
    verifiedWebhook?.id !== liveWebhook.id ||
    verifiedWebhook?.webhookId !== liveWebhook.webhookId
  ) {
    throw new Error("Router deployment changed the production webhook identity");
  }
  return {
    workflowId: verified.id,
    active: verified.active,
    nodeCount: verified.nodes.length,
    webhookIdPreserved: true,
    versionId: verified.versionId,
    activeVersionId: verified.activeVersionId,
    previousVersionId: live.versionId
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.setupOnly && args.processorOnly) {
    throw new Error("--setup-only and --processor-only cannot be combined");
  }
  const env = readEnv(path.join(ROOT, ".env"));
  if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY is missing from .env");

  const processor = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-lead-capture.json"),
      "utf8"
    )
  );
  const router = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "n8n", "imports", "affiliate-message-router.json"),
      "utf8"
    )
  );
  const setup = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-leads-setup.json"),
      "utf8"
    )
  );
  const result = {};
  if (!args.processorOnly) {
    result.sheet = await setupSheet(setup, env.N8N_API_KEY);
  }
  if (!args.setupOnly) {
    result.router = await deployRouter(router, env.N8N_API_KEY);
    result.processor = await deployProcessor(processor, env.N8N_API_KEY);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
