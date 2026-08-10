"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const DELIVERY_ID = "AffWaDelivery2026";
const ASSIGNMENTS = [
  { batch_number: "6901", username: "yuvikachuu", whatsapp_number: "6289508881998" },
  { batch_number: "6902", username: "uwininshp", whatsapp_number: "6289656262493" },
  { batch_number: "6903", username: "alinanuralesha", whatsapp_number: "6285782000199" },
  { batch_number: "6904", username: "fadliyyahnr", whatsapp_number: "6285710416787" },
  { batch_number: "6905", username: "mayreeaemyou", whatsapp_number: "6282329499945" },
  { batch_number: "6906", username: "sanmisan88", whatsapp_number: "6281802341011" },
  { batch_number: "6907", username: "mxylna_", whatsapp_number: "6285864300358" },
];
const ALLOWED_SETTINGS = ["saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder", "callerPolicy", "callerIds", "timeSavedPerExecution", "redactionPolicy", "availableInMCP", "customTelemetryTags"];

function readEnv() {
  const result = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) result[match[1].trim()] = match[2];
  }
  return result;
}
async function api(pathname, key, options = {}) {
  const response = await fetch(API + pathname, { ...options, headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n API ${response.status} ${pathname}: ${body.slice(0, 800)}`);
  return body ? JSON.parse(body) : {};
}
function payload(workflow, settingsOverride = workflow.settings) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: Object.fromEntries(ALLOWED_SETTINGS.filter((name) => Object.hasOwn(settingsOverride || {}, name)).map((name) => [name, settingsOverride[name]])) };
}

async function main() {
  const dryRun = process.argv.includes("--preflight-only");
  const folderArgument = process.argv.find((argument) => argument.startsWith("--folder="));
  const selectedAssignments = folderArgument
    ? ASSIGNMENTS.filter((assignment) => assignment.batch_number === folderArgument.slice("--folder=".length))
    : ASSIGNMENTS;
  if (!selectedAssignments.length) throw new Error("Requested recovery folder is not allowlisted");
  const env = readEnv();
  if (!env.N8N_API_KEY || !env.AFFILIATE_TRACKER_SPREADSHEET_ID) throw new Error("Required production configuration is missing");
  const deliveryBefore = await api(`/workflows/${DELIVERY_ID}`, env.N8N_API_KEY);
  const credential = deliveryBefore.nodes.map((node) => node.credentials?.googleSheetsOAuth2Api).find(Boolean);
  if (!credential?.id) throw new Error("Live Google Sheets credential reference is missing");
  const webhookPath = `delivery-recovery-${crypto.randomUUID()}`;
  const ranges = ["WhatsApp Leads!A:AE", "Delivery Log!A:R", "WhatsApp Message Log!A:X"];
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  const preflightCode = `
function text(value){return value==null?"":String(value).trim();} function digits(value){return text(value).replace(/\\D/g,"");} function user(value){return text(value).normalize("NFKC").replace(/^@+/,"").toLowerCase();}
function records(entry){const values=Array.isArray(entry?.values)?entry.values:[];const headers=(values[0]||[]).map(text);return values.slice(1).map((row,index)=>({row_number:index+2,...Object.fromEntries(headers.map((name,column)=>[name,text(row[column])]))}));}
const request=$("Recovery Request").first().json.body||{}; const action=text(request.action||"resume"); const allowlist=${JSON.stringify(ASSIGNMENTS)}; const expected=allowlist.find((item)=>item.batch_number===text(request.batch_number));
if(!expected||digits(request.whatsapp_number)!==expected.whatsapp_number||user(request.username)!==user(expected.username)) throw new Error("recovery_request_not_allowlisted");
const ranges=$json.valueRanges||[];const leads=records(ranges[0]);const delivery=records(ranges[1]);const messages=records(ranges[2]);
const matches=leads.filter((row)=>row.batch_number===expected.batch_number||digits(row.wa_id||row.whatsapp_number)===expected.whatsapp_number);
if(matches.length!==1) throw new Error(matches.length?"recovery_duplicate_assignment":"recovery_assignment_missing"); const lead=matches[0];
const assignmentMatches=lead.batch_number===expected.batch_number&&digits(lead.wa_id||lead.whatsapp_number)===expected.whatsapp_number&&user(lead.username)===user(expected.username)&&/^\\d+$/.test(lead.batch_number);
if(!assignmentMatches) throw new Error("recovery_assignment_owner_mismatch");
const zero=text($env.ZERO_CHARGE_MODE).toLowerCase()==="true"; const phase=text($env.WHATSAPP_PHASE1_ENABLED).toLowerCase()==="true"; const test=text($env.WHATSAPP_TEST_MODE).toLowerCase()==="true"; const armed=text($env.WHATSAPP_LIVE_TEST_ARMED).toLowerCase()==="true";
const expires=Date.parse(lead.window_expires_at); const active=Boolean(lead.last_inbound_at)&&Number.isFinite(expires)&&Date.now()<expires;
const folderRows=delivery.filter((row)=>row.batch_number===expected.batch_number&&row.conversation_id===lead.conversation_id);
const uncertain=folderRows.filter((row)=>["send_prepared","outcome_uncertain"].includes(row.send_state)||row.state==="send_prepared");
const failed=folderRows.filter((row)=>row.state==="failed"||row.send_state==="failed");
const videoMessages=messages.filter((row)=>row.direction==="outbound"&&row.message_type==="video"&&text(row.source_reference).startsWith(lead.conversation_id+":"+expected.batch_number+":"));
const uncertainMessages=videoMessages.filter((row)=>row.send_state==="outcome_uncertain"||(!row.whatsapp_message_id&&row.api_status==="accepted"));
const confirmation=messages.filter((row)=>row.recipient_number===expected.whatsapp_number&&text(row.source_reference).startsWith("confirmation:"));
const blockedReason=!zero?"zero_charge_mode_not_enabled":!phase?"phase1_not_enabled":test?"test_mode_enabled":armed?"live_test_armed":!active?"no_active_customer_service_window":action!=="status"&&(uncertain.length||uncertainMessages.length)?"uncertain_or_prepared_send_exists":"";
const allowed=!blockedReason; const sentKeys=new Set([...folderRows.filter((row)=>row.whatsapp_message_id||["accepted","sent","delivered","read"].includes(row.send_state)||["sent","delivered","read"].includes(row.delivery_state)).map((row)=>row.delivery_key),...videoMessages.filter((row)=>row.whatsapp_message_id).map((row)=>row.source_reference)]);
const remaining=Math.max(0,15-sentKeys.size); const now=new Date().toISOString(); const record={...lead,state:allowed?lead.state:"waiting_for_affiliate_message",last_error:allowed?lead.last_error:"recovery_blocked:"+blockedReason+":folder="+expected.batch_number+":remaining="+remaining,updated_at:allowed?lead.updated_at:now};
const headers=(ranges[0]?.values?.[0]||[]).map(text);
return [{json:{...lead,batch_number:expected.batch_number,username:expected.username,whatsapp_number:expected.whatsapp_number,wa_id:expected.whatsapp_number,recovery_action:action,recovery_allowed:allowed,recovery_blocked_reason:blockedReason,remaining_clip_count:remaining,confirmation_count:confirmation.length,confirmation_statuses:confirmation.map((row)=>row.current_status||row.send_state),existing_video_message_count:videoMessages.length,existing_delivery_row_count:folderRows.length,failed_clip_count:failed.length,lead_row_number:lead.row_number,lead_row_values:headers.map((name)=>record[name]||""),outbound_type:"video",template_name:"",preflight_at:now}}];`;
  const controller = await api("/workflows", env.N8N_API_KEY, {
    method: "POST",
    body: JSON.stringify({
      name: "Temporary Allowlisted Delivery Recovery",
      nodes: [
        { parameters: { httpMethod: "POST", path: webhookPath, responseMode: "lastNode", options: {} }, id: crypto.randomUUID(), name: "Recovery Request", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-500, 0], webhookId: crypto.randomUUID() },
        { parameters: { authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", url: `https://sheets.googleapis.com/v4/spreadsheets/${env.AFFILIATE_TRACKER_SPREADSHEET_ID}/values:batchGet?${query}`, options: {} }, id: crypto.randomUUID(), name: "Reread Recovery State", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [-280, 0], credentials: { googleSheetsOAuth2Api: credential }, retryOnFail: true, maxTries: 3, waitBetweenTries: 1500 },
        { parameters: { jsCode: preflightCode }, id: crypto.randomUUID(), name: "Validate Recovery Preconditions", type: "n8n-nodes-base.code", typeVersion: 2, position: [-60, 0] },
        { parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 }, conditions: [{ id: crypto.randomUUID(), leftValue: "={{ $json.recovery_action === 'status' }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {} }, id: crypto.randomUUID(), name: "IF Status Request", type: "n8n-nodes-base.if", typeVersion: 2.3, position: [80, 0] },
        { parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 }, conditions: [{ id: crypto.randomUUID(), leftValue: "={{ $json.recovery_allowed === true }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {} }, id: crypto.randomUUID(), name: "IF Recovery Authorized", type: "n8n-nodes-base.if", typeVersion: 2.3, position: [160, 0] },
        { parameters: { source: "database", workflowId: { __rl: true, value: DELIVERY_ID, mode: "list", cachedResultName: DELIVERY_ID }, mode: "once", options: { waitForSubWorkflow: false } }, id: crypto.randomUUID(), name: "Resume Existing Assignment", type: "n8n-nodes-base.executeWorkflow", typeVersion: 1.3, position: [380, -100] },
        { parameters: { method: "PUT", url: `=https://sheets.googleapis.com/v4/spreadsheets/${env.AFFILIATE_TRACKER_SPREADSHEET_ID}/values/WhatsApp%20Leads!A{{$json.lead_row_number}}%3AAE{{$json.lead_row_number}}?valueInputOption=RAW`, authentication: "predefinedCredentialType", nodeCredentialType: "googleSheetsOAuth2Api", sendBody: true, specifyBody: "json", jsonBody: '={{ JSON.stringify({ majorDimension: "ROWS", values: [$json.lead_row_values] }) }}', options: {} }, id: crypto.randomUUID(), name: "Mark Expired Recovery Waiting", type: "n8n-nodes-base.httpRequest", typeVersion: 4.4, position: [380, 100], credentials: { googleSheetsOAuth2Api: credential } },
        { parameters: { jsCode: 'const source=$("Validate Recovery Preconditions").first().json; const status=source.recovery_action==="status"; const result=!source.recovery_allowed?"blocked":status?(source.failed_clip_count>0?"failed":source.remaining_clip_count===0?"completed":"pending"):"launched"; return [{json:{...source,recovery_result:result}}];' }, id: crypto.randomUUID(), name: "Recovery Result", type: "n8n-nodes-base.code", typeVersion: 2, position: [600, 0] },
      ],
      connections: {
        "Recovery Request": { main: [[{ node: "Reread Recovery State", type: "main", index: 0 }]] },
        "Reread Recovery State": { main: [[{ node: "Validate Recovery Preconditions", type: "main", index: 0 }]] },
        "Validate Recovery Preconditions": { main: [[{ node: "IF Status Request", type: "main", index: 0 }]] },
        "IF Status Request": { main: [[{ node: "Recovery Result", type: "main", index: 0 }], [{ node: "IF Recovery Authorized", type: "main", index: 0 }]] },
        "IF Recovery Authorized": { main: [[{ node: dryRun ? "Recovery Result" : "Resume Existing Assignment", type: "main", index: 0 }], [{ node: dryRun ? "Recovery Result" : "Mark Expired Recovery Waiting", type: "main", index: 0 }]] },
        "Resume Existing Assignment": { main: [[{ node: "Recovery Result", type: "main", index: 0 }]] },
        "Mark Expired Recovery Waiting": { main: [[{ node: "Recovery Result", type: "main", index: 0 }]] },
      },
      settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" },
    }),
  });

  const originalSettings = { ...(deliveryBefore.settings || {}) };
  try {
    if (!dryRun) {
      const recoverySettings = { ...originalSettings, callerPolicy: "workflowsFromAList", callerIds: [originalSettings.callerIds, controller.id].filter(Boolean).join(",") };
      await api(`/workflows/${DELIVERY_ID}`, env.N8N_API_KEY, { method: "PUT", body: JSON.stringify(payload(deliveryBefore, recoverySettings)) });
      if (deliveryBefore.active) await api(`/workflows/${DELIVERY_ID}/activate`, env.N8N_API_KEY, { method: "POST" });
    }
    await api(`/workflows/${controller.id}/activate`, env.N8N_API_KEY, { method: "POST" });
    const results = [];
    for (const assignment of selectedAssignments) {
      const response = await fetch(`http://localhost:5678/webhook/${webhookPath}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dryRun ? { ...assignment, action: "status" } : assignment) });
      const body = await response.text();
      if (!response.ok) throw new Error(`Recovery ${assignment.batch_number} HTTP ${response.status}: ${body.slice(0, 1000)}`);
      let result = body ? JSON.parse(body) : {};
      const entry = { batch_number: assignment.batch_number, username: assignment.username, recovery_result: result.recovery_result, blocked_reason: result.recovery_blocked_reason || "", remaining_before: result.remaining_clip_count, confirmation_count: result.confirmation_count, existing_video_message_count: result.existing_video_message_count };
      if (!dryRun && result.recovery_result === "launched") {
        const deadline = Date.now() + 20 * 60 * 1000;
        do {
          await new Promise((resolve) => setTimeout(resolve, 15000));
          const statusResponse = await fetch(`http://localhost:5678/webhook/${webhookPath}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...assignment, action: "status" }) });
          const statusBody = await statusResponse.text();
          if (!statusResponse.ok) throw new Error(`Recovery status ${assignment.batch_number} HTTP ${statusResponse.status}: ${statusBody.slice(0, 1000)}`);
          result = JSON.parse(statusBody);
          entry.recovery_result = result.recovery_result;
          entry.remaining_after = result.remaining_clip_count;
          entry.failed_clip_count = result.failed_clip_count;
        } while (result.recovery_result === "pending" && Date.now() < deadline);
        if (result.recovery_result === "pending") entry.recovery_result = "monitor_timeout";
      }
      results.push(entry);
      if (!dryRun && !["completed", "blocked"].includes(entry.recovery_result)) break;
    }
    process.stdout.write(`${JSON.stringify({ mode: dryRun ? "preflight_only" : "resume", results }, null, 2)}\n`);
  } finally {
    try { await api(`/workflows/${controller.id}/deactivate`, env.N8N_API_KEY, { method: "POST" }); } catch {}
    try { await api(`/workflows/${controller.id}`, env.N8N_API_KEY, { method: "DELETE" }); } catch {}
    if (!dryRun) {
      const current = await api(`/workflows/${DELIVERY_ID}`, env.N8N_API_KEY);
      await api(`/workflows/${DELIVERY_ID}`, env.N8N_API_KEY, { method: "PUT", body: JSON.stringify(payload(current, originalSettings)) });
      if (deliveryBefore.active) await api(`/workflows/${DELIVERY_ID}/activate`, env.N8N_API_KEY, { method: "POST" });
    }
  }
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
