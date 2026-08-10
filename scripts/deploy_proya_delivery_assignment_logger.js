"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const DELIVERY_ID = "AffWaDelivery2026";
const SPREADSHEET_ID = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
const SHEET_NAME = "Delivery Log";
const LOGGER_NAME = "PROYA WhatsApp Delivery Log Writer";
const RETRY_NAME = "PROYA WhatsApp Delivery Log Retry";
const TABLE_NAME = "proya_delivery_assignment_log";
const ALLOWED_SETTINGS = [
  "saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution",
  "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone",
  "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution",
  "redactionPolicy", "availableInMCP", "customTelemetryTags"
];

function readEnv() {
  const output = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) output[match[1].trim()] = match[2];
  }
  return output;
}

async function api(route, key, options = {}) {
  const response = await fetch(`${API}${route}`, {
    ...options,
    headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 600)}`);
  return body ? JSON.parse(body) : {};
}

function workflowPayload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: Object.fromEntries(ALLOWED_SETTINGS
      .filter((name) => Object.hasOwn(workflow.settings || {}, name))
      .map((name) => [name, workflow.settings[name]]))
  };
}

function id() { return crypto.randomUUID(); }
function node(name, type, typeVersion, position, parameters = {}, extra = {}) {
  return { id: id(), name, type, typeVersion, position, parameters, ...extra };
}
function code(name, position, jsCode) { return node(name, "n8n-nodes-base.code", 2, position, { jsCode }); }
function connect(names) { return { main: [(Array.isArray(names) ? names : [names]).map((name) => ({ node: name, type: "main", index: 0 }))] }; }
function executeWorkflow(name, position, workflowId, waitForSubWorkflow) {
  return node(name, "n8n-nodes-base.executeWorkflow", 1.3, position, {
    source: "database",
    workflowId: { __rl: true, value: workflowId, mode: "list", cachedResultName: workflowId },
    mode: "once",
    options: { waitForSubWorkflow }
  });
}

const COLUMNS = [
  "assignment_key", "sync_state", "row_number", "numbered_folder", "username",
  "whatsapp_number", "sent_at", "clips_sent_count", "expected_clips",
  "delivery_status", "error", "phase", "spreadsheet_id", "updated_at",
  "attempts", "last_error"
];
const schema = COLUMNS.map((column) => ({
  id: column, displayName: column, required: false, defaultMatch: false,
  display: true, type: "string", canBeUsedToMatch: true
}));
const table = (name, position, parameters, extra = {}) => node(name, "n8n-nodes-base.dataTable", 1.1, position, parameters, extra);

function ensureTable(name, position) {
  return table(name, position, {
    resource: "table", operation: "create", tableName: TABLE_NAME,
    columns: { column: COLUMNS.map((column) => ({ name: column, type: "string" })) },
    options: { createIfNotExists: true }
  });
}

function tableMapping(values) {
  return { mappingMode: "defineBelow", value: values, schema };
}

function googleNode(name, position, credential, parameters, extra = {}) {
  return node(name, "n8n-nodes-base.httpRequest", 4.4, position, {
    authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", ...parameters
  }, {
    credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true,
    maxTries: 3, waitBetweenTries: 2500, ...extra
  });
}

function buildLogger(credential, callerIds = "") {
  const trigger = node("When Called to Log Assignment", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [-1460, 0], { inputSource: "passthrough" });
  const normalize = code("Normalize Assignment Log Event", [-1240, 0], String.raw`
function text(value){return value==null?"":String(value).trim()}
function digits(value){const d=text(value).replace(/\D/g,"");return d.startsWith("0")?"62"+d.slice(1):d}
function jakarta(value){const raw=text(value);if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} WIB$/.test(raw))return raw;const parsed=Date.parse(raw||new Date().toISOString());if(!Number.isFinite(parsed))throw new Error("assignment_log_invalid_timestamp");return new Date(parsed+7*60*60*1000).toISOString().slice(0,19).replace("T"," ")+" WIB"}
const allowed=new Set(["Sending","Complete","Partial","Failed","Skipped"]);
return $input.all().map((item)=>{const s=item.json||{},phone=digits(s.whatsapp_number||s.phone_number),folder=text(s.numbered_folder||s.original_folder_number||s.batch_number),username=text(s.username||s.tiktok_username).replace(/^@+/,""),sentAt=jakarta(s.assignment_timestamp||s.sent_at||s.delivery_started_at),expected=Math.max(0,Number(s.expected_clips||s.expected_clip_count||15)),count=Math.max(0,Math.min(expected,Number(s.clips_sent_count||s.successful_count||0))),status=text(s.status||s.delivery_status||"Sending"),key=text(s.assignment_key||s.assignment_id)||[folder,phone,sentAt].join(":");if(!key)throw new Error("assignment_log_key_missing");if(!folder)throw new Error("assignment_log_numbered_folder_missing");if(!phone)throw new Error("assignment_log_phone_missing");if(!allowed.has(status))throw new Error("assignment_log_invalid_status");const controlled=key.startsWith("test:")&&username==="codex_logger_test";return{json:{assignment_key:key,sync_state:"pending",row_number:text(s.row_number),numbered_folder:folder,username:username||"Unknown",whatsapp_number:phone,sent_at:sentAt,clips_sent_count:String(count),expected_clips:String(expected),delivery_status:status,error:text(s.error),phase:text(s.phase||"update"),spreadsheet_id:controlled&&s.simulate_sheet_failure===true?"controlled-invalid-spreadsheet-id":"${SPREADSHEET_ID}",updated_at:new Date().toISOString(),attempts:String(Number(s.attempts||0)),last_error:""}}});`);
  const ensure = ensureTable("Ensure Assignment Log State Table", [-1020, 0]);
  const restore = code("Restore Normalized Assignment Event", [-800, 0], `return [{json:$("Normalize Assignment Log Event").item.json}];`);
  const lookup = table("Read Existing Assignment Log State", [-580, 0], {
    resource: "row", operation: "get", dataTableId: { __rl: true, mode: "name", value: TABLE_NAME },
    matchType: "allConditions", filters: { conditions: [{ keyName: "assignment_key", condition: "eq", keyValue: "={{ $json.assignment_key }}" }] },
    returnAll: false, limit: 1
  }, { alwaysOutputData: true });
  const prepare = code("Prepare Pending Assignment State", [-360, 0], String.raw`
const event=$("Restore Normalized Assignment Event").item.json,existing=$json?.assignment_key?$json:{};
const previous=Number(existing.clips_sent_count||0),incoming=Number(event.clips_sent_count||0),count=Math.max(previous,incoming),expected=Math.max(Number(existing.expected_clips||0),Number(event.expected_clips||0));
let status=event.delivery_status;if(existing.delivery_status==="Complete"&&status==="Sending")status="Complete";
const merged={...existing,...event,_has_existing:Boolean(existing.assignment_key),row_number:String(existing.row_number||event.row_number||""),numbered_folder:String(existing.numbered_folder||event.numbered_folder),sent_at:String(existing.sent_at||event.sent_at),clips_sent_count:String(count),expected_clips:String(expected),delivery_status:status,attempts:String(Number(existing.attempts||event.attempts||0)+1),sync_state:"pending",updated_at:new Date().toISOString(),last_error:""};
merged.row_values=[merged.numbered_folder,merged.username,merged.whatsapp_number,merged.sent_at,merged.clips_sent_count+"/"+merged.expected_clips,merged.delivery_status,merged.error||""];
return[{json:merged}];`);
  const exists = node("IF Assignment State Exists", "n8n-nodes-base.if", 2.3, [-140, 0], {
    conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 }, conditions: [{ id: id(), leftValue: "={{ $json._has_existing }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {}
  });
  const values = Object.fromEntries(COLUMNS.map((column) => [column, `={{ $json.${column} }}`]));
  const updatePending = table("Update Pending Assignment State", [80, -100], {
    resource: "row", operation: "update", dataTableId: { __rl: true, mode: "name", value: TABLE_NAME },
    matchType: "allConditions", filters: { conditions: [{ keyName: "assignment_key", condition: "eq", keyValue: "={{ $json.assignment_key }}" }] },
    columns: tableMapping(values), options: {}
  });
  const insertPending = table("Insert Pending Assignment State", [80, 100], {
    resource: "row", operation: "insert", dataTableId: { __rl: true, mode: "name", value: TABLE_NAME },
    columns: tableMapping(values), options: { optimizeBulk: false }
  });
  const restorePending = code("Restore Pending State for Google", [300, 0], `return [{json:$("Prepare Pending Assignment State").item.json}];`);
  const readSheet = googleNode("Read PROYA Delivery Log for Idempotency", [520, 0], credential, {
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{$json.spreadsheet_id}}/values/%27Delivery%20Log%27!A%3AG",
    options: { timeout: 45000 }
  });
  const resolveRow = code("Resolve Existing Delivery Log Row", [740, 0], String.raw`
const state=$("Restore Pending State for Google").item.json,values=Array.isArray($json.values)?$json.values:[];const digits=(v)=>String(v??"").replace(/\D/g,"");let row=Number(state.row_number||0);if(!row){for(let i=1;i<values.length;i++){const r=values[i]||[];if(String(r[0]??"").trim()===state.numbered_folder&&digits(r[2])===state.whatsapp_number&&String(r[3]??"").trim()===state.sent_at){row=i+1;break}}}return[{json:{...state,row_number:row?String(row):"",_sheet_row_exists:Boolean(row)}}];`);
  const rowExists = node("IF Delivery Log Row Exists", "n8n-nodes-base.if", 2.3, [960, 0], {
    conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 }, conditions: [{ id: id(), leftValue: "={{ $json._sheet_row_exists }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {}
  });
  const updateSheet = googleNode("Update Existing PROYA Delivery Log Row", [1180, -100], credential, {
    method: "PUT", url: "=https://sheets.googleapis.com/v4/spreadsheets/{{$json.spreadsheet_id}}/values/%27Delivery%20Log%27!A{{$json.row_number}}%3AG{{$json.row_number}}?valueInputOption=RAW",
    sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({ majorDimension: 'ROWS', values: [$json.row_values] }) }}", options: { timeout: 45000 }
  });
  const appendSheet = googleNode("Append New PROYA Delivery Log Row", [1180, 100], credential, {
    method: "POST", url: "=https://sheets.googleapis.com/v4/spreadsheets/{{$json.spreadsheet_id}}/values/%27Delivery%20Log%27!A%3AG:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
    sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({ majorDimension: 'ROWS', values: [$json.row_values] }) }}", options: { timeout: 45000 }
  });
  const capture = code("Capture Google Assignment Log Result", [1400, 0], String.raw`
const state=$("Resolve Existing Delivery Log Row").item.json,response=$json||{};let row=Number(state.row_number||0);if(!row){const range=String(response?.updates?.updatedRange||response?.updatedRange||"");const match=/!(?:[A-Z]+)(\d+)(?::|$)/.exec(range);row=match?Number(match[1]):0}if(!row)throw new Error("assignment_log_google_row_number_missing");return[{json:{...state,row_number:String(row),sync_state:"synced",updated_at:new Date().toISOString(),last_error:"",google_updated_range:String(response?.updates?.updatedRange||response?.updatedRange||""),google_updated_rows:String(response?.updates?.updatedRows||response?.updatedRows||1)}}];`);
  const syncedValues = Object.fromEntries(COLUMNS.map((column) => [column, `={{ $json.${column} }}`]));
  const markSynced = table("Mark Assignment Log State Synced", [1620, 0], {
    resource: "row", operation: "update", dataTableId: { __rl: true, mode: "name", value: TABLE_NAME },
    matchType: "allConditions", filters: { conditions: [{ keyName: "assignment_key", condition: "eq", keyValue: "={{ $json.assignment_key }}" }] },
    columns: tableMapping(syncedValues), options: {}
  });
  const done = code("Done: Assignment Log Synced", [1840, 0], `const s=$("Capture Google Assignment Log Result").item.json;return[{json:{assignment_key:s.assignment_key,row_number:s.row_number,numbered_folder:s.numbered_folder,username:s.username,whatsapp_number:s.whatsapp_number,sent_at:s.sent_at,clips_sent:s.clips_sent_count+"/"+s.expected_clips,status:s.delivery_status,error:s.error,spreadsheet_id:s.spreadsheet_id,sheet_name:"${SHEET_NAME}",google_updated_range:s.google_updated_range,google_updated_rows:s.google_updated_rows,sync_state:"synced"}}];`);

  return {
    name: LOGGER_NAME,
    nodes: [trigger, normalize, ensure, restore, lookup, prepare, exists, updatePending, insertPending, restorePending, readSheet, resolveRow, rowExists, updateSheet, appendSheet, capture, markSynced, done],
    connections: {
      [trigger.name]: connect(normalize.name), [normalize.name]: connect(ensure.name), [ensure.name]: connect(restore.name), [restore.name]: connect(lookup.name),
      [lookup.name]: connect(prepare.name), [prepare.name]: connect(exists.name),
      [exists.name]: { main: [[{ node: updatePending.name, type: "main", index: 0 }], [{ node: insertPending.name, type: "main", index: 0 }]] },
      [updatePending.name]: connect(restorePending.name), [insertPending.name]: connect(restorePending.name), [restorePending.name]: connect(readSheet.name),
      [readSheet.name]: connect(resolveRow.name), [resolveRow.name]: connect(rowExists.name),
      [rowExists.name]: { main: [[{ node: updateSheet.name, type: "main", index: 0 }], [{ node: appendSheet.name, type: "main", index: 0 }]] },
      [updateSheet.name]: connect(capture.name), [appendSheet.name]: connect(capture.name), [capture.name]: connect(markSynced.name), [markSynced.name]: connect(done.name)
    },
    settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all", saveManualExecutions: true, callerPolicy: "workflowsFromAList", callerIds }
  };
}

function buildRetry(loggerId) {
  const manual = node("Manual Assignment Log Retry", "n8n-nodes-base.manualTrigger", 1, [-900, -100]);
  const schedule = node("Retry Assignment Logs Every 10 Minutes", "n8n-nodes-base.scheduleTrigger", 1.3, [-900, 100], { rule: { interval: [{ field: "minutes", minutesInterval: 10 }] } });
  const ensure = ensureTable("Ensure Assignment Log State Table for Retry", [-680, 0]);
  const pending = table("Read Pending Assignment Logs", [-460, 0], {
    resource: "row", operation: "get", dataTableId: { __rl: true, mode: "name", value: TABLE_NAME },
    matchType: "allConditions", filters: { conditions: [{ keyName: "sync_state", condition: "eq", keyValue: "pending" }] },
    returnAll: true, orderBy: true, orderByColumn: "createdAt", orderByDirection: "ASC"
  });
  const loop = node("Loop Pending Assignment Logs", "n8n-nodes-base.splitInBatches", 3, [-240, 0], { batchSize: 1, options: {} });
  const retry = executeWorkflow("Retry One Assignment Log Only", [0, 80], loggerId, true);
  const done = node("Done: Assignment Log Retry Pass", "n8n-nodes-base.noOp", 1, [0, -80]);
  return {
    name: RETRY_NAME,
    nodes: [manual, schedule, ensure, pending, loop, retry, done],
    connections: {
      [manual.name]: connect(ensure.name), [schedule.name]: connect(ensure.name), [ensure.name]: connect(pending.name), [pending.name]: connect(loop.name),
      [loop.name]: { main: [[{ node: done.name, type: "main", index: 0 }], [{ node: retry.name, type: "main", index: 0 }]] },
      [retry.name]: connect(loop.name)
    },
    settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all", saveManualExecutions: true }
  };
}

function startLogCode() {
  return String.raw`
const source=$("Restore and Validate Delivery Context").first().json,text=(v)=>v==null?"":String(v).trim(),values=Array.isArray(source.delivery_log_values)?source.delivery_log_values:[],headers=(values[0]||[]).map(text),rows=values.slice(1).map((row)=>Object.fromEntries(headers.map((name,index)=>[name,text(row[index])]))).filter((row)=>row.conversation_id===text(source.conversation_id)&&row.batch_number===text(source.batch_number));
const accepted=new Set(rows.filter((row)=>row.delivery_key&&(["accepted","sent","delivered","read"].includes(row.send_state)||["accepted","sent","delivered","read"].includes(row.state)||Boolean(row.whatsapp_message_id))).map((row)=>row.delivery_key)).size,expected=Number(source.expected_clip_count||15);
return[{json:{assignment_key:text(source.assignment_id)||text(source.conversation_id)+":"+text(source.batch_number),numbered_folder:text(source.batch_number),username:text(source.tiktok_username||source.username),whatsapp_number:text(source.whatsapp_number||source.wa_id),assignment_timestamp:text(source.delivery_started_at||source.batch_reserved_at||source.updated_at),clips_sent_count:accepted,expected_clips:expected,status:accepted>=expected?"Complete":"Sending",error:"",phase:"start"}}];`;
}

function finalLogCode() {
  return String.raw`
const source=$("Restore and Validate Delivery Context").first().json,batch=$("Prepare Batched Delivery Tracking").first().json,text=(v)=>v==null?"":String(v).trim(),values=Array.isArray(source.delivery_log_values)?source.delivery_log_values:[],headers=(values[0]||[]).map(text),rows=values.slice(1).map((row)=>Object.fromEntries(headers.map((name,index)=>[name,text(row[index])]))).filter((row)=>row.conversation_id===text(source.conversation_id)&&row.batch_number===text(source.batch_number));
for(const result of batch.results||[])rows.push(Object.fromEntries(["delivery_key","conversation_id","whatsapp_number","batch_number","file_index","file_name","media_id","whatsapp_message_id","state","attempts","uploaded_at","sent_at","delivered_at","failed_at","last_error","updated_at","send_state","delivery_state"].map((name,index)=>[name,text(result.delivery_row_values?.[index])])));
const rank={failed:1,accepted:2,sent:3,delivered:4,read:5},byKey=new Map();for(const row of rows){if(!row.delivery_key)continue;const state=row.delivery_state||row.state||row.send_state,current=byKey.get(row.delivery_key);if(!current||(rank[state]||0)>(rank[current]||0))byKey.set(row.delivery_key,state)}
const states=[...byKey.values()],accepted=states.filter((state)=>["accepted","sent","delivered","read"].includes(state)).length,expected=Number(source.expected_clip_count||15),status=accepted>=expected?"Complete":accepted>0?"Partial":"Failed",errors=[...(batch.results||[]).map((r)=>text(r.last_error)).filter(Boolean)].filter((v,i,a)=>a.indexOf(v)===i).slice(0,3).join("; ");
return[{json:{assignment_key:text(source.assignment_id)||text(source.conversation_id)+":"+text(source.batch_number),numbered_folder:text(source.batch_number),username:text(source.tiktok_username||source.username),whatsapp_number:text(source.whatsapp_number||source.wa_id),assignment_timestamp:text(source.delivery_started_at||source.batch_reserved_at||source.updated_at),clips_sent_count:accepted,expected_clips:expected,status,error:status==="Complete"?"":(errors||"One or more media-send requests did not return a message ID"),phase:"final"}}];`;
}

async function upsertByName(key, desired) {
  const list = await api("/workflows?limit=250", key);
  const existing = (list.data || []).find((workflow) => workflow.name === desired.name);
  if (!existing) return api("/workflows", key, { method: "POST", body: JSON.stringify(workflowPayload(desired)) });
  const live = await api(`/workflows/${existing.id}`, key);
  desired.id = live.id;
  await api(`/workflows/${existing.id}`, key, { method: "PUT", body: JSON.stringify(workflowPayload(desired)) });
  return api(`/workflows/${existing.id}`, key);
}

async function main() {
  const key = readEnv().N8N_API_KEY;
  if (!key) throw new Error("N8N_API_KEY is missing");
  const delivery = await api(`/workflows/${DELIVERY_ID}`, key);
  const credential = delivery.nodes.map((entry) => entry.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential) throw new Error("Delivery workflow Google credential is missing");
  const before = { versionId: delivery.versionId, activeVersionId: delivery.activeVersionId, active: delivery.active, nodeCount: delivery.nodes.length };

  let logger = await upsertByName(key, buildLogger(credential, DELIVERY_ID));
  let retry = await upsertByName(key, buildRetry(logger.id));
  logger = await upsertByName(key, buildLogger(credential, `${DELIVERY_ID},${retry.id}`));
  if (!logger.active) await api(`/workflows/${logger.id}/activate`, key, { method: "POST" });
  logger = await api(`/workflows/${logger.id}`, key);
  retry = await upsertByName(key, buildRetry(logger.id));
  if (!retry.active) await api(`/workflows/${retry.id}/activate`, key, { method: "POST" });
  retry = await api(`/workflows/${retry.id}`, key);

  const newNodeNames = ["Prepare Assignment Start Log", "Log Assignment Start (Nonblocking)", "Prepare Assignment Final Log", "Log Assignment Final (Nonblocking)"];
  delivery.nodes = delivery.nodes.filter((entry) => !newNodeNames.includes(entry.name));
  for (const [sourceName, branches] of Object.entries(delivery.connections)) {
    for (const branch of branches.main || []) {
      if (Array.isArray(branch)) {
        const filtered = branch.filter((edge) => !newNodeNames.includes(edge.node));
        branch.splice(0, branch.length, ...filtered);
      }
    }
    if (newNodeNames.includes(sourceName)) delete delivery.connections[sourceName];
  }

  const prepareStart = code("Prepare Assignment Start Log", [1480, -560], startLogCode());
  const callStart = executeWorkflow("Log Assignment Start (Nonblocking)", [1700, -560], logger.id, false);
  const prepareFinal = code("Prepare Assignment Final Log", [3980, 260], finalLogCode());
  const callFinal = executeWorkflow("Log Assignment Final (Nonblocking)", [4200, 260], logger.id, false);
  delivery.nodes.push(prepareStart, callStart, prepareFinal, callFinal);
  const startFanout = delivery.connections["Prepare Resumable Delivery Items"]?.main?.[0];
  const finalFanout = delivery.connections["Prepare Durable Queue Status"]?.main?.[0];
  if (!Array.isArray(startFanout) || !Array.isArray(finalFanout)) throw new Error("Delivery integration points are missing");
  startFanout.push({ node: prepareStart.name, type: "main", index: 0 });
  finalFanout.push({ node: prepareFinal.name, type: "main", index: 0 });
  delivery.connections[prepareStart.name] = connect(callStart.name);
  delivery.connections[callStart.name] = { main: [[]] };
  delivery.connections[prepareFinal.name] = connect(callFinal.name);
  delivery.connections[callFinal.name] = { main: [[]] };

  await api(`/workflows/${DELIVERY_ID}`, key, { method: "PUT", body: JSON.stringify(workflowPayload(delivery)) });
  if (before.active) await api(`/workflows/${DELIVERY_ID}/activate`, key, { method: "POST" });

  const afterDelivery = await api(`/workflows/${DELIVERY_ID}`, key);
  const afterLogger = await api(`/workflows/${logger.id}`, key);
  const afterRetry = await api(`/workflows/${retry.id}`, key);
  const sendNode = afterDelivery.nodes.find((entry) => entry.name === "Send WhatsApp Video");
  if (!newNodeNames.every((name) => afterDelivery.nodes.some((entry) => entry.name === name))) throw new Error("Delivery logger integration verification failed");
  if (!afterLogger.active || !afterRetry.active || Boolean(afterDelivery.active) !== Boolean(before.active)) throw new Error("Workflow activation verification failed");
  process.stdout.write(`${JSON.stringify({
    spreadsheet_id: SPREADSHEET_ID,
    delivery: { id: afterDelivery.id, active: afterDelivery.active, before, after: { versionId: afterDelivery.versionId, activeVersionId: afterDelivery.activeVersionId, nodeCount: afterDelivery.nodes.length }, send_node_unchanged: Boolean(sendNode) },
    logger: { id: afterLogger.id, name: afterLogger.name, active: afterLogger.active, nodes: afterLogger.nodes.length, caller_ids: afterLogger.settings?.callerIds },
    retry: { id: afterRetry.id, name: afterRetry.name, active: afterRetry.active, nodes: afterRetry.nodes.length }
  }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
