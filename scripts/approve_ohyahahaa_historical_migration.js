"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const DELIVERY_ID = "AffWaDelivery2026";
const NODE_NAME = "Select and Prepare Batch Reservation";
const MARKER = "approved_historical_migration:23:one_new_whatsapp_batch";
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
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 800)}`);
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

function patchReservationCode(code) {
  if (code.includes("approved_historical_migration:")) return code;
  const oldBlock = `if (historicalOwnership.length) {
  return [{ json: { ...source, ...current, reservation_ok: false, queue_reason: "historical_affiliate_already_assigned" } }];
}`;
  const newBlock = `const existingBatch = /^\\d+$/.test(current.batch_number)
  ? current.batch_number
  : "";
const migrationMatch = text(current.last_error).match(
  /^approved_historical_migration:(\\d+):one_new_whatsapp_batch$/
);
const historicalMigrationApproved = Boolean(
  !existingBatch &&
  migrationMatch &&
  historicalOwnership.length === 1 &&
  historicalOwnership[0].original_batch_number === migrationMatch[1] &&
  text(historicalOwnership[0].state).toLowerCase() === "link_sent"
);
if (historicalOwnership.length && !existingBatch && !historicalMigrationApproved) {
  return [{ json: { ...source, ...current, reservation_ok: false, queue_reason: "historical_affiliate_already_assigned" } }];
}`;
  if ((code.split(oldBlock).length - 1) !== 1) throw new Error("Historical ownership guard did not match exactly once");
  let patched = code.replace(oldBlock, newBlock);
  const lateExisting = `const existingBatch = /^\\d+$/.test(current.batch_number)
  ? current.batch_number
  : "";
const batch =`;
  if ((patched.split(lateExisting).length - 1) !== 1) throw new Error("Late existing-batch declaration did not match exactly once");
  patched = patched.replace(lateExisting, "const batch =");
  return patched;
}

async function main() {
  const values = env();
  const key = values.N8N_API_KEY;
  const spreadsheetId = values.AFFILIATE_TRACKER_SPREADSHEET_ID;
  if (!key || !spreadsheetId) throw new Error("Required production configuration is missing");

  const delivery = await api(`/workflows/${DELIVERY_ID}`, key);
  const wasActive = Boolean(delivery.active);
  const node = delivery.nodes.find((candidate) => candidate.name === NODE_NAME);
  if (!node) throw new Error(`${NODE_NAME} missing`);
  const beforeVersionId = delivery.versionId;
  node.parameters.jsCode = patchReservationCode(node.parameters.jsCode);
  await api(`/workflows/${DELIVERY_ID}`, key, {
    method: "PUT",
    body: JSON.stringify(payload(delivery))
  });
  if (wasActive) await api(`/workflows/${DELIVERY_ID}/activate`, key, { method: "POST" });
  const patchedDelivery = await api(`/workflows/${DELIVERY_ID}`, key);
  const patchedNode = patchedDelivery.nodes.find((candidate) => candidate.name === NODE_NAME);
  if (!patchedNode?.parameters?.jsCode?.includes("historicalMigrationApproved")) {
    throw new Error("Live delivery workflow patch verification failed");
  }
  if (Boolean(patchedDelivery.active) !== wasActive) throw new Error("Delivery workflow active state changed unexpectedly");

  const sheetsCredential = patchedDelivery.nodes
    .map((candidate) => candidate.credentials?.googleSheetsOAuth2Api)
    .find(Boolean);
  if (!sheetsCredential) throw new Error("Google Sheets credential missing from delivery workflow");

  const route = `approve-historical-migration-${crypto.randomUUID()}`;
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const triggerName = "Approved Migration Trigger";
  const readLeadsName = "Read Canonical Lead";
  const readQueueName = "Read Human Queue";
  const prepareName = "Validate and Prepare Migration";
  const updateName = "Apply Approved Migration";
  const rereadLeadsName = "Verify Canonical Lead";
  const rereadQueueName = "Verify Human Queue";
  const resultName = "Migration Result";
  const prepareCode = `const MARKER = ${JSON.stringify(MARKER)};
function text(value) { return value == null ? "" : String(value).trim(); }
function index(headers, name) { const value = headers.indexOf(name); if (value < 0) throw new Error("missing_column:" + name); return value; }
function normalizedPhone(value) { return text(value).replace(/\\D/g, ""); }
function padded(row, length) { const copy = Array.isArray(row) ? [...row] : []; while (copy.length < length) copy.push(""); return copy; }
const leads = $("${readLeadsName}").first().json.values || [];
const queue = $("${readQueueName}").first().json.values || [];
const lh = leads[0] || [], qh = queue[0] || [];
const lead = padded(leads[50], lh.length);
const q5 = padded(queue[4], qh.length);
const q18 = padded(queue[17], qh.length);
if (text(lead[index(lh,"username")]).replace(/^@+/,"").toLowerCase() !== "ohyahahaa") throw new Error("canonical_row_51_username_mismatch");
if (normalizedPhone(lead[index(lh,"wa_id")] || lead[index(lh,"whatsapp_number")]) !== "6281315350476") throw new Error("canonical_row_51_phone_mismatch");
if (text(lead[index(lh,"conversation_id")]) !== "7563590806193226002") throw new Error("canonical_row_51_conversation_mismatch");
if (/^\\d+$/.test(text(lead[index(lh,"batch_number")]))) throw new Error("canonical_row_51_already_has_batch");
if (normalizedPhone(q18[index(qh,"whatsapp_number")]) !== "6281315350476") throw new Error("queue_row_18_phone_mismatch");
if (text(q18[index(qh,"reason")]) !== "historical_affiliate_already_assigned") throw new Error("queue_row_18_reason_mismatch");
if (normalizedPhone(q5[index(qh,"whatsapp_number")]) !== "62895337736362") throw new Error("queue_row_5_old_phone_mismatch");
const now = new Date().toISOString();
lead[index(lh,"state")] = "distribution_pending";
lead[index(lh,"files_expected")] = "15";
lead[index(lh,"last_error")] = MARKER;
lead[index(lh,"updated_at")] = now;
for (const [row, resolution] of [[q18,"approved_historical_migration: batch 23 was TikTok Drive-link-only; one new 15-clip WhatsApp batch authorized for canonical lead row 51"],[q5,"obsolete_old_number: canonical lead is row 51 at 6281315350476; do not contact 62895337736362"]]) {
  row[index(qh,"status")] = "resolved";
  row[index(qh,"updated_at")] = now;
  if (qh.includes("resolution")) row[index(qh,"resolution")] = resolution;
  if (qh.includes("resolved_at")) row[index(qh,"resolved_at")] = now;
}
return [{json:{marker:MARKER,updated_at:now,data:[
  {range:"WhatsApp Leads!A51:AE51",majorDimension:"ROWS",values:[lead]},
  {range:"Human Queue!A5:R5",majorDimension:"ROWS",values:[q5]},
  {range:"Human Queue!A18:R18",majorDimension:"ROWS",values:[q18]}
]}}];`;
  const resultCode = `function text(value){return value==null?"":String(value).trim()} function digits(value){return text(value).replace(/\\D/g,"")}
const marker=${JSON.stringify(MARKER)}, leads=$("${rereadLeadsName}").first().json.values||[], queue=$("${rereadQueueName}").first().json.values||[], lh=leads[0]||[], qh=queue[0]||[];
const li=(n)=>lh.indexOf(n), qi=(n)=>qh.indexOf(n), lead=leads[50]||[], q5=queue[4]||[], q18=queue[17]||[];
const result={lead_row:51,username:text(lead[li("username")]),phone:digits(lead[li("wa_id")]||lead[li("whatsapp_number")]),conversation_id:text(lead[li("conversation_id")]),state:text(lead[li("state")]),batch_number:text(lead[li("batch_number")]),files_expected:text(lead[li("files_expected")]),migration_marker:text(lead[li("last_error")]),queue_row_18_status:text(q18[qi("status")]),queue_row_5_status:text(q5[qi("status")])};
if(result.username!=="ohyahahaa"||result.phone!=="6281315350476"||result.state!=="distribution_pending"||result.batch_number||result.files_expected!=="15"||result.migration_marker!==marker||result.queue_row_18_status!=="resolved"||result.queue_row_5_status!=="resolved") throw new Error("post_write_verification_failed:"+JSON.stringify(result));
return [{json:result}];`;
  const requestNode = (name, url, position) => ({
    id: crypto.randomUUID(), name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position,
    parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url, options: {} },
    credentials: { googleSheetsOAuth2Api: sheetsCredential }
  });
  const nodes = [
    { id: crypto.randomUUID(), name: triggerName, type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-700,0], parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} }, webhookId: crypto.randomUUID() },
    requestNode(readLeadsName, `${base}/values/WhatsApp%20Leads!A%3AAE`, [-500,0]),
    requestNode(readQueueName, `${base}/values/Human%20Queue!A%3AR`, [-300,0]),
    { id: crypto.randomUUID(), name: prepareName, type: "n8n-nodes-base.code", typeVersion: 2, position: [-100,0], parameters: { jsCode: prepareCode } },
    { id: crypto.randomUUID(), name: updateName, type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [100,0], parameters: { method: "POST", authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `${base}/values:batchUpdate`, sendBody: true, specifyBody: "json", jsonBody: '={{ JSON.stringify({valueInputOption:"RAW",data:$json.data}) }}', options: {} }, credentials: { googleSheetsOAuth2Api: sheetsCredential } },
    requestNode(rereadLeadsName, `${base}/values/WhatsApp%20Leads!A%3AAE`, [300,0]),
    requestNode(rereadQueueName, `${base}/values/Human%20Queue!A%3AR`, [500,0]),
    { id: crypto.randomUUID(), name: resultName, type: "n8n-nodes-base.code", typeVersion: 2, position: [700,0], parameters: { jsCode: resultCode } }
  ];
  const connections = {};
  for (let i = 0; i < nodes.length - 1; i += 1) connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: "main", index: 0 }]] };
  const temporary = await api("/workflows", key, { method: "POST", body: JSON.stringify({ name: "Temporary Approved Historical Migration - ohyahahaa", nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  let responseStatus = 0;
  let responseBody = "";
  try {
    await api(`/workflows/${temporary.id}/activate`, key, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    responseStatus = response.status;
    responseBody = await response.text();
    if (!response.ok) throw new Error(`migration webhook ${response.status}: ${responseBody.slice(0, 800)}`);
  } finally {
    try { await api(`/workflows/${temporary.id}/deactivate`, key, { method: "POST" }); } catch {}
    try { await api(`/workflows/${temporary.id}`, key, { method: "DELETE" }); } catch {}
  }
  process.stdout.write(JSON.stringify({
    delivery_workflow: { id: DELIVERY_ID, active: patchedDelivery.active, before_version_id: beforeVersionId, after_version_id: patchedDelivery.versionId, active_version_id: patchedDelivery.activeVersionId },
    migration_execution_workflow_id: temporary.id,
    http_status: responseStatus,
    result: JSON.parse(responseBody)
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
