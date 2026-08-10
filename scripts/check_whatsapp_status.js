"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API_BASE = "http://localhost:5678/api/v1";
const WEBHOOK_BASE = "http://localhost:5678/webhook";

function readEnv() {
  const values = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) values[match[1].trim()] = match[2];
  }
  return values;
}

async function api(pathname, key, options = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": key,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status}: ${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : null;
}

async function main() {
  const wamid = process.argv[2];
  if (!wamid) throw new Error("Usage: node check_whatsapp_status.js <wamid>");
  const env = readEnv();
  const webhookPath = `whatsapp-status-audit-${crypto.randomUUID()}`;
  const sheet = encodeURIComponent("WhatsApp Message Log");
  const lookupCode = `const values = Array.isArray($json.values) ? $json.values : [];
const headers = values[0] || [];
const row = values.slice(1).find((item) => String(item[0] || "") === ${JSON.stringify(wamid)});
if (!row) return [{ json: { found: false } }];
const record = Object.fromEntries(headers.map((name, index) => [name, row[index] ?? ""]));
return [{ json: {
  found: true,
  whatsapp_message_id: record.whatsapp_message_id,
  api_status: record.api_status,
  current_status: record.current_status,
  status_timestamp: record.status_timestamp,
  conversation_json: record.conversation_json,
  pricing_json: record.pricing_json,
  errors_json: record.errors_json,
  error_code: record.error_code,
  error_title: record.error_title,
  error_message: record.error_message,
  error_details: record.error_details,
  processed_statuses: record.processed_statuses,
  status_history_json: record.status_history_json,
  updated_at: record.updated_at
} }];`;
  const workflow = await api("/workflows", env.N8N_API_KEY, {
    method: "POST",
    body: JSON.stringify({
      name: "Temporary WhatsApp Status Audit",
      nodes: [
        {
          parameters: { httpMethod: "GET", path: webhookPath, responseMode: "lastNode", options: {} },
          id: crypto.randomUUID(), name: "Temporary Status Lookup",
          type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-300, 0],
          webhookId: crypto.randomUUID()
        },
        {
          parameters: {
            authentication: "predefinedCredentialType",
            nodeCredentialType: "googleSheetsOAuth2Api",
            url: `https://sheets.googleapis.com/v4/spreadsheets/${env.AFFILIATE_TRACKER_SPREADSHEET_ID}/values/${sheet}!A%3AT`,
            options: {}
          },
          id: crypto.randomUUID(), name: "Read Message Log",
          type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-80, 0],
          credentials: {
            googleSheetsOAuth2Api: {
              id: env.GOOGLE_SHEETS_CREDENTIAL_ID,
              name: env.GOOGLE_SHEETS_CREDENTIAL_NAME || "Google Sheets account"
            }
          }
        },
        {
          parameters: { jsCode: lookupCode },
          id: crypto.randomUUID(), name: "Return Matching Status",
          type: "n8n-nodes-base.code", typeVersion: 2, position: [140, 0]
        }
      ],
      connections: {
        "Temporary Status Lookup": { main: [[{ node: "Read Message Log", type: "main", index: 0 }]] },
        "Read Message Log": { main: [[{ node: "Return Matching Status", type: "main", index: 0 }]] }
      },
      settings: {
        executionOrder: "v1",
        saveDataSuccessExecution: "none",
        saveDataErrorExecution: "none"
      }
    })
  });

  try {
    await api(`/workflows/${workflow.id}/activate`, env.N8N_API_KEY, { method: "POST" });
    const deadline = Date.now() + 55000;
    let result = { found: false };
    do {
      const response = await fetch(`${WEBHOOK_BASE}/${webhookPath}`);
      if (!response.ok) throw new Error(`Status lookup ${response.status}`);
      result = await response.json();
      if (["delivered", "read", "failed"].includes(result.current_status)) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } while (Date.now() < deadline);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, env.N8N_API_KEY, { method: "POST" }); } catch {}
    await api(`/workflows/${workflow.id}`, env.N8N_API_KEY, { method: "DELETE" });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
