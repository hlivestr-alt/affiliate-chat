"use strict";
const crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const ROOT=path.resolve(__dirname,".."),API="http://localhost:5678/api/v1";
const env=Object.fromEntries(fs.readFileSync(path.join(ROOT,".env"),"utf8").split(/\r?\n/).map((line)=>{const i=line.indexOf("=");return i>0?[line.slice(0,i),line.slice(i+1)]:["",""]}).filter(([key])=>key));
const key=env.N8N_API_KEY;if(!key)throw new Error("N8N_API_KEY is missing");
const delivery=JSON.parse(fs.readFileSync(path.join(ROOT,"n8n","imports","affiliate-whatsapp-file-delivery.json"),"utf8"));
const source=delivery.nodes.find((node)=>node.name==="Read Delivery Log for Resume");
const credential=source.credentials.googleSheetsOAuth2Api;
const spreadsheetId=/spreadsheets\/([^/]+)/.exec(source.parameters.url)[1];
const workflowName="Temporary Audit - Google Sheets Connectivity";
const webhookPath="codex-google-connectivity-"+crypto.randomBytes(8).toString("hex");
const node=(name,type,typeVersion,position,parameters={},extra={})=>({id:crypto.randomUUID(),name,type,typeVersion,position,parameters,...extra});
const ranges=["'WhatsApp Leads'!A1:AE2","'Delivery Log'!A1:R2","'WhatsApp Message Log'!A1:X2"];
const query=new URLSearchParams({majorDimension:"ROWS",valueRenderOption:"UNFORMATTED_VALUE"});for(const range of ranges)query.append("ranges",range);
const trigger=node("Production Credential Check","n8n-nodes-base.webhook",2.1,[-300,0],{httpMethod:"POST",path:webhookPath,responseMode:"lastNode",options:{}},{webhookId:crypto.randomUUID()});
const read=node("Read Required Production Tabs Once","n8n-nodes-base.httpRequest",4.4,[-60,0],{authentication:"predefinedCredentialType",nodeCredentialType:"googleSheetsOAuth2Api",url:`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${query}`,options:{}},{credentials:{googleSheetsOAuth2Api:credential}});
const summarize=node("Return Connectivity Evidence","n8n-nodes-base.code",2,[180,0],{jsCode:`const ranges=$json.valueRanges||[];return [{json:{ok:ranges.length===3,spreadsheet_id:${JSON.stringify(spreadsheetId)},tabs:ranges.map((entry)=>String(entry.range||"").split("!")[0].replace(/^'|'$/g,"")),ranges:ranges.map((entry)=>entry.range),row_counts:ranges.map((entry)=>(entry.values||[]).length),checked_at_utc:new Date().toISOString()}}];`});
const desired={name:workflowName,nodes:[trigger,read,summarize],connections:{[trigger.name]:{main:[[{node:read.name,type:"main",index:0}]]},[read.name]:{main:[[{node:summarize.name,type:"main",index:0}]]}},settings:{executionOrder:"v1",saveDataErrorExecution:"all",saveDataSuccessExecution:"all"}};
async function request(route,options={}){const response=await fetch(API+route,{...options,headers:{"X-N8N-API-KEY":key,...(options.body?{"Content-Type":"application/json"}:{})}});const body=await response.text();if(!response.ok)throw new Error(`n8n API ${response.status} ${route}: ${body.slice(0,800)}`);return body?JSON.parse(body):null}
async function main(){const listing=await request("/workflows?limit=250");const previous=(listing.data||[]).find((workflow)=>workflow.name===workflowName);if(previous?.active)await request(`/workflows/${previous.id}/deactivate`,{method:"POST"});
 const saved=previous?await request(`/workflows/${previous.id}`,{method:"PUT",body:JSON.stringify(desired)}):await request("/workflows",{method:"POST",body:JSON.stringify(desired)});
 await request(`/workflows/${saved.id}/activate`,{method:"POST"});let status=0,body="";try{const response=await fetch(`http://localhost:5678/webhook/${webhookPath}`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});status=response.status;body=await response.text()}finally{await request(`/workflows/${saved.id}/deactivate`,{method:"POST"})}
 process.stdout.write(JSON.stringify({workflow_id:saved.id,webhook_path:webhookPath,http_status:status,response:body?JSON.parse(body):{}},null,2)+"\n");if(status<200||status>=300)process.exitCode=1}
main().catch((error)=>{process.stderr.write((error.stack||error.message)+"\n");process.exitCode=1});
