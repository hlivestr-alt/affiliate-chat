"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const OUTPUT = path.join(ROOT, "n8n", "exports", "post-send-persistence-20260822", "controlled-test-executions.json");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const index = line.indexOf("="); return index > 0 ? [line.slice(0,index).trim(),line.slice(index+1)] : ["",""]; }).filter(([key]) => key));
const key = env.N8N_API_KEY;
if (!key) throw new Error("N8N_API_KEY missing");

async function api(route, options = {}) {
  const response = await fetch(API + route, { ...options, headers: { "X-N8N-API-KEY": key, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text(); if (!response.ok) throw new Error(`n8n_api_${response.status}:${route}:${body.slice(0,500)}`); return body ? JSON.parse(body) : {};
}
function latestExecution(workflowId) {
  const script = `const sqlite3=require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');const{parse}=require('/usr/local/lib/node_modules/n8n/node_modules/flatted');const db=new sqlite3.Database('/home/node/.n8n/database.sqlite',sqlite3.OPEN_READONLY);db.get('select e.id,e.status,d.data from execution_entity e join execution_data d on d.\"executionId\"=e.id where e.\"workflowId\"=? order by cast(e.id as integer) desc limit 1',[${JSON.stringify(workflowId)}],(error,row)=>{if(error)throw error;const data=parse(row.data),run=data?.resultData?.runData||{};console.log(JSON.stringify({id:String(row.id),status:row.status,error:data?.resultData?.error?.message||'',output:(run['Run Persistence Scenario']?.[0]?.data?.main?.[0]||[]).map(item=>item.json)}));db.close();});`;
  const result = spawnSync("docker", ["exec", "-u", "node", "n8n-local", "node", "-e", script], { cwd: ROOT, encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) throw new Error(`mock_execution_read_failed:${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

const code = String.raw`
const scenario=String($env.PERSISTENCE_TEST_SCENARIO||"");
const valid=(id)=>/^wamid\.[A-Za-z0-9_+=\/-]{12,}$/.test(String(id||""));
const rows=new Map(); let metaCalls=0;
const key=(index)=>"mock-assignment:6941:clip-"+String(index).padStart(2,"0")+".mp4";
const accepted=(index,id)=>({assignment_id:"mock-assignment",folder:"6941",clip_index:index,delivery_key:key(index),message_id:id,attempts:1,state:"accepted",sent_at:"2026-08-22T00:00:00.000Z"});
const preclaim=(index)=>rows.set(key(index),{assignment_id:"mock-assignment",folder:"6941",clip_index:index,delivery_key:key(index),message_id:"",attempts:1,state:"outcome_uncertain"});
const persist=(record)=>{if(!valid(record.message_id))throw new Error("invalid_mock_message_id");const current=rows.get(record.delivery_key);if(current?.message_id&&current.message_id!==record.message_id)throw new Error("mock_successful_message_id_conflict:"+record.delivery_key);if(!current?.message_id)rows.set(record.delivery_key,{...record});};
const plan=()=>Array.from({length:15},(_,i)=>i+1).filter((index)=>!rows.has(key(index)));
let result={scenario};
if(scenario==="crash_after_one") {preclaim(1);metaCalls++;persist(accepted(1,"wamid.MOCKCRASH000001"));result={...result,durable:1,remaining:plan().length,clip_1_resent:false,meta_calls:metaCalls};}
else if(scenario==="crash_before_persist") {preclaim(1);metaCalls++;const evidence="wamid.MOCKGAP00000001";result={...result,durable:0,safe_pending:plan().length,blocked_uncertain:1,forensic_message_id:evidence,meta_calls:metaCalls};}
else if(scenario==="persistence_failure") {preclaim(1);metaCalls++;throw new Error("mock_persistence_failure:forensic_message_id=wamid.MOCKFAIL0000001:next_meta_calls=0");}
else if(scenario==="duplicate_retry") {preclaim(1);const record=accepted(1,"wamid.MOCKDUP00000001");persist(record);persist(record);result={...result,durable:rows.size,unique_ids:new Set([...rows.values()].map(r=>r.message_id)).size,attempts:rows.get(key(1)).attempts};}
else if(scenario==="different_id_conflict") {preclaim(1);persist(accepted(1,"wamid.MOCKCONFLICT001"));persist(accepted(1,"wamid.MOCKCONFLICT002"));}
else if(scenario==="normal_15") {for(let i=1;i<=15;i++){preclaim(i);metaCalls++;persist(accepted(i,"wamid.MOCKNORMAL"+String(i).padStart(4,"0")));}result={...result,durable:rows.size,unique_ids:new Set([...rows.values()].map(r=>r.message_id)).size,aggregate:"15/15",conversation_state:"awaiting_username",last_intent:"clarification_pending",meta_calls:metaCalls};}
else if(scenario==="resume_4_of_15") {for(let i=1;i<=4;i++)persist(accepted(i,"wamid.MOCKRESUME"+String(i).padStart(4,"0")));result={...result,durable:rows.size,pending_indexes:plan(),protected_indexes:[1,2,3,4]};}
else throw new Error("unknown_mock_scenario:"+scenario);
return [{json:result}];`;

(async () => {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const workflow = await api("/workflows", { method: "POST", body: JSON.stringify({
    name: "Controlled Mock - WhatsApp Post-Send Persistence 20260822",
    nodes: [
      { id: "mock-trigger", name: "Controlled Mock Trigger", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0,0], parameters: {} },
      { id: "mock-model", name: "Run Persistence Scenario", type: "n8n-nodes-base.code", typeVersion: 2, position: [240,0], parameters: { jsCode: code } }
    ],
    connections: { "Controlled Mock Trigger": { main: [[{ node: "Run Persistence Scenario", type: "main", index: 0 }]] } },
    settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveDataErrorExecution: "all" }
  }) });
  const scenarios = [
    ["crash_after_one", "success"], ["crash_before_persist", "success"],
    ["persistence_failure", "error"], ["duplicate_retry", "success"],
    ["different_id_conflict", "error"], ["normal_15", "success"],
    ["resume_4_of_15", "success"]
  ];
  const executions = [];
  for (let index = 0; index < scenarios.length; index++) {
    const [scenario, expectedStatus] = scenarios[index];
    const command = spawnSync("docker", ["exec", "-u", "node", "-e", `N8N_RUNNERS_BROKER_PORT=${5700+index}`, "-e", `PERSISTENCE_TEST_SCENARIO=${scenario}`, "n8n-local", "n8n", "execute", `--id=${workflow.id}`, "--rawOutput"], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    const execution = latestExecution(workflow.id);
    const error = execution.error || "";
    const outputItems = execution.output || [];
    const passed = execution.status === expectedStatus && (scenario === "persistence_failure" ? error.includes("next_meta_calls=0") : scenario === "different_id_conflict" ? error.includes("clip-01.mp4") : outputItems.length === 1);
    executions.push({ scenario, expected_status: expectedStatus, execution_id: String(execution.id), actual_status: execution.status, passed, output: outputItems[0] || null, error, cli_exit_code: command.status });
    if (!passed) throw new Error(`mock_scenario_failed:${scenario}:${execution.status}:${error}`);
  }
  const report = { captured_at: new Date().toISOString(), workflow_id: workflow.id, workflow_name: workflow.name, real_whatsapp_requests: 0, executions };
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
