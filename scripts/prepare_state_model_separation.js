"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BACKUP = path.join(ROOT, "n8n", "exports", "live-backups", "before-state-model-separation-20260821T1725CST");
const OUTPUT = path.join(ROOT, "n8n", "exports", "state-model-separation-20260821");
const IDS = ["AfDriveReady2026", "AffDistSetup2026", "AffWaDelivery2026", "AffWaReply2026", "PhFN97UOHrRz1Kwe", "TmpFinalize6911", "TmpReconcile6911Recovery"];
const LEAD_HEADERS = [
  "username", "whatsapp_number", "conversation_id", "captured_at", "reply_1", "reply_2", "reply_3", "state",
  "opt_in_message_id", "opt_in_sent_at", "opted_in_at", "declined_at", "batch_number", "batch_reserved_at",
  "delivery_started_at", "files_expected", "files_sent", "files_delivered", "files_failed", "files_sent_at",
  "files_delivered_at", "posted_confirmed_at", "last_whatsapp_message_id", "last_inbound_at", "last_intent",
  "last_intent_confidence", "last_error", "updated_at", "wa_id", "last_inbound_message_id", "window_expires_at",
  "delivery_state"
];

function sha(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function definition(workflow) { return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings }; }
function node(workflow, name) {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(`${workflow.id}: missing node ${name}`);
  return found;
}
function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}
function addHeader(code, label) {
  if (code.includes('"window_expires_at", "delivery_state"') || code.includes('"window_expires_at",\n  "delivery_state"')) return code;
  if (code.includes('"window_expires_at"\n];')) return replaceOnce(code, '"window_expires_at"\n];', '"window_expires_at",\n  "delivery_state"\n];', label);
  if (code.includes('"window_expires_at"\r\n];')) return replaceOnce(code, '"window_expires_at"\r\n];', '"window_expires_at",\r\n  "delivery_state"\r\n];', label);
  throw new Error(`${label}: lead header terminator not found`);
}
function replaceHeaderArray(code, variable, headers, label) {
  const start = code.indexOf(`const ${variable} = [`);
  const end = start < 0 ? -1 : code.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error(`${label}: ${variable} array not found`);
  const replacement = `const ${variable} = [\n${headers.map((name) => `  ${JSON.stringify(name)}`).join(",\n")}\n];`;
  return code.slice(0, start) + replacement + code.slice(end + 3);
}
function sheetBase(url) {
  const match = String(url).match(/^(https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+)/);
  if (!match) throw new Error(`Cannot parse Sheets base URL: ${url}`);
  return match[1];
}
function batchWrite(item, base, dataExpression) {
  item.parameters.method = "POST";
  item.parameters.url = `${base}/values:batchUpdate`;
  item.parameters.sendBody = true;
  item.parameters.specifyBody = "json";
  item.parameters.jsonBody = `={{ JSON.stringify({ valueInputOption: "RAW", data: ${dataExpression} }) }}`;
}
function leadData(fields) {
  return `[${fields.map(([range, values]) => `{ range: "WhatsApp Leads!${range}".replaceAll("{row}", String($json.row_number)), majorDimension: "ROWS", values: [[${values.map((value) => `$json.${value} == null ? "" : String($json.${value})`).join(", ")}]] }`).join(", ")}]`;
}
function patchDrive(workflow) {
  const read = node(workflow, "Read WhatsApp Leads");
  read.parameters.url = read.parameters.url.replace("A%3AAB", "A%3AAF");
  const prepare = node(workflow, "Prepare Lead Upsert");
  prepare.parameters.jsCode = replaceHeaderArray(prepare.parameters.jsCode, "HEADERS", LEAD_HEADERS, `${workflow.id}: Prepare Lead Upsert`);
  prepare.parameters.jsCode = replaceOnce(prepare.parameters.jsCode, 'record.state = record.state || "interested";', 'record.state = record.state || "interested";\nrecord.delivery_state = record.delivery_state || "not_started";', `${workflow.id}: default delivery state`);
  const update = node(workflow, "Update WhatsApp Lead");
  batchWrite(update, sheetBase(read.parameters.url), leadData([
    ["A{row}:G{row}", ["username", "whatsapp_number", "conversation_id", "captured_at", "reply_1", "reply_2", "reply_3"]],
    ["P{row}:P{row}", ["files_expected"]], ["AB{row}:AB{row}", ["updated_at"]]
  ]));
  node(workflow, "Append WhatsApp Lead").parameters.url = node(workflow, "Append WhatsApp Lead").parameters.url.replace("A%3AAB", "A%3AAF");
}
function patchSetup(workflow) {
  for (const name of ["Read Migrated Leads Header", "Read Leads after Backfill"]) {
    node(workflow, name).parameters.url = node(workflow, name).parameters.url.replace("A1%3AAE", "A1%3AAF");
  }
  const write = node(workflow, "Write Distribution Headers");
  write.parameters.jsonBody = replaceOnce(write.parameters.jsonBody,
    '{"range":"WhatsApp Leads!A1:AE1","values":[["username","whatsapp_number","conversation_id","captured_at","reply_1","reply_2","reply_3","state","opt_in_message_id","opt_in_sent_at","opted_in_at","declined_at","batch_number","batch_reserved_at","delivery_started_at","files_expected","files_sent","files_delivered","files_failed","files_sent_at","files_delivered_at","posted_confirmed_at","last_whatsapp_message_id","last_inbound_at","last_intent","last_intent_confidence","last_error","updated_at","wa_id","last_inbound_message_id","window_expires_at"]]}',
    `{"range":"WhatsApp Leads!A1:AF1","values":[${JSON.stringify(LEAD_HEADERS)}]}`,
    `${workflow.id}: setup header`);
  for (const name of ["Prepare Existing Lead Backfill", "Verify Distribution Sheet Setup"]) {
    const item = node(workflow, name);
    item.parameters.jsCode = replaceOnce(item.parameters.jsCode,
      '["username","whatsapp_number","conversation_id","captured_at","reply_1","reply_2","reply_3","state","opt_in_message_id","opt_in_sent_at","opted_in_at","declined_at","batch_number","batch_reserved_at","delivery_started_at","files_expected","files_sent","files_delivered","files_failed","files_sent_at","files_delivered_at","posted_confirmed_at","last_whatsapp_message_id","last_inbound_at","last_intent","last_intent_confidence","last_error","updated_at","wa_id","last_inbound_message_id","window_expires_at"]',
      JSON.stringify(LEAD_HEADERS), `${workflow.id}: ${name} headers`);
    item.parameters.jsCode = item.parameters.jsCode.replace(/:AE/g, ":AF");
  }
}
function patchDelivery(workflow) {
  for (const name of ["Read WhatsApp Leads for Reservation", "Reread Leads after Reservation"]) {
    node(workflow, name).parameters.url = node(workflow, name).parameters.url.replace("A%3AAE", "A%3AAF");
  }
  const select = node(workflow, "Select and Prepare Batch Reservation");
  select.parameters.jsCode = addHeader(select.parameters.jsCode, `${workflow.id}: select headers`);
  select.parameters.jsCode = replaceOnce(select.parameters.jsCode, 'state: "delivery_in_progress",', 'delivery_state: "delivery_in_progress",', `${workflow.id}: reservation state`);
  const reserve = node(workflow, "Reserve Batch in Leads");
  batchWrite(reserve, sheetBase(node(workflow, "Read WhatsApp Leads for Reservation").parameters.url), leadData([
    ["M{row}:P{row}", ["batch_number", "batch_reserved_at", "delivery_started_at", "files_expected"]],
    ["AA{row}:AB{row}", ["last_error", "updated_at"]], ["AF{row}:AF{row}", ["delivery_state"]]
  ]));
  const restore = node(workflow, "Restore and Validate Delivery Context");
  restore.parameters.jsCode = addHeader(restore.parameters.jsCode, `${workflow.id}: restore headers`);
  restore.parameters.jsCode = replaceOnce(restore.parameters.jsCode, 'delivery_state: lead.state,', 'delivery_state: text(lead.delivery_state) || (["delivery_in_progress", "partial", "files_sent", "files_delivered", "failed"].includes(text(lead.state)) ? text(lead.state) : "not_started"),', `${workflow.id}: restore state`);
  const summary = node(workflow, "Prepare Cached Delivery Summary");
  summary.parameters.jsCode = replaceOnce(summary.parameters.jsCode,
    'const leadRecord = { ...source, state: accepted === expected ? "files_sent" : failed ? "failed" : "delivery_in_progress",',
    'const leadRecord = { ...source, delivery_state: accepted === expected ? "files_sent" : failed ? "failed" : accepted ? "partial" : "delivery_in_progress",',
    `${workflow.id}: final summary state`);
  const zero = node(workflow, "Prepare Zero-Remaining Recovery Finalization");
  zero.parameters.jsCode = replaceOnce(zero.parameters.jsCode, 'const leadRecord = { ...source, state,', 'const leadRecord = { ...source, delivery_state: state,', `${workflow.id}: zero recovery state`);
  zero.parameters.jsCode = replaceOnce(zero.parameters.jsCode, 'text(source.state) === text(leadRecord.state)', 'text(source.delivery_state) === text(leadRecord.delivery_state)', `${workflow.id}: zero recovery comparison`);
  const final = node(workflow, "Update Final Send State");
  batchWrite(final, sheetBase(node(workflow, "Read WhatsApp Leads for Reservation").parameters.url), leadData([
    ["P{row}:U{row}", ["files_expected", "files_sent", "files_delivered", "files_failed", "files_sent_at", "files_delivered_at"]],
    ["AA{row}:AB{row}", ["last_error", "updated_at"]], ["AF{row}:AF{row}", ["delivery_state"]]
  ]));
}
function patchReply(workflow) {
  for (const name of ["Read Leads for Inbound Resolution", "Read Leads Immediately Before Text Send"]) {
    node(workflow, name).parameters.url = node(workflow, name).parameters.url.replace("A%3AAE", "A%3AAF");
  }
  const resolve = node(workflow, "Resolve Inbound Affiliate and Intent");
  resolve.parameters.jsCode = replaceOnce(resolve.parameters.jsCode,
    'const explicitContinue = /^(?:yes|iya|lanjut|continue|kirim|kirim video|mau video|mau clips?)\\b/i.test(lower);\nconst ready =',
    'const explicitContinue = /^(?:yes|iya|lanjut|continue|kirim|kirim video|mau video|mau clips?)\\b/i.test(lower);\nconst legacyDeliveryStates = new Set(["delivery_in_progress", "partial", "files_sent", "files_delivered", "failed"]);\nconst currentDeliveryState = text(current?.delivery_state) || (legacyDeliveryStates.has(text(current?.state)) ? text(current?.state) : "not_started");\nconst deliveryComplete = ["files_sent", "files_delivered"].includes(currentDeliveryState);\nconst ready =',
    `${workflow.id}: reply delivery guard`);
  resolve.parameters.jsCode = replaceOnce(resolve.parameters.jsCode,
    '(explicitContinue && hasValidUsername && ["awaiting_confirmation", "distribution_pending", "waiting_for_affiliate_message"].includes(current?.state));',
    '(explicitContinue && hasValidUsername && !deliveryComplete && ["awaiting_confirmation", "distribution_pending", "waiting_for_affiliate_message"].includes(current?.state));',
    `${workflow.id}: completed delivery guard`);
  node(workflow, "Append New WhatsApp Lead").parameters.url = node(workflow, "Append New WhatsApp Lead").parameters.url.replace("A%3AAE", "A%3AAF");
  const base = sheetBase(node(workflow, "Read Leads for Inbound Resolution").parameters.url);
  const conversationFields = [
    ["A{row}:D{row}", ["username", "whatsapp_number", "conversation_id", "captured_at"]],
    ["H{row}:H{row}", ["state"]], ["W{row}:Z{row}", ["last_whatsapp_message_id", "last_inbound_at", "last_intent", "last_intent_confidence"]],
    ["AB{row}:AE{row}", ["updated_at", "wa_id", "last_inbound_message_id", "window_expires_at"]]
  ];
  batchWrite(node(workflow, "Refresh Existing WhatsApp Lead Window"), base, leadData(conversationFields));
  batchWrite(node(workflow, "Mark Waiting after Blocked Text"), base, leadData([
    ["H{row}:H{row}", ["state"]], ["AA{row}:AB{row}", ["last_error", "updated_at"]]
  ]));
}
function patchLegacyRecovery(workflow) {
  if (workflow.id === "PhFN97UOHrRz1Kwe") {
    const read = node(workflow, "Read Stage 3 Finalization Data Once");
    read.parameters.url = read.parameters.url.replace("A%3AAE", "A%3AAF");
    const prepare = node(workflow, "Validate and Prepare Stage 3 Final State");
    prepare.parameters.jsCode = replaceOnce(prepare.parameters.jsCode, 'const record={...lead,state:"files_sent",', 'const record={...lead,delivery_state:"files_sent",', `${workflow.id}: final state`);
    batchWrite(node(workflow, "Write Stage 3 Lead Final State"), sheetBase(read.parameters.url), leadData([
      ["P{row}:U{row}", ["files_expected", "files_sent", "files_delivered", "files_failed", "files_sent_at", "files_delivered_at"]],
      ["AA{row}:AB{row}", ["last_error", "updated_at"]], ["AF{row}:AF{row}", ["delivery_state"]]
    ]));
    return;
  }
  const readName = workflow.id === "TmpFinalize6911" ? "Read Final State Once" : "Read Logs Once";
  const prepareName = workflow.id === "TmpFinalize6911" ? "Prepare Guarded Finalization" : "Prepare Guarded Recovery Reconciliation";
  const read = node(workflow, readName);
  read.parameters.url = read.parameters.url.replace("A%3AAE", "A%3AAF");
  const prepare = node(workflow, prepareName);
  if (workflow.id === "TmpFinalize6911") {
    prepare.parameters.jsCode = replaceOnce(prepare.parameters.jsCode, "const leadRecord={...lead,state:'files_sent',", "const leadRecord={...lead,delivery_state:'files_sent',", `${workflow.id}: final state`);
  } else {
    prepare.parameters.jsCode = replaceOnce(prepare.parameters.jsCode, "const leadRecord={...lead,state:'delivery_in_progress',", "const leadRecord={...lead,delivery_state:'delivery_in_progress',", `${workflow.id}: recovery state`);
  }
  const oldWrite = "data.push({range:'WhatsApp Leads!A'+lead.row_number+':AE'+lead.row_number,majorDimension:'ROWS',values:[leads.headers.map(n=>t(leadRecord[n]))]});";
  const newWrite = "data.push({range:'WhatsApp Leads!P'+lead.row_number+':U'+lead.row_number,majorDimension:'ROWS',values:[[leadRecord.files_expected,leadRecord.files_sent,leadRecord.files_delivered,leadRecord.files_failed,leadRecord.files_sent_at,leadRecord.files_delivered_at].map(t)]},{range:'WhatsApp Leads!AA'+lead.row_number+':AB'+lead.row_number,majorDimension:'ROWS',values:[[leadRecord.last_error,leadRecord.updated_at].map(t)]},{range:'WhatsApp Leads!AF'+lead.row_number+':AF'+lead.row_number,majorDimension:'ROWS',values:[[t(leadRecord.delivery_state)]]});";
  prepare.parameters.jsCode = replaceOnce(prepare.parameters.jsCode, oldWrite, newWrite, `${workflow.id}: scoped lead write`);
}

fs.mkdirSync(path.join(OUTPUT, "staged-workflows"), { recursive: true });
const report = { prepared_at: new Date().toISOString(), backup: BACKUP, workflows: [] };
for (const id of IDS) {
  const file = path.join(BACKUP, "workflows", `${id}.json`);
  const workflow = JSON.parse(fs.readFileSync(file, "utf8"));
  const before = sha(definition(workflow));
  if (id === "AfDriveReady2026") patchDrive(workflow);
  if (id === "AffDistSetup2026") patchSetup(workflow);
  if (id === "AffWaDelivery2026") patchDelivery(workflow);
  if (id === "AffWaReply2026") patchReply(workflow);
  if (["PhFN97UOHrRz1Kwe", "TmpFinalize6911", "TmpReconcile6911Recovery"].includes(id)) patchLegacyRecovery(workflow);
  const after = sha(definition(workflow));
  fs.writeFileSync(path.join(OUTPUT, "staged-workflows", `${id}.json`), JSON.stringify(workflow, null, 2) + "\n");
  report.workflows.push({ id, active: workflow.active, node_count: workflow.nodes.length, before_sha256: before, staged_sha256: after, caller_policy: workflow.settings?.callerPolicy || "", caller_ids: workflow.settings?.callerIds || "" });
}
fs.writeFileSync(path.join(OUTPUT, "prepare-report.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
