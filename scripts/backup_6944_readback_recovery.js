"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "n8n", "exports", "assignment-6944-readback-recovery-20260824");
const API = "http://localhost:5678/api/v1";
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).map((line) => { const i=line.indexOf("="); return i>0?[line.slice(0,i).trim(),line.slice(i+1)]:["",""]; }).filter(([key])=>key));
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));return value;}
const hash=(value)=>crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
function nodeDefinition(node){return{type:node.type,typeVersion:node.typeVersion,parameters:node.parameters,credentials:node.credentials,retryOnFail:node.retryOnFail,maxTries:node.maxTries,waitBetweenTries:node.waitBetweenTries,continueOnFail:node.continueOnFail,onError:node.onError,disabled:node.disabled};}
async function api(route){const response=await fetch(API+route,{headers:{"X-N8N-API-KEY":env.N8N_API_KEY}});const body=await response.text();if(!response.ok)throw new Error(`n8n_${response.status}:${route}:${body.slice(0,500)}`);return JSON.parse(body);}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const [delivery,reply,entry]=await Promise.all([api("/workflows/AffWaDelivery2026"),api("/workflows/AffWaReply2026"),api("/workflows/AffWaWebhook2026")]);
  const groups={
    immediate_put:["Persist Successful Clip Immediately"],readback:["Read Back Persisted Successful Clip"],validators:["Validate Immediate Successful Send","Confirm Successful Clip Durable"],
    meta:["Upload Video to WhatsApp","Send WhatsApp Video"],selection:["Select and Prepare Batch Reservation","Restore and Validate Delivery Context","Prepare Resumable Delivery Items","Prepare Batch Send Claims"],
    guards:["Guard Cached Media Upload","IF Cached Media Upload Authorized","Guard Cached Clip Send","IF Cached Clip Send Authorized"],
    aggregate:["Prepare Batched Delivery Tracking","Update Final Send State"],simple_log:["Prepare Assignment Final Log","Log Assignment Final (Nonblocking)"]
  };
  const byName=new Map(delivery.nodes.map((node)=>[node.name,node]));
  const missing=Object.values(groups).flat().filter((name)=>!byName.has(name));if(missing.length)throw new Error(`backup_nodes_missing:${missing.join(",")}`);
  const nodeHashes=Object.fromEntries(Object.entries(groups).map(([group,names])=>[group,Object.fromEntries(names.map((name)=>[name,hash(nodeDefinition(byName.get(name)))]))]));
  const definition={name:delivery.name,nodes:delivery.nodes,connections:delivery.connections,settings:delivery.settings};
  const manifest={captured_at:new Date().toISOString(),entry_active_after_pause:entry.active,delivery:{id:delivery.id,active:delivery.active,version_id:delivery.versionId,active_version_id:delivery.activeVersionId,definition_sha256:hash(definition),caller_policy:delivery.settings?.callerPolicy||"",caller_ids:delivery.settings?.callerIds||""},node_hashes:nodeHashes};
  fs.writeFileSync(path.join(OUT,"AffWaDelivery2026.before.json"),JSON.stringify(delivery,null,2)+"\n",{mode:0o600});
  fs.writeFileSync(path.join(OUT,"AffWaReply2026.reference.json"),JSON.stringify(reply,null,2)+"\n",{mode:0o600});
  fs.writeFileSync(path.join(OUT,"before-node-hashes.json"),JSON.stringify(manifest,null,2)+"\n",{mode:0o600});
  process.stdout.write(JSON.stringify({output:OUT,...manifest},null,2)+"\n");
})().catch((error)=>{process.stderr.write(`${error.stack||error.message}\n`);process.exitCode=1;});
