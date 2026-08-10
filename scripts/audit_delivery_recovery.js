"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const FOLDERS = ["6901", "6902", "6903", "6904", "6905", "6906", "6907"];
const NUMBERS = ["6289508881998", "6289656262493", "6285782000199", "6285710416787", "6282329499945", "6281802341011", "6285864300358"];

function readEnv() {
  const result = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) result[match[1].trim()] = match[2];
  }
  return result;
}

async function api(pathname, key, options = {}) {
  const response = await fetch(API + pathname, {
    ...options,
    headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${pathname}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

function redactWamid(value) {
  const text = String(value || "");
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
}

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error("usage: node scripts/audit_delivery_recovery.js OUTPUT.json");
  const env = readEnv();
  if (!env.N8N_API_KEY || !env.AFFILIATE_TRACKER_SPREADSHEET_ID) throw new Error("Required n8n or spreadsheet configuration is missing");
  const reference = await api("/workflows/AffWaDelivery2026", env.N8N_API_KEY);
  const credential = reference.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential?.id) throw new Error("Live Google Sheets credential reference is missing");

  const webhookPath = `delivery-recovery-audit-${crypto.randomUUID()}`;
  const ranges = [
    "WhatsApp Leads!A:AE",
    "Delivery Log!A:R",
    "WhatsApp Message Log!A:X",
    "WhatsApp Clip Log!A:AE",
    "WhatsApp Chat Log!A:AL",
  ];
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  const auditCode = `
function text(value){return value==null?"":String(value).trim();}
function records(entry){const values=Array.isArray(entry?.values)?entry.values:[];const headers=(values[0]||[]).map(text);return values.slice(1).map((row,index)=>({row_number:index+2,...Object.fromEntries(headers.map((name,column)=>[name,text(row[column])]))}));}
const folders=new Set(${JSON.stringify(FOLDERS)});const numbers=new Set(${JSON.stringify(NUMBERS)});
const ranges=$json.valueRanges||[];const leads=records(ranges[0]);const delivery=records(ranges[1]);const messages=records(ranges[2]);const clips=records(ranges[3]);const chats=records(ranges[4]);
const digits=(value)=>text(value).replace(/\\D/g,"");
const affectedLead=leads.filter((row)=>folders.has(text(row.batch_number))||numbers.has(digits(row.wa_id||row.whatsapp_number)));
const conversations=new Set(affectedLead.map((row)=>text(row.conversation_id)).filter(Boolean));
const affectedDelivery=delivery.filter((row)=>folders.has(text(row.batch_number))||conversations.has(text(row.conversation_id))||numbers.has(digits(row.wa_id||row.whatsapp_number)));
const affectedMessages=messages.filter((row)=>numbers.has(digits(row.wa_id||row.whatsapp_number||row.recipient_number))||conversations.has(text(row.conversation_id))||folders.has(text(row.batch_number)));
const affectedClips=clips.filter((row)=>folders.has(text(row["Folder Number"]))||numbers.has(digits(row.wa_id||row["WhatsApp Number"])));
const affectedChats=chats.filter((row)=>folders.has(text(row["Folder Number"]))||numbers.has(digits(row.wa_id||row["WhatsApp Number"])));
return [{json:{audited_at:new Date().toISOString(),folders:[...folders],leads:affectedLead,delivery_log:affectedDelivery,message_log:affectedMessages,clip_log:affectedClips,chat_log:affectedChats}}];`;

  const workflow = await api("/workflows", env.N8N_API_KEY, {
    method: "POST",
    body: JSON.stringify({
      name: "Temporary Read-only Delivery Recovery Audit",
      nodes: [
        { parameters: { httpMethod: "GET", path: webhookPath, responseMode: "lastNode", options: {} }, id: crypto.randomUUID(), name: "Read-only Audit", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-300, 0], webhookId: crypto.randomUUID() },
        { parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${env.AFFILIATE_TRACKER_SPREADSHEET_ID}/values:batchGet?${query}`, options: {} }, id: crypto.randomUUID(), name: "Read Sheets", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-80, 0], credentials: { googleSheetsOAuth2Api: credential } },
        { parameters: { jsCode: auditCode }, id: crypto.randomUUID(), name: "Filter Affected Rows", type: "n8n-nodes-base.code", typeVersion: 2, position: [140, 0] },
      ],
      connections: { "Read-only Audit": { main: [[{ node: "Read Sheets", type: "main", index: 0 }]] }, "Read Sheets": { main: [[{ node: "Filter Affected Rows", type: "main", index: 0 }]] } },
      settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "none" },
    }),
  });
  try {
    await api(`/workflows/${workflow.id}/activate`, env.N8N_API_KEY, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${webhookPath}`);
    const body = await response.text();
    if (!response.ok) throw new Error(`Audit webhook ${response.status}: ${body.slice(0, 500)}`);
    const data = JSON.parse(body);
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(data, null, 2) + "\n");
    const summary = {
      audited_at: data.audited_at,
      lead_rows: data.leads.length,
      delivery_rows: data.delivery_log.length,
      message_rows: data.message_log.length,
      clip_rows: data.clip_log.length,
      chat_rows: data.chat_log.length,
      outbound_wamids: data.message_log.filter((row) => row.direction === "outbound" && row.whatsapp_message_id).map((row) => redactWamid(row.whatsapp_message_id)),
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, env.N8N_API_KEY, { method: "POST" }); } catch {}
    await api(`/workflows/${workflow.id}`, env.N8N_API_KEY, { method: "DELETE" });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
