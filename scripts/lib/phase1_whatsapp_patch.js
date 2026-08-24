"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function uuid() { return crypto.randomUUID(); }
function load(root, name) {
  return fs.readFileSync(path.join(root, "n8n", "code", name), "utf8");
}
function node(name, type, typeVersion, position, parameters = {}, extra = {}) {
  return { id: uuid(), name, type, typeVersion, position, parameters, ...extra };
}
function code(name, position, jsCode) { return node(name, "n8n-nodes-base.code", 2, position, { jsCode }); }
function noOp(name, position) { return node(name, "n8n-nodes-base.noOp", 1, position); }
function dataTable(name, position, parameters, extra = {}) {
  return node(name, "n8n-nodes-base.dataTable", 1.1, position, parameters, extra);
}
function dataTableCreate(name, position, tableName, columns) {
  return dataTable(name, position, {
    resource: "table", operation: "create", tableName,
    columns: { column: columns.map((column) => ({ name: column, type: "string" })) },
    options: { createIfNotExists: true }
  });
}
function dataTableInsert(name, position, tableName, values, schema) {
  return dataTable(name, position, {
    resource: "row", operation: "insert",
    dataTableId: { __rl: true, mode: "name", value: tableName },
    columns: {
      mappingMode: "defineBelow", value: values,
      schema: schema.map((id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true }))
    },
    options: { optimizeBulk: false }
  });
}
function dataTableRowNotExists(name, position, tableName, keyName, keyValue) {
  return dataTable(name, position, {
    resource: "row", operation: "rowNotExists",
    dataTableId: { __rl: true, mode: "name", value: tableName },
    matchType: "allConditions",
    filters: { conditions: [{ keyName, condition: "eq", keyValue }] }
  });
}
function dataTableUpdate(name, position, tableName, keyName, keyValue, values, schema) {
  return dataTable(name, position, {
    resource: "row", operation: "update",
    dataTableId: { __rl: true, mode: "name", value: tableName },
    matchType: "allConditions",
    filters: { conditions: [{ keyName, condition: "eq", keyValue }] },
    columns: {
      mappingMode: "defineBelow", value: values,
      schema: schema.map((id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: "string", canBeUsedToMatch: true }))
    }, options: {}
  });
}
function waitNode(name, position, seconds) {
  return node(name, "n8n-nodes-base.wait", 1.1, position, {
    amount: seconds, unit: "seconds", options: {}
  }, { webhookId: uuid() });
}
function ifNode(name, position, expression) {
  return node(name, "n8n-nodes-base.if", 2.3, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
      conditions: [{
        id: uuid(), leftValue: expression, rightValue: "",
        operator: { type: "boolean", operation: "true", singleValue: true }
      }], combinator: "and"
    }, options: {}
  });
}
function connect(trueNames, falseNames) {
  const branch = (names) => (names || []).map((name) => ({ node: name, type: "main", index: 0 }));
  return { main: [branch(trueNames), branch(falseNames)] };
}
function valuesUrl(config, sheet, range) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(sheet)}!${encodeURIComponent(range)}`;
}
function google(name, position, parameters, credential, extra = {}) {
  return node(name, "n8n-nodes-base.httpRequest", 4.4, position, {
    authentication: "predefinedCredentialType",
    nodeCredentialType: "googleSheetsOAuth2Api",
    ...parameters
  }, { credentials: { googleSheetsOAuth2Api: credential }, ...extra });
}
function execute(name, position, workflowId, wait = false) {
  return node(name, "n8n-nodes-base.executeWorkflow", 1.3, position, {
    source: "database",
    workflowId: { __rl: true, value: workflowId, mode: "list", cachedResultName: workflowId },
    mode: "once", options: { waitForSubWorkflow: wait }
  });
}

function patchOptIn(workflow) {
  const trigger = workflow.nodes.find((item) => item.type === "n8n-nodes-base.executeWorkflowTrigger") ||
    node("When Executed after Lead Capture", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [-300, 0], { inputSource: "passthrough" });
  trigger.name = "When Executed after Lead Capture";
  const blocked = noOp("No Send: Inbound Contact Required", [-20, 0]);
  workflow.nodes = [trigger, blocked];
  workflow.connections = { [trigger.name]: connect([blocked.name]) };
  workflow.settings.callerPolicy = "workflowsFromAList";
  workflow.settings.callerIds = "AfDriveReady2026";
}

function patchReply(workflow, context) {
  const { root, sheets, ids, config } = context;
  const old = new Map(workflow.nodes.map((item) => [item.name, item]));
  const trigger = old.get("When Executed by Webhook Router");
  const googleCredential = old.get("Read WhatsApp Leads for Event").credentials.googleSheetsOAuth2Api;
  const whatsappCredential = old.get("Send Posted Confirmation").credentials.httpHeaderAuth;

  const statusNames = [
    "Read WhatsApp Leads for Event", "Match WhatsApp Lead", "IF Lead Match Failed",
    "Prepare Lead Match Queue", "Queue Lead Match Failure", "IF Delivery Status Event",
    "Read Delivery Log for Status", "Prepare Delivery Status Update",
    "IF Delivery Status Matched", "Update Delivery Log Status",
    "Done: Unknown Status Message", "Read Delivery Log after Status",
    "Aggregate Delivery Status", "Read Leads for Delivery Aggregate",
    "Prepare Delivery Aggregate Lead Update", "Update Lead Delivery Aggregate",
    "Done: Delivery Status Updated"
  ];
  const statusNodes = statusNames.map((name) => old.get(name)).filter(Boolean);
  for (const item of statusNodes) {
    const readOnlyRequest = !item.parameters?.method || item.parameters.method === "GET";
    if (readOnlyRequest && item.name.includes("Leads") && item.parameters.url) {
      item.parameters.url = valuesUrl(config, sheets.leads, "A:AF");
    }
    if (readOnlyRequest && item.name.includes("Delivery Log") && item.parameters.url) {
      item.parameters.url = valuesUrl(config, sheets.delivery, "A:R");
    }
  }

  const isStatus = ifNode("IF Existing Status Callback", [-1120, 0], "={{ $json.event_kind === 'status' }}");
  const inboundClaimColumns = ["message_id", "phone_number", "received_at", "execution_id"];
  const ensureInboundClaims = dataTableCreate("Ensure Inbound Dedup Table", [-900, 180], "wa_inbound_dedup", inboundClaimColumns);
  const restoreInbound = code("Restore Inbound before Durable Claim", [-680, 180],
    'return [{json:$("When Executed by Webhook Router").first().json}];');
  const validInbound = ifNode("IF Valid Inbound Message ID", [-460, 180],
    "={{ Boolean(String($json.whatsapp_message_id || '').trim()) }}");
  const inboundNotSeen = dataTableRowNotExists("IF Inbound Not Durably Claimed", [-240, 180],
    "wa_inbound_dedup", "message_id", "={{ String($json.whatsapp_message_id || '').trim() }}");
  const storeInboundClaim = dataTableInsert("Store Durable Inbound Claim", [-20, 180], "wa_inbound_dedup", {
    message_id: "={{ String($json.whatsapp_message_id || '').trim() }}",
    phone_number: "={{ String($json.wa_id || $json.whatsapp_number || '').replace(/\\D/g, '') }}",
    received_at: "={{ String($json.n8n_execution_time || $now.toISO()) }}",
    execution_id: "={{ String($execution.id || '') }}"
  }, inboundClaimColumns);
  const restoreDurableClaim = code("Restore Inbound after Durable Claim", [200, 180],
    'return [{json:$("Restore Inbound before Durable Claim").first().json}];');
  const duplicateStop = noOp("Done: Duplicate Inbound Ignored", [-20, 340]);
  const readLeads = google("Read Leads for Inbound Resolution", [860, 20], {
    url: valuesUrl(config, sheets.leads, "A:AF"), options: {}
  }, googleCredential);
  const resolve = code("Resolve Inbound Affiliate and Intent", [200, 80], load(root, "phase1-resolve-lead.js"));
  const conflict = ifNode("IF Affiliate Match Conflict", [420, 80], "={{ $json.route === 'queue' }}");
  const queue = execute("Queue Affiliate Match Conflict", [640, -40], ids.queue, false);
  const appendLeadGate = ifNode("IF Append New WhatsApp Lead", [640, 140], "={{ $json.lead_write_action === 'append' }}");
  const appendLead = google("Append New WhatsApp Lead", [860, 80], {
    method: "POST",
    url: `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(sheets.leads)}!A%3AAF:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    sendBody: true, specifyBody: "json",
    jsonBody: '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.lead_row_values] }) }}', options: {}
  }, googleCredential);
  const updateLead = google("Refresh Existing WhatsApp Lead Window", [860, 200], {
    method: "PUT",
    url: `=https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(sheets.leads)}!A{{$json.row_number}}%3AAF{{$json.row_number}}?valueInputOption=RAW`,
    sendBody: true, specifyBody: "json",
    jsonBody: '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.lead_row_values] }) }}', options: {}
  }, googleCredential);
  const restore = code("Restore Inbound after Lead Write", [1080, 140],
    'return [{ json: $("Resolve Inbound Affiliate and Intent").first().json }];');
  const needsReply = ifNode("IF Guarded Text Reply Required", [1300, 140],
    "={{ ['clarification','confirmation'].includes($json.action) }}");
  const readGuard = google("Read Leads Immediately Before Text Send", [1520, 40], {
    url: valuesUrl(config, sheets.leads, "A:AF"), options: {}
  }, googleCredential);
  const guard = code("Guard Phase 1 Text Send", [1740, 40], load(root, "phase1-send-guard.js"));
  const allowed = ifNode("IF Text Send Authorized", [1960, 40], "={{ $json.outbound_allowed === true }}");
  const send = node("Send Non-template WhatsApp Text", "n8n-nodes-base.httpRequest", 4.4, [2180, -60], {
    authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
    method: "POST",
    url: `=https://graph.facebook.com/${config.graphVersion}/{{$env.WHATSAPP_PHONE_NUMBER_ID}}/messages`,
    sendBody: true, specifyBody: "json",
    jsonBody: '={{ JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: String($json.wa_id || $json.whatsapp_number).replace(/\\D/g, ""), type: "text", text: { preview_url: false, body: $json.outbound_body } }) }}',
    options: { response: { response: { neverError: true } } }
  }, { credentials: { httpHeaderAuth: whatsappCredential }, continueOnFail: true });
  const parse = code("Parse Non-template Text Send", [2400, -60], load(root, "phase1-parse-text-send.js"));
  const sendOk = ifNode("IF Text Message Accepted", [2620, -60], "={{ $json.send_succeeded === true }}");
  const register = execute("Store Text Message Wamid", [2840, -140], ids.status, true);
  const restoreRegistered = code("Restore Registered Text Result", [3060, -140],
    'return [{ json: $("Parse Non-template Text Send").first().json }];');
  const startDelivery = ifNode("IF Confirmation Starts Delivery", [3280, -140],
    "={{ $json.action === 'confirmation' }}");
  const delivery = execute("Start Sequential File Delivery", [3500, -220], ids.delivery, false);
  const doneText = noOp("Done: Clarification Accepted", [3500, -60]);
  const failedText = noOp("Done: Text Send Failed Safely", [2840, 20]);
  const prepareBlocked = code("Prepare Waiting State after Block", [2180, 160], String.raw`
function text(v){return v==null?"":String(v).trim();}
const source=$input.first().json; const values=$("Read Leads Immediately Before Text Send").first().json.values||[];
const headers=(values[0]||[]).map(text); const record={...source,state:"waiting_for_affiliate_message",last_error:source.blocked_log_code+":"+source.blocked_reason,updated_at:new Date().toISOString()};
return [{json:{...source,row_number:source.row_number,lead_row_values:headers.map((name)=>text(record[name]))}}];`);
  const updateBlocked = google("Mark Waiting after Blocked Text", [2400, 160], {
    method: "PUT",
    url: `=https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(sheets.leads)}!A{{$json.row_number}}%3AAF{{$json.row_number}}?valueInputOption=RAW`,
    sendBody: true, specifyBody: "json",
    jsonBody: '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.lead_row_values] }) }}', options: {}
  }, googleCredential);
  const blockedDone = noOp("Done: Text Blocked by Zero Charge Mode", [2620, 160]);
  const refreshedDone = noOp("Done: Window Refreshed without Distribution", [1520, 260]);

  const pausedStatus = noOp("Done: Status Sheet Logging Paused", [-900, -120]);
  workflow.nodes = [trigger, isStatus, pausedStatus, ensureInboundClaims, restoreInbound, validInbound,
    inboundNotSeen, storeInboundClaim, restoreDurableClaim, duplicateStop,
    readLeads, resolve, conflict, queue, appendLeadGate,
    appendLead, updateLead, restore, needsReply, readGuard, guard, allowed, send, parse,
    sendOk, restoreRegistered, startDelivery, delivery, doneText, failedText,
    prepareBlocked, updateBlocked, blockedDone, refreshedDone];

  workflow.connections = {
    [trigger.name]: connect([isStatus.name]),
    [isStatus.name]: connect([pausedStatus.name], [ensureInboundClaims.name]),
    [ensureInboundClaims.name]: connect([restoreInbound.name]),
    [restoreInbound.name]: connect([validInbound.name]),
    [validInbound.name]: connect([inboundNotSeen.name], [duplicateStop.name]),
    [inboundNotSeen.name]: connect([storeInboundClaim.name]),
    [storeInboundClaim.name]: connect([restoreDurableClaim.name]),
    [restoreDurableClaim.name]: connect([readLeads.name]),
    [readLeads.name]: connect([resolve.name]),
    [resolve.name]: connect([conflict.name]),
    [conflict.name]: connect([queue.name], [appendLeadGate.name]),
    [appendLeadGate.name]: connect([appendLead.name], [updateLead.name]),
    [appendLead.name]: connect([restore.name]),
    [updateLead.name]: connect([restore.name]),
    [restore.name]: connect([needsReply.name]),
    [needsReply.name]: connect([readGuard.name], [refreshedDone.name]),
    [readGuard.name]: connect([guard.name]),
    [guard.name]: connect([allowed.name]),
    [allowed.name]: connect([send.name], [prepareBlocked.name]),
    [send.name]: connect([parse.name]),
    [parse.name]: connect([restoreRegistered.name]),
    [restoreRegistered.name]: connect([sendOk.name]),
    [sendOk.name]: connect([startDelivery.name], [failedText.name]),
    [startDelivery.name]: connect([delivery.name], [doneText.name]),
    [prepareBlocked.name]: connect([updateBlocked.name]),
    [updateBlocked.name]: connect([blockedDone.name])
  };
  workflow.settings.callerPolicy = "workflowsFromAList";
  workflow.settings.callerIds = "AffWaWebhook2026,AffWaStatus2026";
}

function patchStatus(workflow, context) {
  const trigger = workflow.nodes.find((item) => item.type === "n8n-nodes-base.executeWorkflowTrigger") ||
    node("When Executed by Webhook Router", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [-300, 0], { inputSource: "passthrough" });
  trigger.name = "When Executed by Webhook Router";
  const paused = noOp("Done: Chat and Status Sheet Logging Paused", [-20, 0]);
  workflow.nodes = [trigger, paused];
  workflow.connections = { [trigger.name]: connect([paused.name]) };
  workflow.settings.callerPolicy = "any";
}

function patchDelivery(workflow, context) {
  const { root, sheets, config } = context;
  const old = new Map(workflow.nodes.map((item) => [item.name, item]));
  for (const item of workflow.nodes) {
    const sheetRequest = String(item.parameters?.url || "").includes("sheets.googleapis.com");
    const readOnlyRequest = (!item.parameters?.method || item.parameters.method === "GET") && sheetRequest;
    if (sheetRequest) {
      item.retryOnFail = true;
      item.maxTries = 8;
      item.waitBetweenTries = 10000;
    }
    if (readOnlyRequest && item.parameters?.url && item.name.includes("Leads")) {
      item.parameters.url = valuesUrl(config, sheets.leads, "A:AF");
    }
    if (readOnlyRequest && item.parameters?.url && item.name.includes("Delivery Log")) {
      item.parameters.url = valuesUrl(config, sheets.delivery, "A:R");
    }
    if (readOnlyRequest && item.parameters?.url && item.name.includes("Message Log")) {
      item.parameters.url = valuesUrl(config, sheets.messages, "A:X");
    }
    if (item.name === "Select and Prepare Batch Reservation") item.parameters.jsCode = load(root, "select-local-batch.js");
    if (item.name === "Prepare Resumable Delivery Items") item.parameters.jsCode = load(root, "prepare-delivery-items.js");
    if (item.name === "Read Assigned MP4 Files") {
      item.parameters.fileSelector = "={{ $('Restore and Validate Delivery Context').first().json.test_mode ? $('Restore and Validate Delivery Context').first().json.resolved_folder_path : $('Restore and Validate Delivery Context').first().json.resolved_folder_path + '/*.mp4' }}";
    }
    if (item.name === "List Local Batch Folders") {
      item.parameters.command = "={{ String($env.WHATSAPP_TEST_MODE).toLowerCase() === 'true' ? \"printf ''\" : \"find /clips_whatsapp -mindepth 1 -maxdepth 1 -type d -exec basename {} \\\\; | sort -n\" }}";
    }
    if (item.name === "Send WhatsApp Video") {
      item.retryOnFail = false;
      delete item.maxTries;
      delete item.waitBetweenTries;
      item.parameters.jsonBody = item.parameters.jsonBody.replace(
        'caption: "Video " + $json.file_index + "/15"',
        'caption: "Video " + $json.file_index + "/" + (String($env.WHATSAPP_TEST_MODE).toLowerCase() === "true" ? "1" : "15")'
      );
    }
    if (item.name === "Parse Video Send") {
      item.parameters.jsCode = item.parameters.jsCode.replace(
        'const source = $("Parse Media Upload").first().json;',
        'const source = $("Guard Cached Clip Send").item.json;'
      );
    }
    if (item.name === "Upload Video to WhatsApp") {
      item.retryOnFail = false;
      delete item.maxTries;
      delete item.waitBetweenTries;
    }
  }
  const remove = new Set([
    "Send WhatsApp Intro Message", "Restore Intro Result before Video",
    "Prepare Intro Message Registration", "Store Intro Message ID",
    "Restore File after Intro Registration", "IF Register Video Message",
    "Prepare Video Message Registration", "Store Video Message ID",
    "Restore Video Send Result", "Normalize Failed Delivery Log",
    "IF Update Existing Delivery Log", "Update Existing Delivery Log",
    "Append New Delivery Log", "Restore Delivery Result after Log Write",
    "Prepare Delivery Failure Queue", "Queue Delivery Failure",
    "Read Delivery Log after Send Loop", "Summarize Delivery Send",
    "Read Leads for Final Send State", "Prepare Final Send Lead Update"
  ]);
  workflow.nodes = workflow.nodes.filter((item) => !remove.has(item.name));
  for (const name of remove) delete workflow.connections[name];
  const googleCredential = old.get("Read WhatsApp Leads for Reservation").credentials.googleSheetsOAuth2Api;
  const retrySheets = { retryOnFail: true, maxTries: 8, waitBetweenTries: 10000 };
  const prepareClaims = code("Prepare Batch Send Claims", [1480, -40], load(root, "prepare-batch-send-claims.js"));
  const writeClaims = google("Batch Write Pre-Send Claims", [1580, -40], {
    method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values:batchUpdate`, sendBody: true,
    specifyBody: "json", jsonBody: '={{ JSON.stringify({ valueInputOption: "RAW", data: $json.updates }) }}', options: {}
  }, googleCredential, retrySheets);
  const waitClaims = waitNode("Wait for Batch Claim Settle", [1680, -40], 1);
  const rereadClaims = google("Read Delivery Log Once after Batch Claim", [1780, -40], {
    url: valuesUrl(config, sheets.delivery, "A:R"), options: {}
  }, googleCredential, retrySheets);
  const restoreClaims = code("Restore Batch Claimed Items", [1880, -40], load(root, "restore-batch-claimed-items.js"));
  const uploadGuard = code("Guard Cached Media Upload", [1900, 40], load(root, "guard-cached-delivery-send.js"));
  const uploadAllowed = ifNode("IF Cached Media Upload Authorized", [2000, 40], "={{ $json.outbound_allowed === true }}");
  const reuseUpload = ifNode("IF Reuse Existing Media Upload", [2100, 40], "={{ Boolean($json.existing_media_id) }}");
  const restoreUpload = code("Restore Existing Media Upload", [2200, 20], String.raw`
const source=$("Guard Cached Media Upload").item; return [{json:{...source.json,media_id:source.json.existing_media_id,uploaded_at:source.json.existing_uploaded_at,upload_success:true,reused_media_upload:true},binary:source.binary}];`);
  const sendGuard = code("Guard Cached Clip Send", [2320, 120], load(root, "guard-cached-delivery-send.js"));
  const sendAllowed = ifNode("IF Cached Clip Send Authorized", [2420, 120], "={{ $json.outbound_allowed === true }}");
  const prepareInFlight = code("Prepare In-Flight Send Claim", [2520, 100], load(root, "prepare-in-flight-send-claim.js"));
  const persistInFlight = google("Persist In-Flight Send Claim", [2620, 100], {
    method: "PUT",
    url: `=https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(sheets.delivery)}!A{{$json.delivery_log_row_number}}%3AR{{$json.delivery_log_row_number}}?valueInputOption=RAW`,
    sendBody: true, specifyBody: "json",
    jsonBody: '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.in_flight_row_values] }) }}', options: {}
  }, googleCredential, retrySheets);
  const restoreInFlight = code("Restore Clip after In-Flight Claim", [2720, 100], String.raw`
const source=$("Prepare In-Flight Send Claim").item; return [{json:source.json,binary:source.binary}];`);
  const blocked = code("Prepare Blocked Clip Result", [2640, 280], String.raw`
function text(v){return v==null?"":String(v).trim();} const source=$input.first().json; const now=new Date().toISOString();
const error=text(source.blocked_log_code)+":"+text(source.blocked_reason); const row=[source.delivery_key,source.conversation_id,source.whatsapp_number,source.batch_number,source.file_index,source.file_name,source.media_id||"","","failed",source.attempts||1,source.uploaded_at||"","","",now,error,now,"failed",""];
return [{json:{...source,send_success:false,send_state:"failed",state:"failed",last_error:error,failed_at:now,updated_at:now,delivery_row_values:row}}];`);
  const restoreFailure = code("Restore Failed Delivery Result", [4000, -100], String.raw`let source; try { source=$("Parse Video Send").item.json; } catch {} if(!source||typeof source.send_success!=="boolean") source=$("Prepare Upload Failure").item.json; return [{json:source}];`);
  const readImmediate = google("Read Delivery Row after Meta Success", [2920, -440], {
    url: `=https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(sheets.delivery)}!A{{$json.delivery_log_row_number}}%3AR{{$json.delivery_log_row_number}}`, options: {}
  }, googleCredential, retrySheets);
  const validateImmediate = code("Validate Immediate Successful Send", [3040, -440], load(root, "validate-immediate-successful-send.js"));
  const ifImmediateWrite = ifNode("IF Successful Send Persistence Required", [3160, -440], "={{ $json.immediate_persistence_required === true }}");
  const persistImmediate = google("Persist Successful Clip Immediately", [3280, -500], {
    method: "PUT",
    url: `=https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(sheets.delivery)}!A{{$json.delivery_log_row_number}}%3AR{{$json.delivery_log_row_number}}?valueInputOption=RAW`,
    sendBody: true, specifyBody: "json",
    jsonBody: '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.delivery_row_values] }) }}', options: {}
  }, googleCredential, retrySheets);
  const readImmediateBack = google("Read Back Persisted Successful Clip", [3400, -500], {
    url: `=https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(sheets.delivery)}!A{{$json.delivery_log_row_number}}%3AR{{$json.delivery_log_row_number}}`, options: {}
  }, googleCredential, retrySheets);
  const confirmImmediate = code("Confirm Successful Clip Durable", [3520, -500], load(root, "confirm-successful-clip-durable.js"));
  const restoreImmediate = code("Restore Idempotent Successful Clip", [3400, -380], String.raw`
const source=$("Validate Immediate Successful Send").item.json; return [{json:{...source,immediate_persistence_verified:true,immediate_persistence_result:"already_durable"}}];`);
  const prepareTracking = code("Prepare Batched Delivery Tracking", [1800, 40], load(root, "prepare-batched-delivery-tracking.js"));
  const writeDelivery = google("Batch Write Delivery Results", [2020, 40], {
    method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values:batchUpdate`, sendBody: true,
    specifyBody: "json", jsonBody: '={{ JSON.stringify({ valueInputOption: "RAW", data: $json.delivery_updates }) }}', options: {}
  }, googleCredential, { ...retrySheets, continueOnFail: true });
  const captureDeliveryWrite = code("Capture Delivery Batch Write Result", [2900, 40], String.raw`
const source=$("Prepare Batched Delivery Tracking").first().json; const response=$input.first().json||{};
const error=response.error?JSON.stringify(response.error):""; return [{json:{...source,delivery_write_error:error}}];`);
  const hasMessages = ifNode("IF Batched Messages Exist", [3080, 40], "={{ Number($json.message_count) > 0 }}");
  const appendMessages = google("Append Message Results Batch", [2680, -20], {
    method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(sheets.messages)}!A%3AX:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    sendBody: true, specifyBody: "json", jsonBody: '={{ JSON.stringify({ majorDimension: "ROWS", values: $json.message_rows }) }}', options: {}
  }, googleCredential, { ...retrySheets, continueOnFail: true });
  const captureMessageWrite = code("Capture Message Batch Write Result", [3440, -20], String.raw`
const source=$("Capture Delivery Batch Write Result").first().json; const response=$input.first().json||{};
const error=response.error?JSON.stringify(response.error):""; return [{json:{...source,message_write_error:error}}];`);
  const noMessages = code("Record No Message Batch Needed", [3440, 100],
    'return [{json:{...$("Capture Delivery Batch Write Result").first().json,message_write_error:""}}];');
  const prepareRecoveryStatus = code("Prepare Durable Queue Status", [3620, 40], String.raw`
const source=$input.first().json; const errors=[source.delivery_write_error,source.message_write_error].filter(Boolean);
return [{json:{...source,recovery_status:errors.length?"pending":"flushed",recovery_last_error:errors.join(" | "),recovery_updated_at:new Date().toISOString()}}];`);
  const summary = code("Prepare Cached Delivery Summary", [3980, 40], load(root, "prepare-cached-delivery-summary.js"));
  const updateFinal = old.get("Update Final Send State");
  Object.assign(updateFinal, retrySheets, { continueOnFail: true });
  workflow.nodes.push(prepareClaims, writeClaims, restoreClaims, uploadGuard, uploadAllowed, reuseUpload, restoreUpload, sendGuard, sendAllowed,
    prepareInFlight, persistInFlight, restoreInFlight, readImmediate, validateImmediate, ifImmediateWrite, persistImmediate,
    readImmediateBack, confirmImmediate, restoreImmediate, waitClaims, rereadClaims, blocked, restoreFailure, prepareTracking,
    writeDelivery, captureDeliveryWrite, hasMessages, appendMessages, captureMessageWrite,
    noMessages, prepareRecoveryStatus, summary);
  workflow.connections["Prepare Resumable Delivery Items"] = connect([prepareClaims.name]);
  workflow.connections[prepareClaims.name] = connect([writeClaims.name]);
  workflow.connections[writeClaims.name] = connect([waitClaims.name]);
  workflow.connections[waitClaims.name] = connect([rereadClaims.name]);
  workflow.connections[rereadClaims.name] = connect([restoreClaims.name]);
  workflow.connections[restoreClaims.name] = connect(["Loop Through Files"]);
  workflow.connections["IF Intro Before First Video"] = connect([uploadGuard.name], [uploadGuard.name]);
  workflow.connections[uploadGuard.name] = connect([uploadAllowed.name]);
  workflow.connections[uploadAllowed.name] = connect([reuseUpload.name], [blocked.name]);
  workflow.connections[reuseUpload.name] = connect([restoreUpload.name], ["Upload Video to WhatsApp"]);
  workflow.connections[restoreUpload.name] = connect(["IF Media Upload Succeeded"]);
  const mediaGate = workflow.connections["IF Media Upload Succeeded"];
  mediaGate.main[0] = [{ node: sendGuard.name, type: "main", index: 0 }];
  workflow.connections[sendGuard.name] = connect([sendAllowed.name]);
  workflow.connections[sendAllowed.name] = connect([prepareInFlight.name], [blocked.name]);
  workflow.connections[prepareInFlight.name] = connect([persistInFlight.name]);
  workflow.connections[persistInFlight.name] = connect([restoreInFlight.name]);
  workflow.connections[restoreInFlight.name] = connect(["Send WhatsApp Video"]);
  workflow.connections["Parse Video Send"] = connect(["IF File Send Succeeded"]);
  workflow.connections["Prepare Upload Failure"] = connect(["IF File Send Succeeded"]);
  workflow.connections["IF File Send Succeeded"] = connect([readImmediate.name], [restoreFailure.name]);
  workflow.connections[readImmediate.name] = connect([validateImmediate.name]);
  workflow.connections[validateImmediate.name] = connect([ifImmediateWrite.name]);
  workflow.connections[ifImmediateWrite.name] = connect([persistImmediate.name], [restoreImmediate.name]);
  workflow.connections[persistImmediate.name] = connect([readImmediateBack.name]);
  workflow.connections[readImmediateBack.name] = connect([confirmImmediate.name]);
  workflow.connections[confirmImmediate.name] = connect(["Wait Between Recipient Messages"]);
  workflow.connections[restoreImmediate.name] = connect(["Wait Between Recipient Messages"]);
  workflow.connections[restoreFailure.name] = connect(["Wait Between Recipient Messages"]);
  workflow.connections[blocked.name] = connect(["Wait Between Recipient Messages"]);
  workflow.connections["Loop Through Files"].main[0] = [{ node: prepareTracking.name, type: "main", index: 0 }];
  workflow.connections[prepareTracking.name] = connect([writeDelivery.name]);
  workflow.connections[writeDelivery.name] = connect([captureDeliveryWrite.name]);
  workflow.connections[captureDeliveryWrite.name] = connect([hasMessages.name]);
  workflow.connections[hasMessages.name] = connect([appendMessages.name], [noMessages.name]);
  workflow.connections[appendMessages.name] = connect([captureMessageWrite.name]);
  workflow.connections[captureMessageWrite.name] = connect([prepareRecoveryStatus.name]);
  workflow.connections[noMessages.name] = connect([prepareRecoveryStatus.name]);
  workflow.connections[prepareRecoveryStatus.name] = connect([summary.name]);
  workflow.connections[summary.name] = connect(["Update Final Send State"]);
  workflow.connections["Update Final Send State"] = connect(["Done: Delivery Send Attempt"]);
}

function patchSetup(workflow, context) {
  const { headers } = context;
  const serialized = JSON.stringify(workflow);
  if (!serialized.includes("window_expires_at")) {
    workflow.notes = "Phase 1 headers are migrated by scripts/migrate_whatsapp_phase1_headers.js; this workflow remains inactive.";
  }
}

function patchPhase1Workflow(workflow, context) {
  if (workflow.id === context.ids.optIn) patchOptIn(workflow);
  if (workflow.id === context.ids.reply) patchReply(workflow, context);
  if (workflow.id === context.ids.status) patchStatus(workflow, context);
  if (workflow.id === context.ids.delivery) patchDelivery(workflow, context);
  if (workflow.id === context.ids.setup) patchSetup(workflow, context);
}

module.exports = { patchPhase1Workflow };
