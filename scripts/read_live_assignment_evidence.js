"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const OLD_SHEET = "1eyA1XRNZU0usuii801IrJCJHp8oCh2XjlfROrzzvpwE";
const NEW_SHEET = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
const PHONE = "6281120262823";
const USERNAME = "testes";
const BATCH = "6916";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
const id = () => crypto.randomUUID();
const edge = (node) => ({ main: [[{ node, type: "main", index: 0 }]] });
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 600)}`); return body ? JSON.parse(body) : {}; }

(async () => {
  const delivery = await api("/workflows/AffWaDelivery2026");
  const credential = delivery.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential) throw new Error("production Google credential missing");
  const route = `read-live-assignment-${id()}`;
  const trigger = { id: id(), name: "Read Live Assignment Evidence", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-660, 0], webhookId: id(), parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} } };
  const oldRead = { id: id(), name: "Read Production Delivery Tables", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-440, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${OLD_SHEET}/values:batchGet?${["WhatsApp Leads!A:AE", "Affiliate Assignments!A:M", "Delivery Log!A:R", "WhatsApp Message Log!A:X"].map((range) => `ranges=${encodeURIComponent(range)}`).join("&")}`, options: { timeout: 45000 } } };
  const newRead = { id: id(), name: "Read Simple Delivery Log", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-220, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${NEW_SHEET}/values/%27Delivery%20Log%27!A%3AG`, options: { timeout: 45000 } } };
  const code = `const PHONE=${JSON.stringify(PHONE)},USERNAME=${JSON.stringify(USERNAME)},BATCH=${JSON.stringify(BATCH)},text=v=>v==null?"":String(v).trim(),digits=v=>text(v).replace(/\\D/g,"");function table(values){const h=(values?.[0]||[]).map(text);return(values||[]).slice(1).map((r,i)=>({row_number:i+2,...Object.fromEntries(h.map((n,c)=>[n,text(r[c])]))})).filter(r=>Object.values(r).some(text))}const old=$("Read Production Delivery Tables").first().json.valueRanges||[],leads=table(old[0]?.values),assignments=table(old[1]?.values),delivery=table(old[2]?.values),messages=table(old[3]?.values),simple=table($json.values);const lead=leads.filter(r=>digits(r.wa_id||r.whatsapp_number)===PHONE&&r.batch_number===BATCH);const conversation=lead[0]?.conversation_id||"";const cleanMessage=r=>({row_number:r.row_number,source_reference:r.source_reference||r.delivery_key||"",conversation_id:r.conversation_id||"",recipient_number:r.recipient_number||r.whatsapp_number||"",batch_number:r.batch_number||"",file_index:r.file_index||"",file_name:r.file_name||"",media_id:r.media_id||"",whatsapp_message_id:r.whatsapp_message_id||r.message_id||"",state:r.state||r.send_state||r.delivery_state||"",attempts:r.attempts||"",last_error:r.last_error||"",sent_at:r.sent_at||"",updated_at:r.updated_at||""});return[{json:{lead_rows:lead,lead_batch_owners:leads.filter(r=>r.batch_number===BATCH).map(r=>({row_number:r.row_number,conversation_id:r.conversation_id,username:r.username,whatsapp_number:r.whatsapp_number,state:r.state})),historical_batch_owners:assignments.filter(r=>r.original_batch_number===BATCH).map(r=>({row_number:r.row_number,conversation_id:r.conversation_id,username:r.username,state:r.state})),assignment_rows:assignments.filter(r=>r.original_batch_number===BATCH||r.username===USERNAME),delivery_rows:delivery.filter(r=>r.batch_number===BATCH&&digits(r.whatsapp_number)===PHONE).map(cleanMessage),message_rows:messages.filter(r=>(conversation&&r.conversation_id===conversation)||digits(r.recipient_number||r.whatsapp_number)===PHONE).map(cleanMessage),simple_log_rows:simple.filter(r=>r["Numbered Folder"]===BATCH&&r.Username===USERNAME)}}];`;
  const result = { id: id(), name: "Return Sanitized Assignment Evidence", type: "n8n-nodes-base.code", typeVersion: 2, position: [0, 0], parameters: { jsCode: code } };
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({ name: "Temporary Read-Only Live Assignment Evidence", nodes: [trigger, oldRead, newRead, result], connections: { [trigger.name]: edge(oldRead.name), [oldRead.name]: edge(newRead.name), [newRead.name]: edge(result.name) }, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  try {
    await api(`/workflows/${workflow.id}/activate`, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST" });
    const body = await response.text();
    if (!response.ok) throw new Error(`read-only evidence workflow ${response.status}: ${body.slice(0, 600)}`);
    const output = JSON.parse(body);
    const outPath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "live-production-assignment-sheet-evidence.json");
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ outPath, lead_rows: output.lead_rows.length, assignment_rows: output.assignment_rows.length, delivery_rows: output.delivery_rows.length, message_rows: output.message_rows.length, simple_log_rows: output.simple_log_rows }, null, 2) + "\n");
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" }); } catch {}
    try { await api(`/workflows/${workflow.id}`, { method: "DELETE" }); } catch {}
  }
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
