"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const OUT = path.join(ROOT, "n8n", "exports", "row-shape-recovery-6942-6943-20260824", "controlled-test-executions.json");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => {
  const index = line.indexOf("=");
  return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1)] : ["", ""];
}).filter(([key]) => key));
const immediateCode = fs.readFileSync(path.join(ROOT, "n8n", "code", "validate-immediate-successful-send.js"), "utf8");
const confirmCode = fs.readFileSync(path.join(ROOT, "n8n", "code", "confirm-successful-clip-durable.js"), "utf8");

async function api(route, options = {}) {
  const response = await fetch(`${API}${route}`, { ...options, headers: { "X-N8N-API-KEY": env.N8N_API_KEY, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n_${response.status}:${route}:${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}
function latestExecution(workflowId) {
  const script = `const sqlite3=require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');const{parse}=require('/usr/local/lib/node_modules/n8n/node_modules/flatted');const db=new sqlite3.Database('/home/node/.n8n/database.sqlite',sqlite3.OPEN_READONLY);db.get('select e.id,e.status,d.data from execution_entity e join execution_data d on d."executionId"=e.id where e."workflowId"=? order by cast(e.id as integer) desc limit 1',[${JSON.stringify(workflowId)}],(error,row)=>{if(error)throw error;const data=parse(row.data),run=data?.resultData?.runData||{};const failure=data?.resultData?.error||{};const out=(run['Confirm Successful Clip Durable']?.[0]?.data?.main?.[0]||[]).map(item=>item.json);console.log(JSON.stringify({id:String(row.id),status:row.status,error:failure.message||'',errorDetail:[failure.message,failure.description,failure.stack].filter(Boolean).join(' | '),errorNode:failure.node?.name||'',output:out}));db.close();});`;
  const result = spawnSync("docker", ["exec", "-u", "node", "n8n-local", "node", "-e", script], { cwd: ROOT, encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) throw new Error(`execution_read_failed:${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

const sourceCode = String.raw`
const scenario=String($env.ROW_SHAPE_SCENARIO||"");
const messageId="wamid.MOCKROWSHAPE000001";
const source={scenario,send_success:true,whatsapp_message_id:messageId,delivery_key:"wa:6200000000000:9000:clip-01.mp4",conversation_id:"wa:6200000000000",whatsapp_number:"6200000000000",batch_number:"9000",file_index:1,file_name:"clip-01.mp4",attempts:2,message_log_values:[["whatsapp_message_id","recipient_number","message_type","template_name","source_workflow","source_reference","api_status","accepted_at","current_status","status_timestamp","conversation_json","pricing_json","errors_json","error_code","error_title","error_message","error_details","processed_statuses","status_history_json","updated_at","direction"]]};
const row=[source.delivery_key,source.conversation_id,source.whatsapp_number,source.batch_number,"1",source.file_name,"media.mock","","outcome_uncertain","2","2026-08-24T00:00:00.000Z","","","","","2026-08-24T00:00:01.000Z","outcome_uncertain",""];
if(scenario==="B_17_blank_R"||scenario==="I_e2e_17")row.pop();
if(scenario==="C_multiple_trailing")row.splice(16,2);
if(scenario==="D_missing_row")source.mock_values=[];else source.mock_values=[row];
if(scenario==="E_wrong_assignment")row[3]="9001";
if(scenario==="F_wrong_clip")row[4]="2";
if(scenario==="G_identical_wamid"){row[7]=messageId;row[8]="accepted";row[16]="accepted";}
if(scenario==="H_conflicting_wamid")row[7]="wamid.MOCKROWSHAPEDIFFERENT";
return [{json:source}];`;
const readCode = 'return [{json:{values:$json.mock_values}}];';
const persistCode = String.raw`
const source=$("Validate Immediate Successful Send").item.json;
const row=[source.delivery_key,source.conversation_id,source.whatsapp_number,source.batch_number,String(source.file_index),source.file_name,"media.mock",source.whatsapp_message_id,"accepted",String(source.attempts),"2026-08-24T00:00:00.000Z","2026-08-24T00:00:02.000Z","","","","2026-08-24T00:00:02.000Z","accepted",""];
if(source.scenario==="B_17_blank_R"||source.scenario==="I_e2e_17")row.pop();
if(source.scenario==="C_multiple_trailing")row.splice(16,2);
return [{json:{values:[row]}}];`;

(async () => {
  if (!env.N8N_API_KEY) throw new Error("N8N_API_KEY missing");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({
    name: "Controlled Mock - Delivery Row Shape Validators 20260824",
    nodes: [
      { id: "trigger", name: "Controlled Trigger", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0,0], parameters: {} },
      { id: "source", name: "Parse Video Send", type: "n8n-nodes-base.code", typeVersion: 2, position: [220,0], parameters: { jsCode: sourceCode } },
      { id: "read", name: "Mock Read Delivery Row", type: "n8n-nodes-base.code", typeVersion: 2, position: [440,0], parameters: { jsCode: readCode } },
      { id: "validate", name: "Validate Immediate Successful Send", type: "n8n-nodes-base.code", typeVersion: 2, position: [660,0], parameters: { jsCode: immediateCode } },
      { id: "persist", name: "Mock Persist and Read Back", type: "n8n-nodes-base.code", typeVersion: 2, position: [880,0], parameters: { jsCode: persistCode } },
      { id: "confirm", name: "Confirm Successful Clip Durable", type: "n8n-nodes-base.code", typeVersion: 2, position: [1100,0], parameters: { jsCode: confirmCode } },
    ],
    connections: {
      "Controlled Trigger": { main: [[{ node: "Parse Video Send", type: "main", index: 0 }]] },
      "Parse Video Send": { main: [[{ node: "Mock Read Delivery Row", type: "main", index: 0 }]] },
      "Mock Read Delivery Row": { main: [[{ node: "Validate Immediate Successful Send", type: "main", index: 0 }]] },
      "Validate Immediate Successful Send": { main: [[{ node: "Mock Persist and Read Back", type: "main", index: 0 }]] },
      "Mock Persist and Read Back": { main: [[{ node: "Confirm Successful Clip Durable", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all", saveManualExecutions: true },
  }) });
  const cases = [
    { test: "A", scenario: "A_18", status: "success" },
    { test: "B", scenario: "B_17_blank_R", status: "success" },
    { test: "C", scenario: "C_multiple_trailing", status: "success" },
    { test: "D", scenario: "D_missing_row", status: "error", error: "immediate_success_persistence_row_missing" },
    { test: "E", scenario: "E_wrong_assignment", status: "error", error: "immediate_success_persistence_identity_conflict" },
    { test: "F", scenario: "F_wrong_clip", status: "error", error: "immediate_success_persistence_identity_conflict" },
    { test: "G", scenario: "G_identical_wamid", status: "success", immediateRequired: false },
    { test: "H", scenario: "H_conflicting_wamid", status: "error", error: "successful_message_id_conflict" },
    { test: "I-18", scenario: "I_e2e_18", status: "success" },
    { test: "I-17", scenario: "I_e2e_17", status: "success" },
  ];
  const executions = [];
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index];
    const command = spawnSync("docker", ["exec", "-u", "node", "-e", `ROW_SHAPE_SCENARIO=${item.scenario}`, "-e", `N8N_RUNNERS_BROKER_PORT=${5900 + index}`, "n8n-local", "n8n", "execute", `--id=${workflow.id}`, "--rawOutput"], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    const execution = latestExecution(workflow.id);
    const output = execution.output[0] || null;
    const passed = execution.status === item.status && (!item.error || execution.errorDetail.includes(item.error)) && (item.immediateRequired === undefined || output?.immediate_persistence_required === item.immediateRequired) && (item.status !== "success" || output?.immediate_persistence_verified === true);
    executions.push({ ...item, execution_id: execution.id, actual_status: execution.status, error_node: execution.errorNode, error: execution.error, output, cli_exit_code: command.status, passed });
    if (!passed) throw new Error(`controlled_test_failed:${item.test}:${execution.status}:${execution.error}`);
  }
  const report = { captured_at: new Date().toISOString(), workflow_id: workflow.id, workflow_name: workflow.name, active: workflow.active, real_whatsapp_requests: 0, meta_or_upload_nodes: 0, executions };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
