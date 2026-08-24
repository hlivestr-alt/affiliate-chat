"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const API = "http://localhost:5678/api/v1";
const DELIVERY_ID = "AffWaDelivery2026";
const RECOVERY_ID = "p24kmXRNibNLZovt";
const OUT = path.join(ROOT, "n8n", "exports", "post-send-persistence-20260822");
const ALLOWED_SETTINGS = ["saveExecutionProgress","saveManualExecutions","saveDataErrorExecution","saveDataSuccessExecution","executionTimeout","errorWorkflow","timezone","executionOrder","callerPolicy","callerIds","timeSavedPerExecution","redactionPolicy","availableInMCP","customTelemetryTags"];
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const index=line.indexOf("="); return index>0?[line.slice(0,index).trim(),line.slice(index+1)]:["",""]; }).filter(([key]) => key));
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function nodeHash(node) { return hash({ type:node.type,typeVersion:node.typeVersion,parameters:node.parameters,credentials:node.credentials,retryOnFail:node.retryOnFail,maxTries:node.maxTries,waitBetweenTries:node.waitBetweenTries,continueOnFail:node.continueOnFail,onError:node.onError }); }
async function api(route, options={}) { const response=await fetch(API+route,{...options,headers:{"X-N8N-API-KEY":env.N8N_API_KEY,...(options.body?{"Content-Type":"application/json"}:{})}});const body=await response.text();if(!response.ok)throw new Error(`n8n_${response.status}:${route}:${body.slice(0,500)}`);return body?JSON.parse(body):{}; }
function payload(workflow){return{name:workflow.name,nodes:workflow.nodes,connections:workflow.connections,settings:Object.fromEntries(ALLOWED_SETTINGS.filter((name)=>Object.hasOwn(workflow.settings||{},name)).map((name)=>[name,workflow.settings[name]]))};}

(async()=>{
  if(!env.N8N_API_KEY)throw new Error("N8N_API_KEY missing");
  fs.mkdirSync(OUT,{recursive:true});
  const current=await api(`/workflows/${DELIVERY_ID}`), recovery=await api(`/workflows/${RECOVERY_ID}`);
  const desired=JSON.parse(fs.readFileSync(path.join(ROOT,"n8n","imports","affiliate-whatsapp-file-delivery.json"),"utf8"));
  if(current.active!==true)throw new Error("delivery_not_active");
  if(current.settings?.callerPolicy!=="workflowsFromAList"||String(current.settings?.callerIds)!=="AffWaReply2026")throw new Error("caller_policy_changed_before_deploy");
  const removeNames=new Set(["Ensure Outbound Log Recovery Table","Restore Tracking before Durable Queue","Store Durable Outbound Log Payload","Restore Tracking Batch","Update Durable Outbound Log Queue"]);
  const addNames=["Prepare In-Flight Send Claim","Persist In-Flight Send Claim","Restore Clip after In-Flight Claim","Read Delivery Row after Meta Success","Validate Immediate Successful Send","IF Successful Send Persistence Required","Persist Successful Clip Immediately","Read Back Persisted Successful Clip","Confirm Successful Clip Durable","Restore Idempotent Successful Clip"];
  const immutableNames=["Select and Prepare Batch Reservation","Prepare Resumable Delivery Items","Guard Cached Media Upload","Upload Video to WhatsApp","Parse Media Upload","Guard Cached Clip Send","Send WhatsApp Video","Parse Video Send","Prepare Cached Delivery Summary","Update Final Send State","Prepare Batch Send Claims","Batch Write Pre-Send Claims"];
  const beforeImmutable=Object.fromEntries(immutableNames.map((name)=>{const node=current.nodes.find((item)=>item.name===name);if(!node)throw new Error(`immutable_node_missing:${name}`);return[name,nodeHash(node)];}));
  const beforeSettings=hash(current.settings||{}), beforeUpload=nodeHash(current.nodes.find((node)=>node.name==="Upload Video to WhatsApp")), beforeSend=nodeHash(current.nodes.find((node)=>node.name==="Send WhatsApp Video"));
  if(!removeNames.size||[...removeNames].some((name)=>!current.nodes.some((node)=>node.name===name)))throw new Error("expected_obsolete_delivery_nodes_missing");
  if(current.nodes.filter((node)=>node.type==="n8n-nodes-base.dataTable").length!==3)throw new Error("unexpected_delivery_data_table_inventory");
  const proposed=structuredClone(current);
  proposed.nodes=proposed.nodes.filter((node)=>!removeNames.has(node.name)&&!addNames.includes(node.name));
  for(const name of addNames){const node=desired.nodes.find((item)=>item.name===name);if(!node)throw new Error(`desired_node_missing:${name}`);proposed.nodes.push(structuredClone(node));}
  const capture=proposed.nodes.find((node)=>node.name==="Capture Delivery Batch Write Result"), desiredCapture=desired.nodes.find((node)=>node.name==="Capture Delivery Batch Write Result");
  capture.parameters.jsCode=desiredCapture.parameters.jsCode;
  for(const name of removeNames)delete proposed.connections[name];
  const changedConnections=["IF Cached Clip Send Authorized","Prepare In-Flight Send Claim","Persist In-Flight Send Claim","Restore Clip after In-Flight Claim","IF File Send Succeeded","Read Delivery Row after Meta Success","Validate Immediate Successful Send","IF Successful Send Persistence Required","Persist Successful Clip Immediately","Read Back Persisted Successful Clip","Confirm Successful Clip Durable","Restore Idempotent Successful Clip","Prepare Batched Delivery Tracking","Prepare Durable Queue Status"];
  for(const name of changedConnections){if(!desired.connections[name])throw new Error(`desired_connection_missing:${name}`);proposed.connections[name]=structuredClone(desired.connections[name]);}
  const afterImmutable=Object.fromEntries(immutableNames.map((name)=>[name,nodeHash(proposed.nodes.find((item)=>item.name===name))]));
  if(JSON.stringify(beforeImmutable)!==JSON.stringify(afterImmutable))throw new Error("immutable_delivery_node_changed_in_proposal");
  if(hash(proposed.settings||{})!==beforeSettings)throw new Error("settings_changed_in_proposal");
  if(proposed.nodes.some((node)=>node.type==="n8n-nodes-base.dataTable"))throw new Error("delivery_data_table_dependency_remains");
  fs.writeFileSync(path.join(OUT,"delivery-before.json"),JSON.stringify(current,null,2)+"\n");
  fs.writeFileSync(path.join(OUT,"outbound-recovery-before.json"),JSON.stringify(recovery,null,2)+"\n");
  fs.writeFileSync(path.join(OUT,"delivery-proposed.json"),JSON.stringify(proposed,null,2)+"\n");
  let after=current, recoveryAfter=recovery;
  if(APPLY){
    await api(`/workflows/${DELIVERY_ID}`,{method:"PUT",body:JSON.stringify(payload(proposed))});
    await api(`/workflows/${DELIVERY_ID}/activate`,{method:"POST"});
    if(recovery.active)await api(`/workflows/${RECOVERY_ID}/deactivate`,{method:"POST"});
    after=await api(`/workflows/${DELIVERY_ID}`); recoveryAfter=await api(`/workflows/${RECOVERY_ID}`);
  }
  const afterImmutableLive=Object.fromEntries(immutableNames.map((name)=>[name,nodeHash(after.nodes.find((item)=>item.name===name))]));
  const verification={active:after.active,active_version_id:after.activeVersionId,data_table_nodes:after.nodes.filter((node)=>node.type==="n8n-nodes-base.dataTable").map((node)=>node.name),added_nodes:addNames.filter((name)=>after.nodes.some((node)=>node.name===name)),caller_policy:after.settings?.callerPolicy,caller_ids:after.settings?.callerIds,upload_unchanged:nodeHash(after.nodes.find((node)=>node.name==="Upload Video to WhatsApp"))===beforeUpload,send_unchanged:nodeHash(after.nodes.find((node)=>node.name==="Send WhatsApp Video"))===beforeSend,immutable_nodes_unchanged:JSON.stringify(afterImmutableLive)===JSON.stringify(beforeImmutable),settings_unchanged:hash(after.settings||{})===beforeSettings,recovery_worker_active:recoveryAfter.active};
  if(APPLY&&(!verification.active||verification.data_table_nodes.length||verification.added_nodes.length!==addNames.length||verification.caller_policy!=="workflowsFromAList"||String(verification.caller_ids)!=="AffWaReply2026"||!verification.upload_unchanged||!verification.send_unchanged||!verification.immutable_nodes_unchanged||!verification.settings_unchanged||verification.recovery_worker_active))throw new Error("post_deploy_verification_failed");
  fs.writeFileSync(path.join(OUT,"delivery-after.json"),JSON.stringify(after,null,2)+"\n");
  const report={mode:APPLY?"applied":"dry_run",captured_at:new Date().toISOString(),delivery_id:DELIVERY_ID,before:{version_id:current.versionId,active_version_id:current.activeVersionId,node_count:current.nodes.length,hash:hash(payload(current))},after:{version_id:after.versionId,active_version_id:after.activeVersionId,node_count:after.nodes.length,hash:hash(payload(after))},removed_nodes:[...removeNames],added_nodes:addNames,changed_existing_nodes:["Capture Delivery Batch Write Result"],changed_connections:changedConnections,verification,recovery_worker:{id:RECOVERY_ID,was_active:recovery.active,is_active:recoveryAfter.active,reason:"all 29 existing queue rows flushed; delivery no longer produces queue rows"}};
  fs.writeFileSync(path.join(OUT,"deployment-report.json"),JSON.stringify(report,null,2)+"\n");
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
})().catch((error)=>{process.stderr.write(`${error.stack||error.message}\n`);process.exitCode=1;});
