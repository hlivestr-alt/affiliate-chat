"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const SHEET = "1eyA1XRNZU0usuii801IrJCJHp8oCh2XjlfROrzzvpwE";
const PHONE = "6281120262823";
const CONVERSATION = "wa:6281120262823";
const BATCH = "6916";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
const id = () => crypto.randomUUID();
const edge = (node) => ({ main: [[{ node, type: "main", index: 0 }]] });
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 700)}`); return body ? JSON.parse(body) : {}; }

(async () => {
  const deliveryWorkflow = await api("/workflows/AffWaDelivery2026");
  const credential = deliveryWorkflow.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential) throw new Error("production Google credential missing");
  const route = `finalize-live-lead-${id()}`;
  const trigger = { id: id(), name: "Finalize Verified Live Lead", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-880, 0], webhookId: id(), parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} } };
  const read = { id: id(), name: "Read Lead and Durable Send Evidence", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-660, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values:batchGet?${["WhatsApp Leads!A:AE", "Delivery Log!A:R", "WhatsApp Message Log!A:X"].map((range) => `ranges=${encodeURIComponent(range)}`).join("&")}`, options: { timeout: 45000 } } };
  const prepareCode = `const PHONE=${JSON.stringify(PHONE)},CONVERSATION=${JSON.stringify(CONVERSATION)},BATCH=${JSON.stringify(BATCH)},text=v=>v==null?"":String(v).trim(),digits=v=>text(v).replace(/\\D/g,"");function table(values){const h=(values?.[0]||[]).map(text);return{headers:h,rows:(values||[]).slice(1).map((r,i)=>({row_number:i+2,raw:r,...Object.fromEntries(h.map((n,c)=>[n,text(r[c])]))})).filter(r=>r.raw.some(v=>text(v)))}}const ranges=$json.valueRanges||[];if(ranges.length!==3)throw new Error("finalization_ranges_missing");const leads=table(ranges[0]?.values),delivery=table(ranges[1]?.values),messages=table(ranges[2]?.values),matches=leads.rows.filter(r=>r.conversation_id===CONVERSATION&&digits(r.wa_id||r.whatsapp_number)===PHONE&&r.batch_number===BATCH);if(matches.length!==1)throw new Error("finalization_lead_not_unique:"+matches.length);const lead=matches[0],detail=delivery.rows.filter(r=>r.conversation_id===CONVERSATION&&r.batch_number===BATCH&&digits(r.whatsapp_number)===PHONE),accepted=detail.filter(r=>r.whatsapp_message_id&&["accepted","sent","delivered","read"].includes(r.delivery_state||r.state||r.send_state));if(detail.length!==15||new Set(detail.map(r=>r.delivery_key)).size!==15||new Set(accepted.map(r=>r.whatsapp_message_id)).size!==15||detail.some(r=>r.last_error))throw new Error("finalization_15_message_id_precondition_failed");const messageRows=messages.rows.filter(r=>r.conversation_id===CONVERSATION||digits(r.recipient_number||r.whatsapp_number)===PHONE);if(new Set(messageRows.map(r=>r.whatsapp_message_id||r.message_id).filter(Boolean)).size!==15)throw new Error("finalization_message_log_precondition_failed");const record={...lead,state:"files_sent",files_expected:"15",files_sent:"15",files_failed:"0",files_sent_at:accepted.map(r=>r.sent_at).filter(Boolean).sort().at(-1)||new Date().toISOString(),last_error:"",updated_at:new Date().toISOString()};const values=leads.headers.map(h=>text(record[h]));return[{json:{row_number:lead.row_number,before:{state:lead.state,files_sent:lead.files_sent,files_failed:lead.files_failed},verified_message_ids:15,row_values:[values]}}];`;
  const prepare = { id: id(), name: "Verify 15 IDs and Build Final Lead State", type: "n8n-nodes-base.code", typeVersion: 2, position: [-440, 0], parameters: { jsCode: prepareCode } };
  const write = { id: id(), name: "Write Final Verified Lead State", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-220, 0], credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", method: "PUT", url: `=https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/WhatsApp%20Leads!A{{$('Verify 15 IDs and Build Final Lead State').first().json.row_number}}%3AAE{{$('Verify 15 IDs and Build Final Lead State').first().json.row_number}}?valueInputOption=RAW`, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({majorDimension:'ROWS',values:$('Verify 15 IDs and Build Final Lead State').first().json.row_values}) }}", options: { timeout: 45000 } } };
  const reread = { id: id(), name: "Reread Finalized Lead", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [0, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `=https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/WhatsApp%20Leads!A{{$('Verify 15 IDs and Build Final Lead State').first().json.row_number}}%3AAE{{$('Verify 15 IDs and Build Final Lead State').first().json.row_number}}`, options: { timeout: 45000 } } };
  const verifyCode = `const p=$("Verify 15 IDs and Build Final Lead State").first().json,values=$json.values||[],headers=["username","whatsapp_number","conversation_id","captured_at","reply_1","reply_2","reply_3","state","opt_in_message_id","opt_in_sent_at","opted_in_at","declined_at","batch_number","batch_reserved_at","delivery_started_at","files_expected","files_sent","files_delivered","files_failed","files_sent_at","files_delivered_at","posted_confirmed_at","last_whatsapp_message_id","last_inbound_at","last_intent","last_intent_confidence","last_error","updated_at","wa_id","last_inbound_message_id","window_expires_at"],row=values[0]||[],record=Object.fromEntries(headers.map((h,i)=>[h,String(row[i]??"")]));if(record.conversation_id!==${JSON.stringify(CONVERSATION)}||record.batch_number!==${JSON.stringify(BATCH)}||record.state!=="files_sent"||record.files_expected!=="15"||record.files_sent!=="15"||record.files_failed!=="0"||record.last_error)throw new Error("finalized_lead_postwrite_verification_failed");return[{json:{row_number:p.row_number,before:p.before,after:{state:record.state,files_expected:record.files_expected,files_sent:record.files_sent,files_failed:record.files_failed,files_sent_at:record.files_sent_at,last_error:record.last_error,updated_at:record.updated_at},verified_message_ids:p.verified_message_ids,google_updated_range:$("Write Final Verified Lead State").first().json.updatedRange||""}}];`;
  const verify = { id: id(), name: "Confirm Final Lead State", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 0], parameters: { jsCode: verifyCode } };
  const nodes = [trigger, read, prepare, write, reread, verify];
  const connections = {}; for (let i = 0; i < nodes.length - 1; i++) connections[nodes[i].name] = edge(nodes[i + 1].name);
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({ name: "Temporary Verified Live Assignment State Finalization", nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  try {
    await api(`/workflows/${workflow.id}/activate`, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST" });
    const body = await response.text();
    if (!response.ok) throw new Error(`finalization-only repair ${response.status}: ${body.slice(0, 800)}`);
    const output = { workflow_id: workflow.id, result: JSON.parse(body) };
    const outPath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "live-production-lead-finalization.json");
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" }); } catch {}
    try { await api(`/workflows/${workflow.id}`, { method: "DELETE" }); } catch {}
  }
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
