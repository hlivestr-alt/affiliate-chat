"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const SPREADSHEET_ID = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
const LOGGER_NAME = "PROYA WhatsApp Delivery Log Writer";
const EXPECTED_HEADERS = ["Numbered Folder", "Username", "WhatsApp Number", "Sent At", "Clips Sent", "Status", "Error"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
const key = env.N8N_API_KEY;
const id = () => crypto.randomUUID();
const connect = (name) => ({ main: [[{ node: name, type: "main", index: 0 }]] });
const allowed = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];

async function api(route, options = {}) {
  const response = await fetch(`${API}${route}`, { ...options, headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

function payload(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(allowed.filter((name) => Object.hasOwn(workflow.settings || {}, name)).map((name) => [name, workflow.settings[name]])) };
}

async function temporaryWorkflow(name, nodes, connections) {
  return api("/workflows", { method: "POST", body: JSON.stringify({ name, nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
}

async function main() {
  const list = await api("/workflows?limit=250");
  const loggerSummary = (list.data || []).find((workflow) => workflow.name === LOGGER_NAME);
  if (!loggerSummary) throw new Error("Logger workflow missing");
  let logger = await api(`/workflows/${loggerSummary.id}`);
  const credential = logger.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential) throw new Error("Logger Google credential missing");

  const clearRoute = `proya-clear-controlled-tests-${crypto.randomUUID()}`;
  const clearTrigger = { id: id(), name: "Clear Test Trigger", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-500, 0], webhookId: id(), parameters: { httpMethod: "POST", path: clearRoute, responseMode: "lastNode", options: {} } };
  const read = { id: id(), name: "Read Delivery Log Before Cleanup", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-280, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/%27Delivery%20Log%27!A%3AG`, options: {} } };
  const validate = { id: id(), name: "Validate Only Controlled Rows Exist", type: "n8n-nodes-base.code", typeVersion: 2, position: [-60, 0], parameters: { jsCode: `const v=$json.values||[],expected=${JSON.stringify(EXPECTED_HEADERS)};if(JSON.stringify(v[0]||[])!==JSON.stringify(expected))throw new Error("delivery_log_header_mismatch_before_cleanup");const rows=v.slice(1).filter(r=>r.some(x=>String(x??"").trim()));if(rows.some(r=>String(r[1]||"")!=="codex_logger_test"))throw new Error("cleanup_refused_non_test_row_present");return[{json:{controlled_rows:rows.length}}];` } };
  const clear = { id: id(), name: "Clear Controlled Test Rows", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [160, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", method: "POST", url: `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/%27Delivery%20Log%27!A2%3AG1000:clear`, sendBody: true, specifyBody: "json", jsonBody: "={{ JSON.stringify({}) }}", options: {} } };
  const clearDone = { id: id(), name: "Return Cleanup Result", type: "n8n-nodes-base.code", typeVersion: 2, position: [380, 0], parameters: { jsCode: `return[{json:{cleared_controlled_rows:$("Validate Only Controlled Rows Exist").first().json.controlled_rows,google_response:$json}}];` } };
  const cleanup = await temporaryWorkflow("Temporary - Clean PROYA Logger Test Rows", [clearTrigger, read, validate, clear, clearDone], { [clearTrigger.name]: connect(read.name), [read.name]: connect(validate.name), [validate.name]: connect(clear.name), [clear.name]: connect(clearDone.name) });
  try {
    await api(`/workflows/${cleanup.id}/activate`, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${clearRoute}`, { method: "POST" });
    const body = await response.text();
    if (!response.ok) throw new Error(`cleanup ${response.status}: ${body.slice(0, 400)}`);
  } finally {
    try { await api(`/workflows/${cleanup.id}/deactivate`, { method: "POST" }); } catch {}
    await api(`/workflows/${cleanup.id}`, { method: "DELETE" });
  }

  const verifyRoute = `proya-final-verification-row-${crypto.randomUUID()}`;
  const verifyTrigger = { id: id(), name: "Verification Row Trigger", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-300, 0], webhookId: id(), parameters: { httpMethod: "POST", path: verifyRoute, responseMode: "lastNode", options: {} } };
  const guard = { id: id(), name: "Prepare Skipped Verification Row", type: "n8n-nodes-base.code", typeVersion: 2, position: [-80, 0], parameters: { jsCode: `return[{json:{assignment_key:"test:final-verification",numbered_folder:"999999",username:"codex_logger_test",whatsapp_number:"6200000000000",assignment_timestamp:new Date().toISOString(),clips_sent_count:0,expected_clips:15,status:"Skipped",error:"Controlled logger verification; no WhatsApp media request was sent",phase:"verification"}}];` } };
  const call = { id: id(), name: "Call Assignment Logger Only", type: "n8n-nodes-base.executeWorkflow", typeVersion: 1.3, position: [140, 0], parameters: { source: "database", workflowId: { __rl: true, value: logger.id, mode: "list", cachedResultName: LOGGER_NAME }, mode: "once", options: { waitForSubWorkflow: true } } };
  const caller = await temporaryWorkflow("Temporary - Add PROYA Logger Verification Row", [verifyTrigger, guard, call], { [verifyTrigger.name]: connect(guard.name), [guard.name]: connect(call.name) });
  const originalCallerIds = logger.settings?.callerIds || "";
  try {
    logger.settings.callerIds = [...new Set(originalCallerIds.split(",").filter(Boolean).concat(caller.id))].join(",");
    await api(`/workflows/${logger.id}`, { method: "PUT", body: JSON.stringify(payload(logger)) });
    await api(`/workflows/${logger.id}/activate`, { method: "POST" });
    await api(`/workflows/${caller.id}/activate`, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${verifyRoute}`, { method: "POST" });
    const body = await response.text();
    if (!response.ok) throw new Error(`verification row ${response.status}: ${body.slice(0, 400)}`);
  } finally {
    try { await api(`/workflows/${caller.id}/deactivate`, { method: "POST" }); } catch {}
    await api(`/workflows/${caller.id}`, { method: "DELETE" });
    logger = await api(`/workflows/${logger.id}`);
    logger.settings.callerIds = originalCallerIds;
    await api(`/workflows/${logger.id}`, { method: "PUT", body: JSON.stringify(payload(logger)) });
    await api(`/workflows/${logger.id}/activate`, { method: "POST" });
  }

  const auditRoute = `proya-final-sheet-audit-${crypto.randomUUID()}`;
  const auditTrigger = { id: id(), name: "Final Sheet Audit Trigger", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-500, 0], webhookId: id(), parameters: { httpMethod: "GET", path: auditRoute, responseMode: "lastNode", options: {} } };
  const metadata = { id: id(), name: "Read Final Spreadsheet Metadata", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-280, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=spreadsheetId,properties(title,timeZone),sheets(properties(sheetId,title,hidden,gridProperties(frozenRowCount,columnCount)),basicFilter)`, options: {} } };
  const values = { id: id(), name: "Read Final Delivery Log Values", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-60, 0], credentials: { googleSheetsOAuth2Api: credential }, parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/%27Delivery%20Log%27!A%3AG`, options: {} } };
  const result = { id: id(), name: "Return Final Sheet Verification", type: "n8n-nodes-base.code", typeVersion: 2, position: [160, 0], parameters: { jsCode: `const m=$("Read Final Spreadsheet Metadata").first().json,v=$json.values||[],headers=${JSON.stringify(EXPECTED_HEADERS)},sheets=m.sheets||[],row=v[1]||[];const checks={title:m.properties?.title==="PROYA WhatsApp Clip Delivery Log",timezone:m.properties?.timeZone==="Asia/Jakarta",one_visible_sheet:sheets.length===1&&sheets[0]?.properties?.title==="Delivery Log"&&sheets[0]?.properties?.hidden!==true,header:JSON.stringify(v[0]||[])===JSON.stringify(headers),frozen_header:sheets[0]?.properties?.gridProperties?.frozenRowCount===1,filter:Boolean(sheets[0]?.basicFilter),one_verification_row:v.length===2&&row[0]==="999999"&&row[5]==="Skipped"&&String(row[6]||"").includes("no WhatsApp media request")};if(!Object.values(checks).every(Boolean))throw new Error("final_sheet_verification_failed:"+JSON.stringify(checks));return[{json:{spreadsheet_id:m.spreadsheetId,properties:m.properties,sheets,values:v,checks}}];` } };
  const audit = await temporaryWorkflow("Temporary - Final PROYA Delivery Log Audit", [auditTrigger, metadata, values, result], { [auditTrigger.name]: connect(metadata.name), [metadata.name]: connect(values.name), [values.name]: connect(result.name) });
  try {
    await api(`/workflows/${audit.id}/activate`, { method: "POST" });
    const response = await fetch(`http://localhost:5678/webhook/${auditRoute}`);
    const body = await response.text();
    if (!response.ok) throw new Error(`final audit ${response.status}: ${body.slice(0, 500)}`);
    const output = JSON.parse(body);
    fs.writeFileSync(path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "final-sheet-verification.json"), `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    try { await api(`/workflows/${audit.id}/deactivate`, { method: "POST" }); } catch {}
    await api(`/workflows/${audit.id}`, { method: "DELETE" });
  }
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
