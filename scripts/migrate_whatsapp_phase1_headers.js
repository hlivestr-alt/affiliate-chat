"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WEBHOOK = "http://localhost:5678/webhook";

const REQUIRED = Object.freeze({
  "WhatsApp Leads": [
    "username", "whatsapp_number", "conversation_id", "captured_at",
    "reply_1", "reply_2", "reply_3", "state", "opt_in_message_id",
    "opt_in_sent_at", "opted_in_at", "declined_at", "batch_number",
    "batch_reserved_at", "delivery_started_at", "files_expected",
    "files_sent", "files_delivered", "files_failed", "files_sent_at",
    "files_delivered_at", "posted_confirmed_at", "last_whatsapp_message_id",
    "last_inbound_at", "last_intent", "last_intent_confidence",
    "last_error", "updated_at", "wa_id", "last_inbound_message_id",
    "window_expires_at"
  ],
  "Delivery Log": [
    "delivery_key", "conversation_id", "whatsapp_number", "batch_number",
    "file_index", "file_name", "media_id", "whatsapp_message_id", "state",
    "attempts", "uploaded_at", "sent_at", "delivered_at", "failed_at",
    "last_error", "updated_at", "send_state", "delivery_state"
  ],
  "WhatsApp Message Log": [
    "whatsapp_message_id", "recipient_number", "message_type",
    "template_name", "source_workflow", "source_reference", "api_status",
    "accepted_at", "current_status", "status_timestamp",
    "conversation_json", "pricing_json", "errors_json", "error_code",
    "error_title", "error_message", "error_details", "processed_statuses",
    "status_history_json", "updated_at", "direction",
    "message_payload_json", "send_state", "delivery_state"
  ]
});

function envFile() {
  const result = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const index = value.indexOf("=");
    if (index > 0) result[value.slice(0, index)] = value.slice(index + 1);
  }
  return result;
}

async function api(pathname, key, options = {}) {
  const response = await fetch(API + pathname, {
    ...options,
    headers: {
      "X-N8N-API-KEY": key,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

function httpNode(name, position, parameters, credential) {
  return {
    id: crypto.randomUUID(), name, position,
    type: "n8n-nodes-base.httpRequest", typeVersion: 4.4,
    parameters: {
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSheetsOAuth2Api",
      ...parameters
    },
    credentials: { googleSheetsOAuth2Api: credential }
  };
}

function codeNode(name, position, jsCode) {
  return {
    id: crypto.randomUUID(), name, position,
    type: "n8n-nodes-base.code", typeVersion: 2,
    parameters: { jsCode }
  };
}

function webhookNode(route) {
  return {
    id: crypto.randomUUID(), name: "Controlled Migration Trigger",
    position: [-600, 0], type: "n8n-nodes-base.webhook", typeVersion: 2.1,
    webhookId: crypto.randomUUID(),
    parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} }
  };
}

async function runTemporary(key, workflow, route) {
  const created = await api("/workflows", key, {
    method: "POST", body: JSON.stringify(workflow)
  });
  try {
    await api(`/workflows/${created.id}/activate`, key, { method: "POST" });
    const response = await fetch(`${WEBHOOK}/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    const body = await response.text();
    if (!response.ok) {
      let diagnostic = "";
      try {
        const executions = await api(
          `/executions?workflowId=${encodeURIComponent(created.id)}&status=error&limit=1&includeData=true`,
          key
        );
        const error = executions?.data?.[0]?.data?.resultData?.error;
        diagnostic = error
          ? ` node=${error.node?.name || "unknown"} message=${error.message || "unknown"}`
          : "";
      } catch {}
      throw new Error(`temporary migration ${response.status}: ${body.slice(0, 300)}${diagnostic}`);
    }
    return body ? JSON.parse(body) : {};
  } finally {
    try { await api(`/workflows/${created.id}/deactivate`, key, { method: "POST" }); } catch {}
    await api(`/workflows/${created.id}`, key, { method: "DELETE" });
  }
}

function workflow(name, route, nodes, connections) {
  return {
    name, nodes, connections,
    settings: {
      executionOrder: "v1",
      saveDataErrorExecution: "all",
      saveDataSuccessExecution: "none"
    }
  };
}

function batchGetUrl(spreadsheetId) {
  const ranges = Object.keys(REQUIRED)
    .map((name) => `ranges=${encodeURIComponent(`${name}!A:AZ`)}`)
    .join("&");
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${ranges}`;
}

async function main() {
  const env = envFile();
  if (!env.N8N_API_KEY || !env.AFFILIATE_TRACKER_SPREADSHEET_ID) {
    throw new Error("Required n8n/spreadsheet configuration is missing");
  }
  const reply = await api("/workflows/AffWaReply2026", env.N8N_API_KEY);
  const credential = reply.nodes
    .map((node) => node.credentials?.googleSheetsOAuth2Api)
    .find(Boolean);
  if (!credential?.id) throw new Error("Existing Google Sheets credential reference not found");

  const backupRoute = `phase1-sheet-backup-${crypto.randomUUID()}`;
  const backupRead = httpNode("Read Affected Sheet Data", [-350, 0], {
    url: batchGetUrl(env.AFFILIATE_TRACKER_SPREADSHEET_ID), options: {}
  }, credential);
  const backupReturn = codeNode("Return Redacted Backup Payload", [-100, 0],
    "return [{ json: { captured_at: new Date().toISOString(), valueRanges: Array.isArray($json.valueRanges) ? $json.valueRanges : [] } }];"
  );
  const backup = await runTemporary(env.N8N_API_KEY, workflow(
    "TEMP - Phase1 Sheet Backup", backupRoute,
    [webhookNode(backupRoute), backupRead, backupReturn],
    {
      "Controlled Migration Trigger": { main: [[{ node: "Read Affected Sheet Data", type: "main", index: 0 }]] },
      "Read Affected Sheet Data": { main: [[{ node: "Return Redacted Backup Payload", type: "main", index: 0 }]] }
    }
  ), backupRoute);
  if (!Array.isArray(backup.valueRanges) || backup.valueRanges.length !== 3) {
    throw new Error("Sheet backup did not return all three affected tabs");
  }

  const backupPath = process.argv[2];
  if (!backupPath) throw new Error("Backup output path argument is required");
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`, { flag: "wx" });
  } else {
    const existingBackup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    if (!Array.isArray(existingBackup.valueRanges) || existingBackup.valueRanges.length !== 3) {
      throw new Error("Existing Sheet backup is incomplete; refusing migration");
    }
  }

  const migrateRoute = `phase1-sheet-migrate-${crypto.randomUUID()}`;
  const readBefore = httpNode("Read Headers Before Migration", [-350, 0], {
    url: batchGetUrl(env.AFFILIATE_TRACKER_SPREADSHEET_ID), options: {}
  }, credential);
  const prepare = codeNode("Validate and Prepare Header Migration", [-100, 0], String.raw`
const required = ${JSON.stringify(REQUIRED)};
const ranges = Array.isArray($json.valueRanges) ? $json.valueRanges : [];
function tab(range) { return String(range || "").replace(/^'?/, "").split("!")[0].replace(/'$/, ""); }
const byTab = new Map(ranges.map((entry) => [tab(entry.range), entry]));
const data = [];
function columnName(number) {
  let value = number;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
for (const [name, expected] of Object.entries(required)) {
  const current = (byTab.get(name)?.values?.[0] || []).map((value) => String(value));
  if (!current.length) throw new Error("Missing header row: " + name);
  if (new Set(current).size !== current.length) throw new Error("Duplicate header found: " + name);
  if (current.length > expected.length || current.some((value, index) => value !== expected[index])) {
    throw new Error("Header migration is not append-only for " + name);
  }
  const end = columnName(expected.length);
  data.push({ range: name + "!A1:" + end + "1", majorDimension: "ROWS", values: [expected] });
}
return [{ json: { valueInputOption: "RAW", data } }];`);
  const write = httpNode("Append Required Headers Once", [150, 0], {
    method: "POST",
    url: `https://sheets.googleapis.com/v4/spreadsheets/${env.AFFILIATE_TRACKER_SPREADSHEET_ID}/values:batchUpdate`,
    sendBody: true, specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json) }}", options: {}
  }, credential);
  const reread = httpNode("Read Headers After Migration", [400, 0], {
    url: batchGetUrl(env.AFFILIATE_TRACKER_SPREADSHEET_ID), options: {}
  }, credential);
  const verify = codeNode("Verify Header Migration", [650, 0], String.raw`
const required = ${JSON.stringify(REQUIRED)};
const ranges = Array.isArray($json.valueRanges) ? $json.valueRanges : [];
function tab(range) { return String(range || "").replace(/^'?/, "").split("!")[0].replace(/'$/, ""); }
const byTab = new Map(ranges.map((entry) => [tab(entry.range), entry]));
const result = {};
for (const [name, expected] of Object.entries(required)) {
  const current = (byTab.get(name)?.values?.[0] || []).map((value) => String(value));
  const ready = expected.every((value, index) => current[index] === value);
  result[name] = { ready, header_count: current.length };
  if (!ready) throw new Error("Header verification failed: " + name);
}
return [{ json: { ready: true, verified_at: new Date().toISOString(), sheets: result } }];`);
  const migration = await runTemporary(env.N8N_API_KEY, workflow(
    "TEMP - Phase1 Header Migration", migrateRoute,
    [webhookNode(migrateRoute), readBefore, prepare, write, reread, verify],
    {
      "Controlled Migration Trigger": { main: [[{ node: "Read Headers Before Migration", type: "main", index: 0 }]] },
      "Read Headers Before Migration": { main: [[{ node: "Validate and Prepare Header Migration", type: "main", index: 0 }]] },
      "Validate and Prepare Header Migration": { main: [[{ node: "Append Required Headers Once", type: "main", index: 0 }]] },
      "Append Required Headers Once": { main: [[{ node: "Read Headers After Migration", type: "main", index: 0 }]] },
      "Read Headers After Migration": { main: [[{ node: "Verify Header Migration", type: "main", index: 0 }]] }
    }
  ), migrateRoute);
  if (!migration.ready) throw new Error("Header verification did not report ready");
  process.stdout.write(`${JSON.stringify({ backup_path: backupPath, ...migration }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
