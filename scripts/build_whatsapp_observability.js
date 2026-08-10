#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BACKUP = process.argv[2] ? path.resolve(process.argv[2]) : "";
const CURRENT = path.join(BACKUP, "workflows", "current");
const OUTPUT = path.join(ROOT, "n8n", "imports");
const OBSERVER_ID = "AffWaObservability2026";

function readEnv() {
  const result = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.startsWith("#")) result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}
function uuid() { return crypto.randomUUID(); }
function node(name, type, position, parameters, typeVersion = 2) {
  return { id: uuid(), name, type, typeVersion, position, parameters };
}
function code(name, position, jsCode) { return node(name, "n8n-nodes-base.code", position, { jsCode }, 2); }
function ifNode(name, position, leftValue, rightValue) {
  return node(name, "n8n-nodes-base.if", position, { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: uuid(), leftValue, rightValue, operator: { type: "string", operation: "equals" } }], combinator: "and" }, options: {} }, 2.3);
}
function http(name, position, parameters, credential) {
  return { ...node(name, "n8n-nodes-base.httpRequest", position, { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", ...parameters }, 4.4), credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 };
}
function executeObserver(name, position) {
  return node(name, "n8n-nodes-base.executeWorkflow", position, { source: "database", workflowId: { __rl: true, value: OBSERVER_ID, mode: "list", cachedResultName: OBSERVER_ID }, mode: "each", options: { waitForSubWorkflow: false } }, 1.3);
}
function connect(workflow, from, target, output = 0) {
  const entry = workflow.connections[from] ||= { main: [] };
  while (entry.main.length <= output) entry.main.push([]);
  entry.main[output] ||= [];
  if (!entry.main[output].some((item) => item.node === target)) entry.main[output].push({ node: target, type: "main", index: 0 });
}
function add(workflow, item) {
  if (workflow.nodes.some((existing) => existing.name === item.name)) throw new Error(`Duplicate node ${workflow.id}:${item.name}`);
  workflow.nodes.push(item);
  return item;
}
function runtimeSource() {
  return fs.readFileSync(path.join(ROOT, "src", "whatsappObservability.js"), "utf8")
    .replace(/^"use strict";\s*/, "")
    .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, "");
}
function producer(kind, workflowName, extra = "") {
  return `const source=$json||{}; return [{json:{...source,observability_kind:${JSON.stringify(kind)},workflow_name:${JSON.stringify(workflowName)},execution_id:String($execution.id),${extra}}}];`;
}
function loadCurrent(id) {
  const generated = {
    AffWaWebhook2026: "affiliate-whatsapp-webhook-router.json",
    AffWaReply2026: "affiliate-whatsapp-reply-status.json",
    AffWaDelivery2026: "affiliate-whatsapp-file-delivery.json"
  };
  const generatedFile = path.join(OUTPUT, generated[id] || `${id}.json`);
  const file = id === "AffWaDelivery2026" && fs.existsSync(generatedFile)
    ? generatedFile
    : BACKUP ? path.join(CURRENT, `${id}.json`) : generatedFile;
  if (!fs.existsSync(file)) throw new Error(`Missing backed-up workflow: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function save(file, workflow) {
  fs.writeFileSync(path.join(OUTPUT, file), JSON.stringify(workflow, null, 2) + "\n");
}

function buildObserver(credential, spreadsheetId) {
  const runtime = runtimeSource();
  const normalizeCode = `${runtime}\nconst normalized=normalizeEvent($json,new Date().toISOString()); return [{json:{...$json,...normalized,has_chat:Boolean(normalized.chat),has_clip:Boolean(normalized.clip),raw_row_values:RAW_HEADERS.map((h)=>normalized.raw[h]??"")}}];`;
  const prepareUpsert = (type) => `${runtime}
const source=$("Normalize Observability Event").first().json; const values=Array.isArray($json.values)?$json.values:[]; const headers=(values[0]||[]).map(text);
const required=${type === "chat" ? "CHAT_HEADERS" : "CLIP_HEADERS"}; if(required.some((h)=>!headers.includes(h))) throw new Error("${type} log headers are missing");
const rows=values.slice(1).map((row,index)=>{const record={row_number:index+2};headers.forEach((h,i)=>{record[h]=row[i]==null?"":row[i]});return record;});
const incoming=source.${type}; const statusOnly=source.kind==="authenticated_webhook"&&Boolean(source.delivery_status);
const current=rows.find((row)=>${type === "chat" ? "(source.chat_dedup_key&&row[\"Deduplication Key\"]===source.chat_dedup_key)||(incoming[\"Inbound Message ID\"]&&row[\"Inbound Message ID\"]===incoming[\"Inbound Message ID\"])||(incoming[\"Outbound wamid\"]&&row[\"Outbound wamid\"]===incoming[\"Outbound wamid\"])" : "(source.clip_dedup_key&&row[\"Delivery Key\"]===source.clip_dedup_key)||(incoming[\"Outbound wamid\"]&&row[\"Outbound wamid\"]===incoming[\"Outbound wamid\"])"});
const action=current?"update":statusOnly?"none":"append"; const merged=current?mergeMonotonic(current,incoming,required,"${type}"):incoming;
return [{json:{...source,write_action:action,row_number:current?.row_number||"",row_values:headers.map((h)=>merged[h]==null?"":merged[h])}}];`;

  const trigger = node("When Called for Observability", "n8n-nodes-base.executeWorkflowTrigger", [-900, 0], { inputSource: "passthrough" }, 1.1);
  const normalize = code("Normalize Observability Event", [-680, 0], normalizeCode);
  const readRaw = http("Read Raw Events for Deduplication", [-420, -340], { url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/WhatsApp%20Raw%20Events!A:L`, options: {} }, credential);
  const prepareRaw = code("Prepare Raw Audit Append", [-160, -340], `const source=$("Normalize Observability Event").first().json; const values=Array.isArray($json.values)?$json.values:[]; const headers=(values[0]||[]).map((v)=>v==null?"":String(v).trim()); const record={...source.raw}; const key=String(record["Deduplication Key"]||""); const kind=String(record["Event Kind"]||""); const duplicate=values.slice(1).some((row)=>String(row[8]||"")===key&&String(row[1]||"")===kind); if(duplicate&&record["Processing Result"]!=="ignored_duplicate") record["Processing Result"]="ignored_duplicate"; return [{json:{...source,raw_row_values:headers.map((h)=>record[h]??"")}}];`);
  const appendRaw = http("Append Sanitized Raw Event", [80, -340], { method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/WhatsApp%20Raw%20Events!A:L:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({majorDimension:'ROWS',values:[$json.raw_row_values]}) }}", options: {} }, credential);
  const hasChat = ifNode("IF Chat Event", [-420, -80], "={{ $json.has_chat ? 'yes' : 'no' }}", "yes");
  const readChat = http("Read Chat Log", [-160, -100], { url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/WhatsApp%20Chat%20Log!A:AZ`, options: {} }, credential);
  const prepareChat = code("Prepare Chat Upsert", [80, -100], prepareUpsert("chat"));
  const chatUpdate = ifNode("IF Update Chat Row", [320, -100], "={{ $json.write_action }}", "update");
  const updateChat = http("Update Chat Row", [560, -160], { method: "PUT", url: `=https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/WhatsApp%20Chat%20Log!A{{$json.row_number}}:AL{{$json.row_number}}?valueInputOption=RAW`, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({majorDimension:'ROWS',values:[$json.row_values]}) }}", options: {} }, credential);
  const chatAppend = ifNode("IF Append Chat Row", [560, -40], "={{ $json.write_action }}", "append");
  const appendChat = http("Append Chat Row", [800, -40], { method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/WhatsApp%20Chat%20Log!A:AL:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({majorDimension:'ROWS',values:[$json.row_values]}) }}", options: {} }, credential);

  const hasClip = ifNode("IF Clip Event", [-420, 180], "={{ $json.has_clip ? 'yes' : 'no' }}", "yes");
  const readClip = http("Read Clip Log", [-160, 180], { url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/WhatsApp%20Clip%20Log!A:AZ`, options: {} }, credential);
  const prepareClip = code("Prepare Clip Upsert", [80, 180], prepareUpsert("clip"));
  const clipUpdate = ifNode("IF Update Clip Row", [320, 180], "={{ $json.write_action }}", "update");
  const updateClip = http("Update Clip Row", [560, 120], { method: "PUT", url: `=https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/WhatsApp%20Clip%20Log!A{{$json.row_number}}:AE{{$json.row_number}}?valueInputOption=RAW`, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({majorDimension:'ROWS',values:[$json.row_values]}) }}", options: {} }, credential);
  const clipAppend = ifNode("IF Append Clip Row", [560, 240], "={{ $json.write_action }}", "append");
  const appendClip = http("Append Clip Row", [800, 240], { method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/WhatsApp%20Clip%20Log!A:AE:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({majorDimension:'ROWS',values:[$json.row_values]}) }}", options: {} }, credential);
  const done = node("Done: Observability Event", "n8n-nodes-base.noOp", [1040, 0], {}, 1);
  const workflow = { id: OBSERVER_ID, name: "Affiliate Distribution - WhatsApp Observability", nodes: [trigger, normalize, readRaw, prepareRaw, appendRaw, hasChat, readChat, prepareChat, chatUpdate, updateChat, chatAppend, appendChat, hasClip, readClip, prepareClip, clipUpdate, updateClip, clipAppend, appendClip, done], connections: {}, settings: { executionOrder: "v1", saveDataErrorExecution: "all", saveDataSuccessExecution: "none", callerPolicy: "any" }, active: false };
  connect(workflow, trigger.name, normalize.name); connect(workflow, normalize.name, readRaw.name); connect(workflow, readRaw.name, prepareRaw.name); connect(workflow, prepareRaw.name, appendRaw.name); connect(workflow, normalize.name, hasChat.name); connect(workflow, normalize.name, hasClip.name);
  connect(workflow, appendRaw.name, done.name); connect(workflow, hasChat.name, readChat.name, 0); connect(workflow, readChat.name, prepareChat.name); connect(workflow, prepareChat.name, chatUpdate.name); connect(workflow, chatUpdate.name, updateChat.name, 0); connect(workflow, chatUpdate.name, chatAppend.name, 1); connect(workflow, chatAppend.name, appendChat.name, 0); connect(workflow, updateChat.name, done.name); connect(workflow, appendChat.name, done.name);
  connect(workflow, hasClip.name, readClip.name, 0); connect(workflow, readClip.name, prepareClip.name); connect(workflow, prepareClip.name, clipUpdate.name); connect(workflow, clipUpdate.name, updateClip.name, 0); connect(workflow, clipUpdate.name, clipAppend.name, 1); connect(workflow, clipAppend.name, appendClip.name, 0); connect(workflow, updateClip.name, done.name); connect(workflow, appendClip.name, done.name);
  return workflow;
}

function patchWebhook(workflow) {
  const prepare = add(workflow, code("Prepare Authenticated Observability", [-80, 360], producer("authenticated_webhook", "AffWaWebhook2026", "processing_result:'authenticated'")));
  const execute = add(workflow, executeObserver("Log Authenticated WhatsApp Event", [160, 360]));
  connect(workflow, "IF Signature Valid", prepare.name, 0); connect(workflow, prepare.name, execute.name);
  return workflow;
}
function patchReply(workflow) {
  const claim = add(workflow, code("Prepare Inbound Claim Observability", [1000, 560], producer("inbound_claim_result", "AffWaReply2026", "processing_result:source.inbound_duplicate?'ignored_duplicate':'claim_attempt'")));
  const enrich = add(workflow, code("Prepare Inbound Enrichment Observability", [1700, 560], producer("inbound_enrichment", "AffWaReply2026", "processing_result:'processed'")));
  const outbound = add(workflow, code("Prepare Outbound Text Observability", [2700, 560], producer("outbound_text", "AffWaReply2026", "processing_result:source.send_succeeded?'accepted':'send_failed'")));
  const guard = add(workflow, code("Prepare Text Guard Observability", [2100, 760], producer("text_guard", "AffWaReply2026", "processing_result:source.outbound_allowed?'authorized':'blocked'")));
  const execute = add(workflow, executeObserver("Log Reply Observability", [2940, 680]));
  connect(workflow, "Prepare Inbound Message Claim", claim.name); connect(workflow, claim.name, execute.name);
  connect(workflow, "Resolve Inbound Affiliate and Intent", enrich.name); connect(workflow, enrich.name, execute.name);
  connect(workflow, "Parse Non-template Text Send", outbound.name); connect(workflow, outbound.name, execute.name);
  connect(workflow, "Guard Phase 1 Text Send", guard.name); connect(workflow, guard.name, execute.name);
  return workflow;
}
function patchDelivery(workflow) {
  // Delivery writes are already batched by AffWaDelivery2026. Per-clip observer
  // fan-out would reintroduce the Sheets request burst that this path avoids.
  return workflow;
}

function main() {
  if (BACKUP && !fs.existsSync(CURRENT)) throw new Error("The verified before-observability backup directory is invalid");
  const env = readEnv();
  if (!env.AFFILIATE_TRACKER_SPREADSHEET_ID) throw new Error("Spreadsheet ID missing");
  const reply = loadCurrent("AffWaReply2026");
  const generatedReply = JSON.parse(fs.readFileSync(path.join(OUTPUT, "affiliate-whatsapp-reply-status.json"), "utf8"));
  const generatedAggregate = generatedReply.nodes.find((item) => item.name === "Aggregate Delivery Status");
  const liveAggregate = reply.nodes.find((item) => item.name === "Aggregate Delivery Status");
  if (!generatedAggregate || !liveAggregate) throw new Error("Reply delivery aggregate node missing");
  liveAggregate.parameters.jsCode = generatedAggregate.parameters.jsCode;
  const generatedSendGuard = generatedReply.nodes.find((item) => item.name === "Guard Phase 1 Text Send");
  const liveSendGuard = reply.nodes.find((item) => item.name === "Guard Phase 1 Text Send");
  if (!generatedSendGuard || !liveSendGuard) throw new Error("Reply text send guard node missing");
  liveSendGuard.parameters.jsCode = generatedSendGuard.parameters.jsCode;
  const credential = reply.nodes.map((item) => item.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential?.id) throw new Error("Existing Google Sheets credential reference missing");
  const webhook = patchWebhook(loadCurrent("AffWaWebhook2026"));
  const delivery = patchDelivery(loadCurrent("AffWaDelivery2026"));
  const patchedReply = patchReply(reply);
  // Import artifacts stay inactive; deployment preserves each live workflow's pre-existing active state.
  webhook.active = false;
  delivery.active = false;
  patchedReply.active = false;
  const observer = buildObserver(credential, env.AFFILIATE_TRACKER_SPREADSHEET_ID);
  save("affiliate-whatsapp-webhook-router.json", webhook);
  save("affiliate-whatsapp-reply-status.json", patchedReply);
  save("affiliate-whatsapp-file-delivery.json", delivery);
  save("affiliate-whatsapp-observability.json", observer);
  process.stdout.write(JSON.stringify({ observer: { id: observer.id, nodes: observer.nodes.length }, patched: [{ id: webhook.id, nodes: webhook.nodes.length }, { id: patchedReply.id, nodes: patchedReply.nodes.length }, { id: delivery.id, nodes: delivery.nodes.length }] }, null, 2) + "\n");
}

main();
