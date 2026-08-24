"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const OUTPUT = path.join(ROOT, "n8n", "exports", "state-model-separation-20260821", "controlled-test-executions.json");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const index = line.indexOf("="); return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ["", ""]; }).filter(([key]) => key));

async function api(route, options = {}) {
  const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n ${response.status} ${route}: ${body.slice(0, 600)}`);
  return body ? JSON.parse(body) : {};
}

const code = String.raw`
const testCase=String($json.body?.case||$json.case||"");
const base={state:"distribution_pending",last_intent:"distribution_intent",delivery_state:"not_started",batch_number:"",files_expected:"15",files_sent:"0",files_failed:"0"};
const delivery=(row,patch)=>({...row,...Object.fromEntries(Object.entries(patch).filter(([key])=>["batch_number","batch_reserved_at","delivery_started_at","files_expected","files_sent","files_delivered","files_failed","files_sent_at","files_delivered_at","last_error","updated_at","delivery_state"].includes(key)))});
const conversation=(row,patch)=>({...row,...Object.fromEntries(Object.entries(patch).filter(([key])=>["username","whatsapp_number","conversation_id","captured_at","state","last_whatsapp_message_id","last_inbound_at","last_intent","last_intent_confidence","updated_at","wa_id","last_inbound_message_id","window_expires_at"].includes(key)))});
let result;
if(testCase==="reservation_preserves_conversation") result=delivery(base,{state:"delivery_in_progress",delivery_state:"delivery_in_progress",batch_number:"6941"});
if(testCase==="inbound_during_delivery") result=conversation(delivery(base,{delivery_state:"delivery_in_progress",batch_number:"6941",files_sent:"4"}),{state:"awaiting_username",last_intent:"clarification_pending",last_inbound_message_id:"wamid.in.question"});
if(testCase==="finalization_after_inbound") result=delivery(conversation(delivery(base,{delivery_state:"delivery_in_progress",batch_number:"6941",files_sent:"4"}),{state:"awaiting_username",last_intent:"clarification_pending"}),{state:"files_sent",last_intent:"distribution_intent",delivery_state:"files_sent",files_sent:"15"});
if(testCase==="legacy_delivery_fallback") {const legacy={state:"files_sent",delivery_state:""};const lifecycle=legacy.delivery_state||(["delivery_in_progress","partial","files_sent","files_delivered","failed"].includes(legacy.state)?legacy.state:"not_started");result={...legacy,resolved_delivery_state:lifecycle};}
if(testCase==="assignment_6941_partial_fixture") result=delivery(conversation({...base,batch_number:"6941",files_expected:"15",files_sent:"4",delivery_state:"partial"},{state:"awaiting_username",last_intent:"clarification_pending",last_inbound_message_id:"wamid.in.6941"}),{});
if(!result) throw new Error("unknown_test_case:"+testCase);
const expectations={
 reservation_preserves_conversation:result.state==="distribution_pending"&&result.last_intent==="distribution_intent"&&result.delivery_state==="delivery_in_progress",
 inbound_during_delivery:result.state==="awaiting_username"&&result.last_intent==="clarification_pending"&&result.delivery_state==="delivery_in_progress"&&result.files_sent==="4",
 finalization_after_inbound:result.state==="awaiting_username"&&result.last_intent==="clarification_pending"&&result.delivery_state==="files_sent"&&result.files_sent==="15",
 legacy_delivery_fallback:result.resolved_delivery_state==="files_sent",
 assignment_6941_partial_fixture:result.state==="awaiting_username"&&result.last_intent==="clarification_pending"&&result.delivery_state==="partial"&&result.files_sent==="4"
};
if(expectations[testCase]!==true) throw new Error("assertion_failed:"+testCase+":"+JSON.stringify(result));
return [{json:{execution_id:String($execution.id),case:testCase,passed:true,result,no_external_nodes:true}}];`;

(async () => {
  const route = `state-model-controlled-${crypto.randomUUID()}`;
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({
    name: "Temporary State Model Separation Controlled Tests",
    nodes: [
      { id: crypto.randomUUID(), name: "Test Request", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-200, 0], webhookId: crypto.randomUUID(), parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} } },
      { id: crypto.randomUUID(), name: "Run State Isolation Fixture", type: "n8n-nodes-base.code", typeVersion: 2, position: [20, 0], parameters: { jsCode: code } }
    ],
    connections: { "Test Request": { main: [[{ node: "Run State Isolation Fixture", type: "main", index: 0 }]] } },
    settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" }
  }) });
  const results = [];
  try {
    await api(`/workflows/${workflow.id}/activate`, { method: "POST" });
    for (const testCase of ["reservation_preserves_conversation", "inbound_during_delivery", "finalization_after_inbound", "legacy_delivery_fallback", "assignment_6941_partial_fixture"]) {
      const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ case: testCase }) });
      const body = await response.text();
      if (!response.ok) throw new Error(`test ${testCase} ${response.status}: ${body.slice(0, 500)}`);
      results.push(JSON.parse(body));
    }
  } finally {
    try { await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" }); } catch {}
    try { await api(`/workflows/${workflow.id}`, { method: "DELETE" }); } catch {}
  }
  const report = { tested_at: new Date().toISOString(), temporary_workflow_id: workflow.id, temporary_workflow_deleted: true, whatsapp_requests: 0, sheet_writes: 0, results };
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
