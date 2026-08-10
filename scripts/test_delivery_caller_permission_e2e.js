"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const DELIVERY_ID = "AffWaDelivery2026";
const OLD_SHEET = "1eyA1XRNZU0usuii801IrJCJHp8oCh2XjlfROrzzvpwE";
const NEW_SHEET = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
const EVIDENCE = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "caller-permission-e2e.json");
const ALLOWED_SETTINGS = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];

function envFile() {
  return Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => {
    const i = line.indexOf("=");
    return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1)] : ["", ""];
  }).filter(([key]) => key));
}
async function api(route, key, options = {}) {
  const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 800)}`);
  return body ? JSON.parse(body) : {};
}
function workflowPayload(workflow, settings = workflow.settings) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: Object.fromEntries(ALLOWED_SETTINGS.filter((name) => Object.hasOwn(settings || {}, name)).map((name) => [name, settings[name]])),
  };
}
function id() { return crypto.randomUUID(); }
function edge(node) { return { main: [[{ node, type: "main", index: 0 }]] }; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function createActive(key, name, nodes, connections) {
  const workflow = await api("/workflows", key, { method: "POST", body: JSON.stringify({ name, nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  await api(`/workflows/${workflow.id}/activate`, key, { method: "POST" });
  return workflow;
}
async function removeWorkflow(key, workflowId) {
  try { await api(`/workflows/${workflowId}/deactivate`, key, { method: "POST" }); } catch {}
  try { await api(`/workflows/${workflowId}`, key, { method: "DELETE" }); } catch {}
}
async function invoke(route, body = {}, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    return { status: response.status, body: await response.text() };
  } finally { clearTimeout(timer); }
}
async function executions(key, workflowId) {
  try { return await api(`/executions?workflowId=${encodeURIComponent(workflowId)}&limit=20&includeData=true`, key); }
  catch (error) { return { query_error: error.message }; }
}

function executeWorkflowNode(name) {
  return {
    id: id(), name, type: "n8n-nodes-base.executeWorkflow", typeVersion: 1.3, position: [0, 0],
    parameters: { source: "database", workflowId: { __rl: true, value: DELIVERY_ID, mode: "list", cachedResultName: DELIVERY_ID }, mode: "once", options: { waitForSubWorkflow: true } },
  };
}

async function main() {
  const env = envFile();
  if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY missing");
  const key = env.N8N_API_KEY;
  const delivery = await api(`/workflows/${DELIVERY_ID}`, key);
  if (!delivery.active) throw new Error("AffWaDelivery2026 is inactive");
  const credential = delivery.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential) throw new Error("Production Google Sheets credential missing");
  const originalSettings = { ...(delivery.settings || {}) };
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const test = {
    username: `codex_permission_e2e_${suffix}`,
    whatsapp_number: "6200000000000",
    conversation_id: `codex_permission_e2e_${suffix}`,
    assignment_timestamp: new Date().toISOString(),
  };
  const evidence = { started_at: new Date().toISOString(), test, denied: {}, allowed: {}, sheet_evidence: {}, cleanup: {}, media_request_made: false };
  const tempIds = [];

  // First prove that a non-allowlisted caller fails and that wait=true exposes the denial in its parent.
  const deniedRoute = `delivery-denied-${id()}`;
  const deniedTrigger = { id: id(), name: "Denied Test Request", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-440, 0], webhookId: id(), parameters: { httpMethod: "POST", path: deniedRoute, responseMode: "lastNode", options: {} } };
  const deniedBuild = { id: id(), name: "Build Denied Test Input", type: "n8n-nodes-base.code", typeVersion: 2, position: [-220, 0], parameters: { jsCode: `return [{json:${JSON.stringify(test)}}];` } };
  const deniedCall = executeWorkflowNode("Call Delivery without Authorization"); deniedCall.position = [0, 0];
  const deniedWorkflow = await createActive(key, "Temporary Delivery Caller Denial Visibility Test", [deniedTrigger, deniedBuild, deniedCall], { [deniedTrigger.name]: edge(deniedBuild.name), [deniedBuild.name]: edge(deniedCall.name) });
  tempIds.push(deniedWorkflow.id);
  const deniedResponse = await invoke(deniedRoute, {});
  evidence.denied = { workflow_id: deniedWorkflow.id, http_status: deniedResponse.status, response: deniedResponse.body.slice(0, 1500) };
  await sleep(1000);
  evidence.denied.executions = await executions(key, deniedWorkflow.id);
  await removeWorkflow(key, deniedWorkflow.id);
  tempIds.splice(tempIds.indexOf(deniedWorkflow.id), 1);
  if (deniedResponse.status < 400) throw new Error("Non-allowlisted caller unexpectedly succeeded");

  // Add one temporary expired-window lead through the same production Google credential.
  const setupRoute = `delivery-e2e-setup-${id()}`;
  const setupTrigger = { id: id(), name: "Setup Test Lead", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-660, 0], webhookId: id(), parameters: { httpMethod: "POST", path: setupRoute, responseMode: "lastNode", options: {} } };
  const readOld = { id: id(), name: "Read Production Assignment Tables", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-440, 0], credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${OLD_SHEET}/values:batchGet?${["WhatsApp Leads!A:AE", "Affiliate Assignments!A:M", "Delivery Log!A:R", "WhatsApp Message Log!A:X"].map((r) => `ranges=${encodeURIComponent(r)}`).join("&")}`, options: { timeout: 45000 } } };
  const prepareLeadCode = `const TEST=${JSON.stringify(test)};const ranges=$json.valueRanges||[];if(ranges.length!==4)throw new Error("test_preflight_ranges_missing");const text=v=>v==null?"":String(v).trim(),digits=v=>text(v).replace(/\\D/g,"");const leadValues=ranges[0]?.values||[],headers=(leadValues[0]||[]).map(text);const expected=${JSON.stringify(["username","whatsapp_number","conversation_id","captured_at","reply_1","reply_2","reply_3","state","opt_in_message_id","opt_in_sent_at","opted_in_at","declined_at","batch_number","batch_reserved_at","delivery_started_at","files_expected","files_sent","files_delivered","files_failed","files_sent_at","files_delivered_at","posted_confirmed_at","last_whatsapp_message_id","last_inbound_at","last_intent","last_intent_confidence","last_error","updated_at","wa_id","last_inbound_message_id","window_expires_at"])};if(expected.some((h,i)=>headers[i]!==h))throw new Error("lead_header_mismatch");const rows=leadValues.slice(1);if(rows.some(r=>text(r[2])===TEST.conversation_id||text(r[0])===TEST.username||digits(r[28]||r[1])===digits(TEST.whatsapp_number)))throw new Error("test_identity_collision");const now=TEST.assignment_timestamp,record={username:TEST.username,whatsapp_number:TEST.whatsapp_number,conversation_id:TEST.conversation_id,captured_at:now,state:"opted_in",opted_in_at:now,files_expected:"15",files_sent:"0",files_delivered:"0",files_failed:"0",last_inbound_at:"2026-08-01T00:00:00.000Z",last_intent:"confirmation",last_intent_confidence:"1",updated_at:now,wa_id:TEST.whatsapp_number,last_inbound_message_id:"codex_safe_mock_no_send",window_expires_at:"2026-08-01T00:01:00.000Z"};return[{json:{test:TEST,row:[expected.map(h=>text(record[h]))]}}];`;
  const prepareLead = { id: id(), name: "Validate and Build Expired Window Lead", type: "n8n-nodes-base.code", typeVersion: 2, position: [-220, 0], parameters: { jsCode: prepareLeadCode } };
  const appendLead = { id: id(), name: "Append Temporary Test Lead", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [0, 0], credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${OLD_SHEET}/values/%27WhatsApp%20Leads%27!A%3AAE:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify($('Validate and Build Expired Window Lead').first().json.row ? {majorDimension:'ROWS',values:$('Validate and Build Expired Window Lead').first().json.row} : {}) }}", options: { timeout: 45000 } } };
  const setupResult = { id: id(), name: "Return Test Lead Setup", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 0], parameters: { jsCode: `const t=$("Validate and Build Expired Window Lead").first().json.test;return[{json:{...t,updated_range:$json?.updates?.updatedRange||"",updated_rows:$json?.updates?.updatedRows||0}}];` } };
  const setup = await createActive(key, "Temporary Delivery Permission E2E Lead Setup", [setupTrigger, readOld, prepareLead, appendLead, setupResult], { [setupTrigger.name]: edge(readOld.name), [readOld.name]: edge(prepareLead.name), [prepareLead.name]: edge(appendLead.name), [appendLead.name]: edge(setupResult.name) });
  tempIds.push(setup.id);
  const setupResponse = await invoke(setupRoute, {});
  if (setupResponse.status >= 400) throw new Error(`Test lead setup failed ${setupResponse.status}: ${setupResponse.body.slice(0, 800)}`);
  evidence.setup = { workflow_id: setup.id, result: JSON.parse(setupResponse.body) };
  await removeWorkflow(key, setup.id); tempIds.splice(tempIds.indexOf(setup.id), 1);

  // Call the actual production delivery workflow from an explicitly allowlisted caller.
  const allowedRoute = `delivery-allowed-${id()}`;
  const allowedTrigger = { id: id(), name: "Allowed Test Assignment", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-440, 0], webhookId: id(), parameters: { httpMethod: "POST", path: allowedRoute, responseMode: "lastNode", options: {} } };
  const allowedBuild = { id: id(), name: "Build Allowed Test Input", type: "n8n-nodes-base.code", typeVersion: 2, position: [-220, 0], parameters: { jsCode: `return[{json:${JSON.stringify(test)}}];` } };
  const allowedCall = executeWorkflowNode("Call Production Delivery with Authorization");
  const allowedResult = { id: id(), name: "Return Allowed Delivery Result", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 0], parameters: { jsCode: `return[{json:{controller_completed:true,delivery_output:$json}}];` } };
  const allowedWorkflow = await createActive(key, "Temporary Authorized Delivery Permission E2E", [allowedTrigger, allowedBuild, allowedCall, allowedResult], { [allowedTrigger.name]: edge(allowedBuild.name), [allowedBuild.name]: edge(allowedCall.name), [allowedCall.name]: edge(allowedResult.name) });
  tempIds.push(allowedWorkflow.id);
  const temporarySettings = { ...originalSettings, callerPolicy: "workflowsFromAList", callerIds: [originalSettings.callerIds, allowedWorkflow.id].filter(Boolean).join(","), saveDataSuccessExecution: "all", saveDataErrorExecution: "all" };
  await api(`/workflows/${DELIVERY_ID}`, key, { method: "PUT", body: JSON.stringify(workflowPayload(delivery, temporarySettings)) });
  await api(`/workflows/${DELIVERY_ID}/activate`, key, { method: "POST" });
  let allowedResponse;
  try {
    allowedResponse = await invoke(allowedRoute, test, 600000);
    evidence.allowed = { workflow_id: allowedWorkflow.id, http_status: allowedResponse.status, response: allowedResponse.body.slice(0, 5000) };
    await sleep(8000);
    evidence.allowed.executions = await executions(key, allowedWorkflow.id);
    evidence.delivery_executions = await executions(key, DELIVERY_ID);
  } finally {
    const current = await api(`/workflows/${DELIVERY_ID}`, key);
    await api(`/workflows/${DELIVERY_ID}`, key, { method: "PUT", body: JSON.stringify(workflowPayload(current, originalSettings)) });
    await api(`/workflows/${DELIVERY_ID}/activate`, key, { method: "POST" });
  }
  await removeWorkflow(key, allowedWorkflow.id); tempIds.splice(tempIds.indexOf(allowedWorkflow.id), 1);
  if (!allowedResponse || allowedResponse.status >= 400) throw new Error(`Authorized delivery failed ${allowedResponse?.status}: ${allowedResponse?.body?.slice(0, 1000)}`);

  // Read exact test records from both spreadsheets before cleanup.
  const inspectRoute = `delivery-e2e-inspect-${id()}`;
  const inspectTrigger = { id: id(), name: "Inspect Test Records", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-660, 0], webhookId: id(), parameters: { httpMethod: "POST", path: inspectRoute, responseMode: "lastNode", options: {} } };
  const inspectOld = { ...readOld, id: id(), name: "Read Test Records from Production Tables", position: [-440, 0] };
  const inspectNew = { id: id(), name: "Read New Assignment Log", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-220, 0], credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${NEW_SHEET}/values/%27Delivery%20Log%27!A%3AG`, options: { timeout: 45000 } } };
  const inspectCode = `const TEST=${JSON.stringify(test)},text=v=>v==null?"":String(v).trim(),table=(values)=>{const h=(values?.[0]||[]).map(text);return(values||[]).slice(1).map((r,i)=>({row_number:i+2,...Object.fromEntries(h.map((n,c)=>[n,text(r[c])]))})).filter(r=>Object.values(r).some(text));};const old=$("Read Test Records from Production Tables").first().json.valueRanges||[],leads=table(old[0]?.values),assignments=table(old[1]?.values),details=table(old[2]?.values),messages=table(old[3]?.values),newRows=table($json.values);const lead=leads.filter(r=>r.conversation_id===TEST.conversation_id),batch=lead[0]?.batch_number||"";return[{json:{test:TEST,batch_number:batch,lead_rows:lead,assignment_rows:assignments.filter(r=>r.conversation_id===TEST.conversation_id||r.username===TEST.username),delivery_rows:details.filter(r=>r.conversation_id===TEST.conversation_id||(batch&&r.batch_number===batch&&r.whatsapp_number===TEST.whatsapp_number)),message_rows:messages.filter(r=>r.conversation_id===TEST.conversation_id||r.recipient_number===TEST.whatsapp_number),new_log_rows:newRows.filter(r=>r.Username===TEST.username&&r["WhatsApp Number"]===TEST.whatsapp_number)}}];`;
  const inspectResult = { id: id(), name: "Return Exact Test Records", type: "n8n-nodes-base.code", typeVersion: 2, position: [0, 0], parameters: { jsCode: inspectCode } };
  const inspector = await createActive(key, "Temporary Delivery Permission E2E Inspection", [inspectTrigger, inspectOld, inspectNew, inspectResult], { [inspectTrigger.name]: edge(inspectOld.name), [inspectOld.name]: edge(inspectNew.name), [inspectNew.name]: edge(inspectResult.name) });
  tempIds.push(inspector.id);
  const inspectedResponse = await invoke(inspectRoute, {});
  if (inspectedResponse.status >= 400) throw new Error(`Inspection failed ${inspectedResponse.status}: ${inspectedResponse.body.slice(0, 1000)}`);
  evidence.sheet_evidence = JSON.parse(inspectedResponse.body);
  await removeWorkflow(key, inspector.id); tempIds.splice(tempIds.indexOf(inspector.id), 1);

  const s = evidence.sheet_evidence;
  if (s.lead_rows.length !== 1) throw new Error(`Expected one test lead, found ${s.lead_rows.length}`);
  if (!/^\d+$/.test(s.batch_number)) throw new Error(`Expected numeric original folder, got ${s.batch_number}`);
  if (s.delivery_rows.length !== 15) throw new Error(`Expected 15 pre-send delivery rows, found ${s.delivery_rows.length}`);
  if (s.message_rows.length !== 0) throw new Error(`Safety violation: ${s.message_rows.length} WhatsApp message log rows found`);
  if (s.new_log_rows.length !== 1) throw new Error(`Expected one idempotent assignment log row, found ${s.new_log_rows.length}`);
  if (s.new_log_rows[0].Status !== "Failed" || s.new_log_rows[0]["Clips Sent"] !== "0/15") throw new Error(`Unexpected final assignment status ${s.new_log_rows[0].Status} ${s.new_log_rows[0]["Clips Sent"]}`);
  evidence.media_request_made = false;

  // Clear only the exact controlled rows. Blank rows are harmless and preserve all historical data.
  const oldRanges = [
    ...s.lead_rows.map((r) => `'WhatsApp Leads'!A${r.row_number}:AE${r.row_number}`),
    ...s.assignment_rows.map((r) => `'Affiliate Assignments'!A${r.row_number}:M${r.row_number}`),
    ...s.delivery_rows.map((r) => `'Delivery Log'!A${r.row_number}:R${r.row_number}`),
  ];
  const newRanges = s.new_log_rows.map((r) => `'Delivery Log'!A${r.row_number}:G${r.row_number}`);
  const cleanupRoute = `delivery-e2e-cleanup-${id()}`;
  const cleanupTrigger = { id: id(), name: "Cleanup Controlled Test Rows", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-440, 0], webhookId: id(), parameters: { httpMethod: "POST", path: cleanupRoute, responseMode: "lastNode", options: {} } };
  const clearOld = { id: id(), name: "Clear Controlled Production Rows", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-220, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${OLD_SHEET}/values:batchClear`, sendBody: true, specifyBody: "json", jsonBody: `=${JSON.stringify({ ranges: oldRanges })}`, options: { timeout: 45000 } } };
  const clearNew = { id: id(), name: "Clear Controlled Assignment Log Row", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [0, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${NEW_SHEET}/values:batchClear`, sendBody: true, specifyBody: "json", jsonBody: `=${JSON.stringify({ ranges: newRanges })}`, options: { timeout: 45000 } } };
  const cleanupResult = { id: id(), name: "Return Cleanup Result", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 0], parameters: { jsCode: `return[{json:{old_ranges:${JSON.stringify(oldRanges)},new_ranges:${JSON.stringify(newRanges)},cleared:true}}];` } };
  const cleaner = await createActive(key, "Temporary Delivery Permission E2E Cleanup", [cleanupTrigger, clearOld, clearNew, cleanupResult], { [cleanupTrigger.name]: edge(clearOld.name), [clearOld.name]: edge(clearNew.name), [clearNew.name]: edge(cleanupResult.name) });
  tempIds.push(cleaner.id);
  const cleanupResponse = await invoke(cleanupRoute, {});
  if (cleanupResponse.status >= 400) throw new Error(`Cleanup failed ${cleanupResponse.status}: ${cleanupResponse.body.slice(0, 1000)}`);
  evidence.cleanup = JSON.parse(cleanupResponse.body);
  await removeWorkflow(key, cleaner.id); tempIds.splice(tempIds.indexOf(cleaner.id), 1);
  evidence.finished_at = new Date().toISOString();
  fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ evidence_file: EVIDENCE, denied_http_status: evidence.denied.http_status, allowed_http_status: evidence.allowed.http_status, batch_number: s.batch_number, delivery_rows: s.delivery_rows.length, message_rows: s.message_rows.length, assignment_log: s.new_log_rows[0], cleanup: evidence.cleanup }, null, 2) + "\n");
}

main().catch(async (error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
