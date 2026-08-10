"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const delivery = JSON.parse(fs.readFileSync(path.join(ROOT, "n8n", "imports", "affiliate-whatsapp-file-delivery.json"), "utf8"));
const credential = delivery.nodes.find((node) => node.name === "Batch Write Delivery Results").credentials.googleSheetsOAuth2Api;
const spreadsheetId = /spreadsheets\/([^/]+)/.exec(delivery.nodes.find((node) => node.name === "Batch Write Delivery Results").parameters.url)[1];
const columns = ["queue_id", "status", "workflow_id", "execution_id", "conversation_id", "phone_number", "batch_number", "spreadsheet_id", "delivery_tab", "message_tab", "delivery_updates_json", "message_rows_json", "created_at", "updated_at", "attempts", "last_error"];
const id = () => crypto.randomUUID();
const node = (name, type, typeVersion, position, parameters = {}, extra = {}) => ({ id: id(), name, type, typeVersion, position, parameters, ...extra });
const code = (name, position, jsCode) => node(name, "n8n-nodes-base.code", 2, position, { jsCode });
const connect = (names) => ({ main: [(names || []).map((name) => ({ node: name, type: "main", index: 0 }))] });
const schema = columns.map((column) => ({ id: column, displayName: column, required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true }));
const table = (name, position, parameters, extra = {}) => node(name, "n8n-nodes-base.dataTable", 1.1, position, parameters, extra);
const google = (name, position, parameters) => node(name, "n8n-nodes-base.httpRequest", 4.4, position, {
  authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", ...parameters
}, { credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 8, waitBetweenTries: 10000, continueOnFail: true });

const ensure = table("Ensure Outbound Log Recovery Table", [-760, 0], {
  resource: "table", operation: "create", tableName: "wa_outbound_log_recovery",
  columns: { column: columns.map((name) => ({ name, type: "string" })) }, options: { createIfNotExists: true }
});
const pending = table("Read Pending Outbound Log Payloads", [-540, 0], {
  resource: "row", operation: "get", dataTableId: { __rl: true, mode: "name", value: "wa_outbound_log_recovery" },
  matchType: "allConditions", filters: { conditions: [{ keyName: "status", condition: "eq", keyValue: "pending" }] },
  returnAll: true, orderBy: true, orderByColumn: "createdAt", orderByDirection: "ASC"
});
const consolidate = code("Consolidate Pending Recovery Payloads", [-320, 0], String.raw`
const rows=$input.all().map((item)=>item.json); if(!rows.length)return [];
return [{json:{queue_rows:rows,delivery_updates:rows.flatMap((row)=>{try{return JSON.parse(row.delivery_updates_json||"[]")}catch{return[]}}),message_rows:rows.flatMap((row)=>{try{return JSON.parse(row.message_rows_json||"[]")}catch{return[]}})}}];`);
const readDelivery = google("Read Delivery Log Once for Recovery", [-100, 0], {
  url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("Delivery Log")}!A%3AR`, options: {}
});
const between = code("Restore Recovery Payload between Reads", [120, 0],
  'return [{json:$("Consolidate Pending Recovery Payloads").first().json}];');
const readMessages = google("Read Message Log Once for Recovery", [340, 0], {
  url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("WhatsApp Message Log")}!A%3AX`, options: {}
});
const prepare = code("Prepare Idempotent Recovery Batch", [560, 0], String.raw`
const source=$("Consolidate Pending Recovery Payloads").first().json; const values=$json.values||[];
const headers=(values[0]||[]).map((v)=>String(v||"").trim()); const idIndex=headers.indexOf("whatsapp_message_id");
const existing=new Set(values.slice(1).map((row)=>String(row[idIndex]||"").trim()).filter(Boolean));
const seen=new Set(existing); const messages=[]; for(const row of source.message_rows){const id=String(row[0]||"").trim();if(id&&!seen.has(id)){seen.add(id);messages.push(row)}}
return [{json:{...source,message_rows_missing:messages,message_count_missing:messages.length}}];`);
const writeDelivery = google("Retry Delivery Log Batch", [780, -60], {
  method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, sendBody: true,
  specifyBody: "json", jsonBody: '={{ JSON.stringify({ valueInputOption: "RAW", data: $json.delivery_updates }) }}', options: {}
});
const restoreAfterDelivery = code("Capture Recovery Delivery Result", [1000, -60], String.raw`
const source=$("Prepare Idempotent Recovery Batch").first().json; const response=$input.first().json||{};
return [{json:{...source,delivery_error:response.error?JSON.stringify(response.error):""}}];`);
const hasMessages = node("IF Recovery Messages Missing", "n8n-nodes-base.if", 2.3, [1220, -60], { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 }, conditions: [{ id: id(), leftValue: "={{ Number($json.message_count_missing) > 0 }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {} });
const appendMessages = google("Retry Message Log Batch", [1440, -140], {
  method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("WhatsApp Message Log")}!A%3AX:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
  sendBody: true, specifyBody: "json", jsonBody: '={{ JSON.stringify({ majorDimension: "ROWS", values: $json.message_rows_missing }) }}', options: {}
});
const finish = code("Prepare Recovery Queue Updates", [1660, -60], String.raw`
const source=$("Capture Recovery Delivery Result").first().json; let messageError="";
try{const response=$("Retry Message Log Batch").first().json||{};messageError=response.error?JSON.stringify(response.error):""}catch{}
const errors=[source.delivery_error,messageError].filter(Boolean); const now=new Date().toISOString();
return source.queue_rows.map((row)=>({json:{...row,status:errors.length?"pending":"flushed",updated_at:now,attempts:String(Number(row.attempts||0)+1),last_error:errors.join(" | ")}}));`);
const update = table("Update Recovery Queue Rows", [1880, -60], {
  resource: "row", operation: "update", dataTableId: { __rl: true, mode: "name", value: "wa_outbound_log_recovery" },
  matchType: "allConditions", filters: { conditions: [{ keyName: "queue_id", condition: "eq", keyValue: "={{ $json.queue_id }}" }] },
  columns: { mappingMode: "defineBelow", value: { status: "={{ $json.status }}", updated_at: "={{ $json.updated_at }}", attempts: "={{ $json.attempts }}", last_error: "={{ $json.last_error }}" }, schema }, options: {}
}, { continueOnFail: true });
const done = node("Done: Recovery Attempt", "n8n-nodes-base.noOp", 1, [2100, -60]);
const manual = node("Manual Recovery Trigger", "n8n-nodes-base.manualTrigger", 1, [-980, -80]);
const schedule = node("Retry Pending Logs Every 15 Minutes", "n8n-nodes-base.scheduleTrigger", 1.3, [-980, 80], { rule: { interval: [{ field: "minutes", minutesInterval: 15 }] } });

const workflow = {
  name: "Affiliate Distribution - Outbound Log Recovery",
  nodes: [manual, schedule, ensure, pending, consolidate, readDelivery, between, readMessages, prepare, writeDelivery, restoreAfterDelivery, hasMessages, appendMessages, finish, update, done],
  connections: {
    [manual.name]: connect([ensure.name]), [schedule.name]: connect([ensure.name]), [ensure.name]: connect([pending.name]),
    [pending.name]: connect([consolidate.name]), [consolidate.name]: connect([readDelivery.name]), [readDelivery.name]: connect([between.name]),
    [between.name]: connect([readMessages.name]), [readMessages.name]: connect([prepare.name]), [prepare.name]: connect([writeDelivery.name]),
    [writeDelivery.name]: connect([restoreAfterDelivery.name]), [restoreAfterDelivery.name]: connect([hasMessages.name]),
    [hasMessages.name]: { main: [[{ node: appendMessages.name, type: "main", index: 0 }], [{ node: finish.name, type: "main", index: 0 }]] },
    [appendMessages.name]: connect([finish.name]), [finish.name]: connect([update.name]), [update.name]: connect([done.name])
  },
  settings: { executionOrder: "v1", saveDataErrorExecution: "all", saveDataSuccessExecution: "all" },
  active: false
};
const output = path.join(ROOT, "n8n", "imports", "affiliate-outbound-log-recovery.json");
fs.writeFileSync(output, JSON.stringify(workflow, null, 2) + "\n");
console.log(output);
