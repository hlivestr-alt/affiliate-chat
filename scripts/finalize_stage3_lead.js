"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const NAME = "Temporary Recovery - Finalize Stage 3 Lead";
const PHONE = "6285178246723";
const BATCH = "TEST15-20260805";
const SPREADSHEET = "1eyA1XRNZU0usuii801IrJCJHp8oCh2XjlfROrzzvpwE";

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
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

async function main() {
  const key = env().N8N_API_KEY;
  if (!key) throw new Error("N8N_API_KEY missing");
  const delivery = await api("/workflows/AffWaDelivery2026", key);
  const credential = delivery.nodes
    .map((node) => node.credentials?.googleSheetsOAuth2Api)
    .find(Boolean);
  if (!credential) throw new Error("Live Google Sheets credential missing");

  const route = `codex-finalize-stage3-${crypto.randomBytes(8).toString("hex")}`;
  const trigger = {
    id: crypto.randomUUID(), name: "Finalize Stage 3 Trigger",
    type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-400, 0],
    parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} },
    webhookId: crypto.randomUUID()
  };
  const query = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" });
  query.append("ranges", "'WhatsApp Leads'!A:AE");
  query.append("ranges", "'Delivery Log'!A:R");
  const read = {
    id: crypto.randomUUID(), name: "Read Stage 3 Finalization Data Once",
    type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-160, 0],
    parameters: {
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSheetsOAuth2Api",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values:batchGet?${query}`,
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: credential },
    retryOnFail: true, maxTries: 8, waitBetweenTries: 10000
  };
  const code = `
const phone=${JSON.stringify(PHONE)},batch=${JSON.stringify(BATCH)};
const ranges=$json.valueRanges||[],leads=ranges[0]?.values||[],delivery=ranges[1]?.values||[];
const text=(value)=>value==null?"":String(value).trim(),digits=(value)=>text(value).replace(/\\D/g,"");
const leadHeaders=(leads[0]||[]).map(text),deliveryHeaders=(delivery[0]||[]).map(text);
const leadRows=leads.slice(1).map((row,index)=>({row_number:index+2,...Object.fromEntries(leadHeaders.map((name,column)=>[name,text(row[column])]))}));
const deliveryRows=delivery.slice(1).map((row,index)=>({row_number:index+2,...Object.fromEntries(deliveryHeaders.map((name,column)=>[name,text(row[column])]))}));
const leadMatches=leadRows.filter((row)=>digits(row.wa_id||row.whatsapp_number)===phone);
if(leadMatches.length!==1)throw new Error("stage3_lead_match_count_"+leadMatches.length);
const lead=leadMatches[0];if(lead.batch_number!==batch)throw new Error("stage3_lead_batch_mismatch");
const clips=deliveryRows.filter((row)=>row.conversation_id===lead.conversation_id&&row.batch_number===batch);
const wamids=new Set(clips.map((row)=>row.whatsapp_message_id).filter(Boolean));
const files=new Set(clips.map((row)=>row.file_name).filter(Boolean));
if(clips.length!==15||wamids.size!==15||files.size!==15)throw new Error("stage3_delivery_evidence_incomplete");
if(clips.some((row)=>!["accepted","sent","delivered","read"].includes(row.state||row.send_state)))throw new Error("stage3_delivery_not_accepted");
const now=new Date().toISOString(),sentAt=clips.map((row)=>row.sent_at).filter(Boolean).sort().at(-1)||now;
const record={...lead,state:"files_sent",files_expected:"15",files_sent:"15",files_failed:"0",files_sent_at:sentAt,last_error:"",updated_at:now};
return [{json:{row_number:lead.row_number,row_values:leadHeaders.map((name)=>text(record[name])),batch_number:batch,clip_count:clips.length,unique_wamids:wamids.size,unique_files:files.size,files_sent_at:sentAt,updated_at:now}}];`;
  const prepare = {
    id: crypto.randomUUID(), name: "Validate and Prepare Stage 3 Final State",
    type: "n8n-nodes-base.code", typeVersion: 2, position: [80, 0], parameters: { jsCode: code }
  };
  const write = {
    id: crypto.randomUUID(), name: "Write Stage 3 Lead Final State",
    type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [320, 0],
    parameters: {
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSheetsOAuth2Api",
      method: "PUT",
      url: `=https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/WhatsApp%20Leads!A{{$json.row_number}}%3AAE{{$json.row_number}}?valueInputOption=RAW`,
      sendBody: true,
      specifyBody: "json",
      jsonBody: '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.row_values] }) }}',
      options: {}
    },
    credentials: { googleSheetsOAuth2Api: credential },
    retryOnFail: true, maxTries: 8, waitBetweenTries: 10000
  };
  const result = {
    id: crypto.randomUUID(), name: "Return Stage 3 Finalization Evidence",
    type: "n8n-nodes-base.code", typeVersion: 2, position: [560, 0],
    parameters: { jsCode: 'const evidence=$("Validate and Prepare Stage 3 Final State").first().json;return [{json:{...evidence,google_response:$json,finalized_at_utc:new Date().toISOString()}}];' }
  };
  const desired = {
    name: NAME,
    nodes: [trigger, read, prepare, write, result],
    connections: {
      [trigger.name]: { main: [[{ node: read.name, type: "main", index: 0 }]] },
      [read.name]: { main: [[{ node: prepare.name, type: "main", index: 0 }]] },
      [prepare.name]: { main: [[{ node: write.name, type: "main", index: 0 }]] },
      [write.name]: { main: [[{ node: result.name, type: "main", index: 0 }]] }
    },
    settings: { executionOrder: "v1", saveDataErrorExecution: "all", saveDataSuccessExecution: "all" }
  };

  const list = await api("/workflows?limit=250", key);
  const previous = (list.data || []).find((workflow) => workflow.name === NAME);
  if (previous?.active) await api(`/workflows/${previous.id}/deactivate`, key, { method: "POST" });
  const saved = previous
    ? await api(`/workflows/${previous.id}`, key, { method: "PUT", body: JSON.stringify(desired) })
    : await api("/workflows", key, { method: "POST", body: JSON.stringify(desired) });
  await api(`/workflows/${saved.id}/activate`, key, { method: "POST" });
  let status = 0;
  let responseBody = "";
  try {
    const response = await fetch(`http://localhost:5678/webhook/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    status = response.status;
    responseBody = await response.text();
  } finally {
    await api(`/workflows/${saved.id}/deactivate`, key, { method: "POST" });
  }
  process.stdout.write(JSON.stringify({
    workflow_id: saved.id,
    http_status: status,
    response: responseBody ? JSON.parse(responseBody) : {}
  }, null, 2) + "\n");
  if (status < 200 || status >= 300) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
