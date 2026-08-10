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

function readEnv() {
  const values = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) values[match[1].trim()] = match[2];
  }
  return values;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

function replaceOnce(source, before, after, label) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) throw new Error(`${label}: expected one match, found ${occurrences}`);
  return source.replace(before, after);
}

function node(workflow, name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  if (!result) throw new Error(`Missing node: ${name}`);
  return result;
}

async function main() {
  const key = readEnv().N8N_API_KEY;
  if (!key) throw new Error("N8N_API_KEY missing");
  const live = await api(`/workflows/${WORKFLOW_ID}`, key);
  const wasActive = Boolean(live.active);
  const before = {
    versionId: live.versionId,
    activeVersionId: live.activeVersionId,
    nodeCount: live.nodes.length,
    workflowHash: hash(payload(live))
  };

  const select = node(live, "Select and Prepare Batch Reservation");
  let code = select.parameters.jsCode;
  code = replaceOnce(code,
    'const testRecipient = text($env.WHATSAPP_TEST_RECIPIENT_NUMBER).replace(/\\D/g, "");',
    'const testRecipient = text($env.WHATSAPP_TEST_RECIPIENT_NUMBER).replace(/\\D/g, "");\nconst testBatch = text($env.WHATSAPP_TEST_BATCH_NUMBER || "TEST");\nconst configuredTestCount = Number($env.WHATSAPP_TEST_CLIP_COUNT || 1);\nconst testClipCount = configuredTestCount === 15 ? 15 : 1;',
    "select test configuration");
  code = replaceOnce(code,
    'const batch = testMode ? "TEST" : (existingBatch || String(folders.find((value) => !used.has(value)) || ""));',
    'const batch = testMode ? testBatch : (existingBatch || String(folders.find((value) => !used.has(value)) || ""));',
    "select test batch");
  code = replaceOnce(code,
    '  batch_reserved_at: current.batch_reserved_at || now,\n  delivery_started_at: current.delivery_started_at || now,\n  files_expected: testMode ? "1" : "15",',
    '  batch_reserved_at: current.batch_number === batch ? (current.batch_reserved_at || now) : now,\n  delivery_started_at: current.batch_number === batch ? (current.delivery_started_at || now) : now,\n  files_expected: testMode ? String(testClipCount) : "15",\n  files_sent: current.batch_number === batch ? current.files_sent : "0",\n  files_delivered: current.batch_number === batch ? current.files_delivered : "0",\n  files_failed: current.batch_number === batch ? current.files_failed : "0",\n  files_sent_at: current.batch_number === batch ? current.files_sent_at : "",\n  files_delivered_at: current.batch_number === batch ? current.files_delivered_at : "",',
    "reset counters for fresh test batch");
  select.parameters.jsCode = code;

  const restore = node(live, "Restore and Validate Delivery Context");
  code = restore.parameters.jsCode;
  code = replaceOnce(code,
    'const testMode = text($env.WHATSAPP_TEST_MODE).toLowerCase() === "true";\nconst batch = text(source.batch_number);',
    'const testMode = text($env.WHATSAPP_TEST_MODE).toLowerCase() === "true";\nconst testBatch = text($env.WHATSAPP_TEST_BATCH_NUMBER || "TEST");\nconst configuredTestCount = Number($env.WHATSAPP_TEST_CLIP_COUNT || 1);\nconst testClipCount = configuredTestCount === 15 ? 15 : 1;\nconst batch = text(source.batch_number);',
    "restore test configuration");
  code = replaceOnce(code,
    'if (testMode ? batch !== "TEST" : !/^\\d+$/.test(batch)) {',
    'if (testMode ? batch !== testBatch : !/^\\d+$/.test(batch)) {',
    "validate configured test batch");
  code = replaceOnce(code,
    'if (testMode && text(lead.files_expected) !== "1") throw new Error("delivery_context_test_clip_count_mismatch");\n\nconst expectedClipCount = testMode ? 1 : 15;',
    'if (testMode && text(lead.files_expected) !== String(testClipCount)) throw new Error("delivery_context_test_clip_count_mismatch");\n\nconst expectedClipCount = testMode ? testClipCount : 15;',
    "validate configured test count");
  restore.parameters.jsCode = code;

  const validate = node(live, "Validate Assigned Folder");
  validate.parameters.command = "={{ $('Restore and Validate Delivery Context').first().json.test_mode && Number($('Restore and Validate Delivery Context').first().json.expected_clip_count) === 1 ? 'set -eu; file=\"' + $('Restore and Validate Delivery Context').first().json.resolved_folder_path + '\"; test -f \"$file\"; printf \"OK\\t%s\\t1\" \"$file\"' : 'set -eu; folder=\"' + $('Restore and Validate Delivery Context').first().json.resolved_folder_path + '\"; test -d \"$folder\"; count=$(find \"$folder\" -maxdepth 1 -type f -iname \"*.mp4\" | wc -l); test \"$count\" -eq ' + $('Restore and Validate Delivery Context').first().json.expected_clip_count + '; printf \"OK\\t%s\\t%s\" \"$folder\" \"$count\"' }}";

  const readFiles = node(live, "Read Assigned MP4 Files");
  readFiles.parameters.fileSelector = "={{ $('Restore and Validate Delivery Context').first().json.test_mode && Number($('Restore and Validate Delivery Context').first().json.expected_clip_count) === 1 ? $('Restore and Validate Delivery Context').first().json.resolved_folder_path : $('Restore and Validate Delivery Context').first().json.resolved_folder_path + '/*.mp4' }}";

  for (const name of ["Guard Cached Media Upload", "Guard Cached Clip Send"]) {
    const guard = node(live, name);
    guard.parameters.jsCode = replaceOnce(
      guard.parameters.jsCode,
      'const testRecipient = digits($env.WHATSAPP_TEST_RECIPIENT_NUMBER);\nconst testAllowed = !testMode || (liveTestArmed && testRecipient === recipient && source.json.batch_number === "TEST");',
      'const testRecipient = digits($env.WHATSAPP_TEST_RECIPIENT_NUMBER);\nconst testBatch = text($env.WHATSAPP_TEST_BATCH_NUMBER || "TEST");\nconst testAllowed = !testMode || (liveTestArmed && testRecipient === recipient && source.json.batch_number === testBatch);',
      `${name} configured test batch`
    );
  }

  await api(`/workflows/${WORKFLOW_ID}`, key, {
    method: "PUT",
    body: JSON.stringify(payload(live))
  });
  if (wasActive) await api(`/workflows/${WORKFLOW_ID}/activate`, key, { method: "POST" });
  const after = await api(`/workflows/${WORKFLOW_ID}`, key);
  if (after.nodes.length !== before.nodeCount || Boolean(after.active) !== wasActive) {
    throw new Error("Post-deploy workflow structure or activation mismatch");
  }
  const afterPayload = payload(after);
  process.stdout.write(JSON.stringify({
    workflowId: WORKFLOW_ID,
    name: after.name,
    active: after.active,
    before,
    after: {
      versionId: after.versionId,
      activeVersionId: after.activeVersionId,
      nodeCount: after.nodes.length,
      workflowHash: hash(afterPayload)
    },
    changedNodes: [
      "Select and Prepare Batch Reservation",
      "Restore and Validate Delivery Context",
      "Validate Assigned Folder",
      "Read Assigned MP4 Files",
      "Guard Cached Media Upload",
      "Guard Cached Clip Send"
    ]
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
