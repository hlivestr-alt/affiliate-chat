"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i = line.indexOf("="); return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ["", ""]; }).filter(([key]) => key));
const id = () => crypto.randomUUID();
const edge = (node) => ({ main: [[{ node, type: "main", index: 0 }]] });
async function api(route, options = {}) { const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } }); const body = await response.text(); if (!response.ok) throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0, 700)}`); return body ? JSON.parse(body) : {}; }

(async () => {
  const live = await api("/workflows/AffWaDelivery2026");
  const exactPrepareCode = live.nodes.find((node) => node.name === "Prepare Resumable Delivery Items")?.parameters?.jsCode;
  if (!exactPrepareCode || !exactPrepareCode.includes("zero_remaining_recovery")) throw new Error("deployed recovery code missing");
  const route = `zero-recovery-fixtures-${id()}`;
  const trigger = { id: id(), name: "Run Recovery Fixture", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [-660, 0], webhookId: id(), parameters: { httpMethod: "POST", path: route, responseMode: "lastNode", options: {} } };
  const fixtureCode = `const body=$json.body||$json,fixture=String(body.fixture||"complete"),CONV="fixture:zero_recovery",BATCH="900001",PHONE="6200000000999",USERNAME="fixture_affiliate";
const DELIVERY=["delivery_key","conversation_id","whatsapp_number","batch_number","file_index","file_name","media_id","whatsapp_message_id","state","attempts","uploaded_at","sent_at","delivered_at","failed_at","last_error","updated_at","send_state","delivery_state"];
const MESSAGE=["whatsapp_message_id","recipient_number","message_type","template_name","source_workflow","source_reference","api_status","accepted_at","current_status","status_timestamp","conversation_json","pricing_json","errors_json","error_code","error_title","error_message","error_details","processed_statuses","status_history_json","updated_at","direction","message_payload_json","send_state","delivery_state"];
const LEAD=["username","whatsapp_number","conversation_id","captured_at","reply_1","reply_2","reply_3","state","opt_in_message_id","opt_in_sent_at","opted_in_at","declined_at","batch_number","batch_reserved_at","delivery_started_at","files_expected","files_sent","files_delivered","files_failed","files_sent_at","files_delivered_at","posted_confirmed_at","last_whatsapp_message_id","last_inbound_at","last_intent","last_intent_confidence","last_error","updated_at","wa_id","last_inbound_message_id","window_expires_at"];
const files=Array.from({length:15},(_,i)=>\`clip_\${String(i+1).padStart(2,"0")}.mp4\`),now="2026-08-06T05:00:00.000Z",key=f=>\`\${CONV}:\${BATCH}:\${f}\`,mid=i=>\`wamid.FIXTURE\${String(i).padStart(8,"0")}\`;
const drows=[],mrows=[];function addSuccess(i,messageId=mid(i)){const f=files[i-1],record={delivery_key:key(f),conversation_id:CONV,whatsapp_number:PHONE,batch_number:BATCH,file_index:String(i),file_name:f,media_id:\`media_\${i}\`,whatsapp_message_id:messageId,state:"accepted",attempts:"1",uploaded_at:now,sent_at:now,last_error:"",updated_at:now,send_state:"accepted",delivery_state:"accepted"};drows.push(DELIVERY.map(h=>record[h]||""));const msg={whatsapp_message_id:messageId,recipient_number:PHONE,message_type:"video",source_workflow:"AffWaDelivery2026",source_reference:key(f),api_status:"accepted",accepted_at:now,current_status:"accepted",updated_at:now,direction:"outbound",send_state:"accepted"};mrows.push(MESSAGE.map(h=>msg[h]||""));}
if(["complete","repeat"].includes(fixture)){for(let i=1;i<=15;i++)addSuccess(i)}
else if(fixture==="partial"){for(let i=1;i<=12;i++)addSuccess(i)}
else if(fixture==="duplicate_clip"){for(let i=1;i<=14;i++)addSuccess(i);addSuccess(1,"wamid.FIXTUREDUPLICATE01");const f=files[14],r={delivery_key:key(f),conversation_id:CONV,whatsapp_number:PHONE,batch_number:BATCH,file_index:"15",file_name:f,media_id:"media_uncertain_15",state:"outcome_uncertain",attempts:"1",updated_at:now,send_state:"outcome_uncertain"};drows.push(DELIVERY.map(h=>r[h]||""))}
else if(["missing_message_id","empty_with_14"].includes(fixture)){for(let i=1;i<=14;i++)addSuccess(i);const f=files[14],r={delivery_key:key(f),conversation_id:CONV,whatsapp_number:PHONE,batch_number:BATCH,file_index:"15",file_name:f,media_id:"media_15",state:fixture==="missing_message_id"?"accepted":"outcome_uncertain",attempts:"1",updated_at:now,send_state:fixture==="missing_message_id"?"accepted":"outcome_uncertain"};drows.push(DELIVERY.map(h=>r[h]||""))}
else if(fixture==="mixed_assignment"){for(let i=1;i<=14;i++)addSuccess(i);const f=files[14],r={delivery_key:\`foreign:assignment:\${f}\`,conversation_id:CONV,whatsapp_number:PHONE,batch_number:BATCH,file_index:"15",file_name:f,media_id:"media_foreign",whatsapp_message_id:"wamid.FOREIGN00000015",state:"accepted",attempts:"1",updated_at:now,send_state:"accepted",delivery_state:"accepted"};drows.push(DELIVERY.map(h=>r[h]||""))}
else throw new Error("unknown_fixture:"+fixture);
return[{json:{fixture,delivery_context_valid:true,assignment_id:\`\${CONV}:\${BATCH}\`,conversation_id:CONV,batch_number:BATCH,row_number:99,username:USERNAME,tiktok_username:USERNAME,whatsapp_number:PHONE,wa_id:PHONE,expected_clip_count:15,files_expected:"15",files_sent:"0",files_failed:"0",state:"delivery_in_progress",lead_headers:LEAD,delivery_log_values:[DELIVERY,...drows],message_log_values:[MESSAGE,...mrows]}}];`;
  const source = { id: id(), name: "Restore and Validate Delivery Context", type: "n8n-nodes-base.code", typeVersion: 2, position: [-440, 0], parameters: { jsCode: fixtureCode } };
  const files = { id: id(), name: "Build Mock Assigned MP4 Files", type: "n8n-nodes-base.code", typeVersion: 2, position: [-220, 0], parameters: { jsCode: `const s=$input.first().json;return Array.from({length:15},(_,i)=>({json:{fixture:s.fixture},binary:{data:{fileName:\`clip_\${String(i+1).padStart(2,"0")}.mp4\`,mimeType:"video/mp4",data:""}}}));` } };
  const prepare = { id: id(), name: "Prepare Resumable Delivery Items", type: "n8n-nodes-base.code", typeVersion: 2, position: [0, 0], parameters: { jsCode: exactPrepareCode } };
  const summarize = { id: id(), name: "Summarize Recovery Fixture", type: "n8n-nodes-base.code", typeVersion: 2, position: [220, 0], parameters: { jsCode: `const items=$input.all().map(i=>i.json),first=items[0]||{},fixture=$("Restore and Validate Delivery Context").first().json.fixture;return[{json:{fixture,output_items:items.length,zero_remaining_recovery:first.zero_remaining_recovery===true,recovery_complete_verified:first.recovery_complete_verified===true,recovery_state:first.recovery_state||"normal_media_path",successful_send_count:first.successful_send_count??12,remaining_clip_count:first.remaining_clip_count??items.length,remaining_files:items.filter(i=>!i.zero_remaining_recovery).map(i=>i.file_name),recovery_error:first.recovery_error||"",problems:first.recovery_problems||[],durable_message_ids:(first.durable_message_ids||[]).length,media_nodes_present:false}}];` } };
  const nodes = [trigger, source, files, prepare, summarize];
  const connections = { [trigger.name]: edge(source.name), [source.name]: edge(files.name), [files.name]: edge(prepare.name), [prepare.name]: edge(summarize.name) };
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({ name: "Temporary Zero-Remaining Exact Logic Fixtures", nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" } }) });
  await api(`/workflows/${workflow.id}/activate`, { method: "POST" });
  const fixtureNames = ["complete", "repeat", "partial", "duplicate_clip", "missing_message_id", "empty_with_14", "mixed_assignment"];
  const results = [];
  for (const fixture of fixtureNames) { const response = await fetch(`http://localhost:5678/webhook/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fixture }) }); const body = await response.text(); results.push({ fixture, http_status: response.status, result: response.ok ? JSON.parse(body) : body.slice(0, 800) }); }
  await api(`/workflows/${workflow.id}/deactivate`, { method: "POST" });
  const output = { workflow_id: workflow.id, route, fixtures: results, cleanup_pending: true };
  const outPath = path.join(ROOT, "n8n", "exports", "proya-delivery-log-audit-20260806T1125CST", "zero-remaining-logic-fixtures.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
