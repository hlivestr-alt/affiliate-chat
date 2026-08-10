"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const API = "http://localhost:5678/api/v1";
const WORKFLOW_ID = "AffWaReply2026";
const NODE_NAME = "Start Sequential File Delivery";
const ALLOWED = ["saveExecutionProgress","saveManualExecutions","saveDataErrorExecution","saveDataSuccessExecution","executionTimeout","errorWorkflow","timezone","executionOrder","callerPolicy","callerIds","timeSavedPerExecution","redactionPolicy","availableInMCP","customTelemetryTags"];

function env(){const out={};for(const line of fs.readFileSync(path.join(ROOT,".env"),"utf8").split(/\r?\n/)){const match=line.match(/^([^#=]+)=(.*)$/);if(match)out[match[1].trim()]=match[2];}return out;}
async function api(route,key,options={}){const response=await fetch(API+route,{...options,headers:{"X-N8N-API-KEY":key,...(options.body?{"Content-Type":"application/json"}:{})}});const body=await response.text();if(!response.ok)throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0,500)}`);return body?JSON.parse(body):{};}
function payload(workflow){return{name:workflow.name,nodes:workflow.nodes,connections:workflow.connections,settings:Object.fromEntries(ALLOWED.filter(name=>Object.hasOwn(workflow.settings||{},name)).map(name=>[name,workflow.settings[name]]))};}

async function main(){
  const key=env().N8N_API_KEY;if(!key)throw new Error("N8N_API_KEY missing");
  const workflow=await api(`/workflows/${WORKFLOW_ID}`,key),wasActive=Boolean(workflow.active),beforeVersion=workflow.versionId,beforeActiveVersion=workflow.activeVersionId,beforeCount=workflow.nodes.length;
  const target=workflow.nodes.find(node=>node.name===NODE_NAME);if(!target)throw new Error(`${NODE_NAME} missing`);
  const targetId=typeof target.parameters?.workflowId==="object"?target.parameters.workflowId.value:target.parameters?.workflowId;
  if(targetId!=="AffWaDelivery2026")throw new Error(`Unexpected delivery target ${targetId}`);
  target.parameters.options={...(target.parameters.options||{}),waitForSubWorkflow:true};
  await api(`/workflows/${WORKFLOW_ID}`,key,{method:"PUT",body:JSON.stringify(payload(workflow))});
  if(wasActive)await api(`/workflows/${WORKFLOW_ID}/activate`,key,{method:"POST"});
  const after=await api(`/workflows/${WORKFLOW_ID}`,key),verified=after.nodes.find(node=>node.name===NODE_NAME);
  if(Boolean(after.active)!==wasActive||after.nodes.length!==beforeCount||verified?.parameters?.options?.waitForSubWorkflow!==true)throw new Error("Caller visibility deployment verification failed");
  process.stdout.write(JSON.stringify({workflow_id:after.id,node:NODE_NAME,target_workflow_id:targetId,active:after.active,before:{version_id:beforeVersion,active_version_id:beforeActiveVersion,node_count:beforeCount,wait_for_subworkflow:false},after:{version_id:after.versionId,active_version_id:after.activeVersionId,node_count:after.nodes.length,wait_for_subworkflow:true},effect:"Delivery startup and authorization failures now fail the AffWaReply2026 parent execution"},null,2)+"\n");
}
main().catch(error=>{process.stderr.write((error.stack||error.message)+"\n");process.exitCode=1;});
