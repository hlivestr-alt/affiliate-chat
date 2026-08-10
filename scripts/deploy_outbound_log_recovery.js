"use strict";
const fs=require("node:fs"),path=require("node:path");
const ROOT=path.resolve(__dirname,".."),API="http://localhost:5678/api/v1";
const env=Object.fromEntries(fs.readFileSync(path.join(ROOT,".env"),"utf8").split(/\r?\n/).map((line)=>{const i=line.indexOf("=");return i>0?[line.slice(0,i),line.slice(i+1)]:["",""]}).filter(([k])=>k));
const key=env.N8N_API_KEY;if(!key)throw new Error("N8N_API_KEY is missing");
const desired=JSON.parse(fs.readFileSync(path.join(ROOT,"n8n","imports","affiliate-outbound-log-recovery.json"),"utf8"));
async function request(route,options={}){const response=await fetch(API+route,{...options,headers:{"X-N8N-API-KEY":key,...(options.body?{"Content-Type":"application/json"}:{})}});const body=await response.text();if(!response.ok)throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0,800)}`);return body?JSON.parse(body):null}
async function main(){const list=await request("/workflows?limit=250");const existing=(list.data||[]).find((workflow)=>workflow.name===desired.name);const payload={name:desired.name,nodes:desired.nodes,connections:desired.connections,settings:desired.settings};
 const saved=existing?await request(`/workflows/${existing.id}`,{method:"PUT",body:JSON.stringify(payload)}):await request("/workflows",{method:"POST",body:JSON.stringify(payload)});
 if(saved.active)await request(`/workflows/${saved.id}/deactivate`,{method:"POST"});
 const verified=await request(`/workflows/${saved.id}`);process.stdout.write(JSON.stringify({id:verified.id,name:verified.name,active:verified.active,nodes:verified.nodes.length},null,2)+"\n")}
main().catch((error)=>{process.stderr.write((error.stack||error.message)+"\n");process.exitCode=1});
