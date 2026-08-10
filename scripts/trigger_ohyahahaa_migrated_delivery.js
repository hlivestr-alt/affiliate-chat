"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const DELIVERY_ID = "AffWaDelivery2026";
const MARKER = "approved_historical_migration:23:one_new_whatsapp_batch";
const ALLOWED_SETTINGS = ["saveExecutionProgress","saveManualExecutions","saveDataErrorExecution","saveDataSuccessExecution","executionTimeout","errorWorkflow","timezone","executionOrder","callerPolicy","callerIds","timeSavedPerExecution","redactionPolicy","availableInMCP","customTelemetryTags"];

function readEnv() {
  const result = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) result[match[1].trim()] = match[2];
  }
  return result;
}
async function api(route, key, options = {}) {
  const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 800)}`);
  return body ? JSON.parse(body) : {};
}
function payload(workflow, settings = workflow.settings) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(ALLOWED_SETTINGS.filter((name) => Object.hasOwn(settings || {}, name)).map((name) => [name, settings[name]])) };
}

async function main() {
  const env = readEnv();
  if (!env.N8N_API_KEY || !env.AFFILIATE_TRACKER_SPREADSHEET_ID) throw new Error("Required production configuration missing");
  const delivery = await api(`/workflows/${DELIVERY_ID}`, env.N8N_API_KEY);
  if (!delivery.active) throw new Error("Production delivery workflow is inactive");
  const credential = delivery.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential) throw new Error("Production Google Sheets credential missing");
  const guardCode = delivery.nodes.find((node) => node.name === "Select and Prepare Batch Reservation")?.parameters?.jsCode || "";
  if (!guardCode.includes("historicalMigrationApproved") || !guardCode.includes("historicalOwnership.length && !existingBatch && !historicalMigrationApproved")) throw new Error("Scoped migration guard is not deployed");

  const route = `trigger-approved-migration-${crypto.randomUUID()}`;
  const ranges = ["WhatsApp Leads!A:AE", "Affiliate Assignments!A:M", "Delivery Log!A:R", "WhatsApp Message Log!A:X"];
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  const preflightCode = `const MARKER=${JSON.stringify(MARKER)};function text(v){return v==null?"":String(v).trim()}function digits(v){return text(v).replace(/\\D/g,"")}function table(r){const v=r?.values||[],h=(v[0]||[]).map(text);return{headers:h,rows:v.slice(1).map((row,i)=>({row_number:i+2,...Object.fromEntries(h.map((n,c)=>[n,text(row[c])]))}))}}const ranges=$json.valueRanges||[];if(ranges.length!==4)throw new Error("preflight_ranges_missing");const leads=table(ranges[0]),historical=table(ranges[1]),delivery=table(ranges[2]),messages=table(ranges[3]);const lead=leads.rows.find(r=>r.row_number===51);if(!lead||text(lead.username).replace(/^@+/,"").toLowerCase()!=="ohyahahaa"||digits(lead.wa_id||lead.whatsapp_number)!=="6281315350476"||lead.conversation_id!=="7563590806193226002")throw new Error("canonical_lead_row_51_mismatch");if(lead.batch_number)throw new Error("canonical_lead_already_reserved");if(lead.last_error!==MARKER)throw new Error("migration_allowance_missing_or_changed");const old=historical.rows.filter(r=>text(r.username).replace(/^@+/,"").toLowerCase()==="ohyahahaa"&&r.original_batch_number==="23");if(old.length!==1||text(old[0].state).toLowerCase()!=="link_sent")throw new Error("historical_batch_23_not_exact_link_sent_record");if(delivery.rows.some(r=>r.whatsapp_number==="62895337736362")||messages.rows.some(r=>r.recipient_number==="62895337736362"))throw new Error("old_number_has_unexpected_delivery_records");const test=text($env.WHATSAPP_TEST_MODE).toLowerCase()==="true",phase=text($env.WHATSAPP_PHASE1_ENABLED).toLowerCase()==="true",zero=text($env.ZERO_CHARGE_MODE).toLowerCase()==="true",armed=text($env.WHATSAPP_LIVE_TEST_ARMED).toLowerCase()==="true";if(test)throw new Error("test_mode_enabled");if(!phase)throw new Error("phase1_disabled");if(!zero)throw new Error("zero_charge_mode_disabled");if(armed)throw new Error("live_test_armed");if(!lead.window_expires_at||Date.now()>=Date.parse(lead.window_expires_at))throw new Error("customer_service_window_expired");return[{json:{...lead,username:"ohyahahaa",whatsapp_number:"6281315350476",wa_id:"6281315350476",conversation_id:"7563590806193226002",whatsapp_message_id:lead.last_inbound_message_id,message_text:"MINAT @ohyahahaa",predicted_intent:"distribution_intent",confidence:"1",action:"confirmation",migration_source_batch:"23",trigger_authorization:"user_approved_2026-08-05",preflight:{lead_row:51,marker:MARKER,historical_row:old[0].row_number,test_mode:test,phase1_enabled:phase,zero_charge_mode:zero,live_test_armed:armed}}}];`;
  const nodes = [
    { parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} }, id: crypto.randomUUID(), name: "Approved Delivery Request", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-500,0], webhookId: crypto.randomUUID() },
    { parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${env.AFFILIATE_TRACKER_SPREADSHEET_ID}/values:batchGet?${query}`, options: {} }, id: crypto.randomUUID(), name: "Fresh Production Preflight", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-280,0], credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 },
    { parameters: { jsCode: preflightCode }, id: crypto.randomUUID(), name: "Validate Exact Approved Migration", type: "n8n-nodes-base.code", typeVersion: 2, position: [-60,0] },
    { parameters: { source: "database", workflowId: { __rl: true, value: DELIVERY_ID, mode: "list", cachedResultName: DELIVERY_ID }, mode: "once", options: { waitForSubWorkflow: true } }, id: crypto.randomUUID(), name: "Start Normal Production Delivery", type: "n8n-nodes-base.executeWorkflow", typeVersion: 1.3, position: [160,0] },
    { parameters: { jsCode: 'const s=$("Validate Exact Approved Migration").first().json;return[{json:{launched:true,conversation_id:s.conversation_id,username:s.username,whatsapp_number:s.whatsapp_number,preflight:s.preflight}}];' }, id: crypto.randomUUID(), name: "Launch Result", type: "n8n-nodes-base.code", typeVersion: 2, position: [380,0] }
  ];
  const connections = {
    "Approved Delivery Request": { main: [[{ node: "Fresh Production Preflight", type: "main", index: 0 }]] },
    "Fresh Production Preflight": { main: [[{ node: "Validate Exact Approved Migration", type: "main", index: 0 }]] },
    "Validate Exact Approved Migration": { main: [[{ node: "Start Normal Production Delivery", type: "main", index: 0 }]] },
    "Start Normal Production Delivery": { main: [[{ node: "Launch Result", type: "main", index: 0 }]] }
  };
  const controller = await api("/workflows", env.N8N_API_KEY, { method: "POST", body: JSON.stringify({ name: "Temporary Approved Migration Delivery - ohyahahaa", nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  const originalSettings = { ...(delivery.settings || {}) };
  let responseStatus = 0, responseBody = "";
  try {
    const temporarySettings = { ...originalSettings, callerPolicy: "workflowsFromAList", callerIds: [originalSettings.callerIds, controller.id].filter(Boolean).join(",") };
    await api(`/workflows/${DELIVERY_ID}`, env.N8N_API_KEY, { method: "PUT", body: JSON.stringify(payload(delivery, temporarySettings)) });
    await api(`/workflows/${DELIVERY_ID}/activate`, env.N8N_API_KEY, { method: "POST" });
    await api(`/workflows/${controller.id}/activate`, env.N8N_API_KEY, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    responseStatus = response.status;
    responseBody = await response.text();
    if (!response.ok) throw new Error(`approved delivery launch ${response.status}: ${responseBody.slice(0, 1000)}`);
  } finally {
    try { await api(`/workflows/${controller.id}/deactivate`, env.N8N_API_KEY, { method: "POST" }); } catch {}
    try { await api(`/workflows/${controller.id}`, env.N8N_API_KEY, { method: "DELETE" }); } catch {}
    const current = await api(`/workflows/${DELIVERY_ID}`, env.N8N_API_KEY);
    await api(`/workflows/${DELIVERY_ID}`, env.N8N_API_KEY, { method: "PUT", body: JSON.stringify(payload(current, originalSettings)) });
    await api(`/workflows/${DELIVERY_ID}/activate`, env.N8N_API_KEY, { method: "POST" });
  }
  process.stdout.write(JSON.stringify({ controller_workflow_id: controller.id, http_status: responseStatus, launch: JSON.parse(responseBody) }, null, 2) + "\n");
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
