"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";

function readEnv() {
  const values = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) values[match[1].trim()] = match[2];
  }
  return values;
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
  if (!response.ok) throw new Error(`n8n API ${response.status} ${pathname}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

async function main() {
  const env = readEnv();
  for (const name of ["N8N_API_KEY", "AFFILIATE_TRACKER_SPREADSHEET_ID"]) {
    if (!env[name]) throw new Error(`${name} is missing`);
  }
  const referenceWorkflow = await api("/workflows/AffWaReply2026", env.N8N_API_KEY);
  const referenceCredential = referenceWorkflow.nodes
    .map((node) => node.credentials?.googleSheetsOAuth2Api)
    .find(Boolean);
  if (!referenceCredential?.id) throw new Error("Live Google Sheets credential reference is missing");
  const webhookPath = `phase1-readiness-${crypto.randomUUID()}`;
  const ranges = ["WhatsApp Leads!A:AG", "Affiliate Assignments!A:M", "Delivery Log!A:Q", "WhatsApp Message Log!A:T"];
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  const auditCode = String.raw`
function text(value) { return value == null ? "" : String(value).trim(); }
function records(range) {
  const values = Array.isArray(range?.values) ? range.values : [];
  const headers = (values[0] || []).map(text);
  return values.slice(1).map((row) => Object.fromEntries(headers.map((name, i) => [name, text(row[i])])));
}
const ranges = $json.valueRanges || [];
const leads = records(ranges[0]);
const historical = records(ranges[1]);
const delivery = records(ranges[2]);
const messages = records(ranges[3]);
const numeric = (value) => /^\d+$/.test(text(value));
const productionLeadBatches = leads.filter((row) => numeric(row.batch_number)).map((row) => row.batch_number);
const historicalBatches = historical.filter((row) => numeric(row.original_batch_number)).map((row) => row.original_batch_number);
const usedProductionBatches = [...new Set([...productionLeadBatches, ...historicalBatches])].sort((a, b) => Number(a) - Number(b));
const testAssignments = leads.filter((row) => text(row.batch_number).toUpperCase() === "TEST");
const testDeliveryRows = delivery.filter((row) => text(row.batch_number).toUpperCase() === "TEST");
const partialProduction = leads.filter((row) => numeric(row.batch_number) && !["files_sent", "files_delivered"].includes(text(row.state)));
return [{ json: {
  audit_mode: "read_only",
  lead_rows: leads.length,
  historical_rows: historical.length,
  delivery_rows: delivery.length,
  message_rows: messages.length,
  inbound_message_rows: messages.filter((row) => text(row.direction) === "inbound").length,
  outbound_message_rows: messages.filter((row) => text(row.direction) === "outbound").length,
  accepted_or_uncertain_outbound_rows: messages.filter((row) =>
    text(row.direction) === "outbound" &&
    ["accepted", "sent", "outcome_uncertain"].includes(text(row.send_state || row.api_status))
  ).length,
  used_production_batches: usedProductionBatches,
  production_lead_batch_count: productionLeadBatches.length,
  test_assignment_count: testAssignments.length,
  test_assignment_states: testAssignments.map((row) => text(row.state)),
  test_delivery_row_count: testDeliveryRows.length,
  test_assignment_has_numeric_batch: testAssignments.some((row) => numeric(row.batch_number)),
  partially_reserved_production_batches: partialProduction.map((row) => ({ batch_number: row.batch_number, state: row.state }))
} }];`;
  const workflow = await api("/workflows", env.N8N_API_KEY, {
    method: "POST",
    body: JSON.stringify({
      name: "Temporary Phase 1 Read-only Readiness Audit",
      nodes: [
        {
          parameters: { httpMethod: "GET", path: webhookPath, responseMode: "lastNode", options: {} },
          id: crypto.randomUUID(), name: "Local Readiness Audit", type: "n8n-nodes-base.webhook",
          typeVersion: 2.1, position: [-300, 0], webhookId: crypto.randomUUID()
        },
        {
          parameters: {
            authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api",
            url: `https://sheets.googleapis.com/v4/spreadsheets/${env.AFFILIATE_TRACKER_SPREADSHEET_ID}/values:batchGet?${query}`,
            options: {}
          },
          id: crypto.randomUUID(), name: "Read Distribution Sheets", type: "n8n-nodes-base.httpRequest",
          typeVersion: 4.4, position: [-80, 0],
          credentials: { googleSheetsOAuth2Api: referenceCredential }
        },
        {
          parameters: { jsCode: auditCode }, id: crypto.randomUUID(), name: "Return Redacted Readiness",
          type: "n8n-nodes-base.code", typeVersion: 2, position: [140, 0]
        }
      ],
      connections: {
        "Local Readiness Audit": { main: [[{ node: "Read Distribution Sheets", type: "main", index: 0 }]] },
        "Read Distribution Sheets": { main: [[{ node: "Return Redacted Readiness", type: "main", index: 0 }]] }
      },
      settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "none" }
    })
  });
  try {
    await api(`/workflows/${workflow.id}/activate`, env.N8N_API_KEY, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${webhookPath}`);
    const body = await response.text();
    if (!response.ok) throw new Error(`Readiness webhook ${response.status}: ${body.slice(0, 300)}`);
    process.stdout.write(JSON.stringify(JSON.parse(body), null, 2) + "\n");
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, env.N8N_API_KEY, { method: "POST" }); } catch {}
    await api(`/workflows/${workflow.id}`, env.N8N_API_KEY, { method: "DELETE" });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
