"use strict";

const fs = require("node:fs");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse: parseFlatted } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const CANDIDATES = [
  [1,"6289508881998","yuvikachuu"],[2,"6287716716589","haqiqi_41"],[3,"6289656262493","uwininshp"],[4,"6282329499945","mayreeaemyou"],[5,"6285710416787","fadliyyahnr"],
  [6,"6281802341011","sanmisan88"],[7,"6285619400399","truelove894"],[8,"6289630301314",""],[9,"6285728041597","nur.aissyiah"],[10,"6289513492962","nyakcutriska1123"],
  [11,"6282130917108","masdanang"],[12,"6285864300358","mxylna_"],[13,"6285156242134","ikilorek_1"],[14,"6285757808520","tiandesya_p"],[15,"6283168853806","shipwithnaa"],
  [16,"6282325562349","ratna.sagraha"],[17,"6285726072907","izzatanaura"],[18,"6285814306702","ririnshop04"],[19,"6282393110262","wahyuniaksa.msi"],[20,"6285774758260","girlsshop"]
].map(([number,phone,username])=>({number,phone,username}));

const text = (v) => v == null ? "" : String(v).trim();
const digits = (v) => text(v).replace(/\D/g, "").replace(/^0/, "62");
const user = (v) => text(v).normalize("NFKC").toLowerCase().replace(/^@+/, "").replace(/[),.;:*]+$/g, "");
const parseMaybe = (v) => { if (typeof v !== "string") return v || {}; try { return JSON.parse(v); } catch { return {}; } };
const table = (values) => { const h=(values?.[0]||[]).map(text); return (values||[]).slice(1).map((r,i)=>({row_number:i+2,...Object.fromEntries(h.map((n,c)=>[n,text(r[c])]))})).filter(r=>Object.values(r).some(text)); };
const all = (db, sql, params=[]) => new Promise((resolve,reject)=>db.all(sql,params,(e,r)=>e?reject(e):resolve(r)));

async function accessToken(credentialPath) {
  const credentials=JSON.parse(fs.readFileSync(credentialPath,"utf8"));
  const record=credentials.find((item)=>item.type==="googleSheetsOAuth2Api");
  if(!record) throw new Error("google credential missing");
  const data=parseMaybe(record.data),oauth=parseMaybe(data.oauthTokenData);
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:data.clientId,client_secret:data.clientSecret,refresh_token:oauth.refresh_token,grant_type:"refresh_token"})});
  const payload=await response.json(); if(!response.ok) throw new Error(payload.error_description||payload.error); return {token:payload.access_token,credentials};
}
async function googleGet(url,token){const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});const body=await r.text();if(!r.ok)throw new Error(`Google ${r.status}: ${body.slice(0,400)}`);return JSON.parse(body);}
async function sheets(spreadsheetId,ranges,token){const q=new URLSearchParams({valueRenderOption:"FORMATTED_VALUE",dateTimeRenderOption:"FORMATTED_STRING"});for(const range of ranges)q.append("ranges",range);return googleGet(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${q}`,token);}

function compactLead(r){return {row_number:r.row_number,username:r.username,whatsapp_number:r.whatsapp_number||r.wa_id,conversation_id:r.conversation_id,state:r.state,batch_number:r.batch_number,files_expected:r.files_expected,files_sent:r.files_sent,files_delivered:r.files_delivered,files_failed:r.files_failed,last_inbound_at:r.last_inbound_at,last_inbound_message_id:r.last_inbound_message_id,window_expires_at:r.window_expires_at,last_error:r.last_error,updated_at:r.updated_at};}
function compactDelivery(r){return {row_number:r.row_number,delivery_key:r.delivery_key,conversation_id:r.conversation_id,whatsapp_number:r.whatsapp_number,batch_number:r.batch_number,file_index:r.file_index,file_name:r.file_name,media_id:r.media_id,whatsapp_message_id:r.whatsapp_message_id,state:r.state,send_state:r.send_state,delivery_state:r.delivery_state,attempts:r.attempts,last_error:r.last_error,updated_at:r.updated_at};}
function compactMessage(r){return {row_number:r.row_number,whatsapp_message_id:r.whatsapp_message_id,recipient_number:r.recipient_number,message_type:r.message_type,template_name:r.template_name,source_reference:r.source_reference,api_status:r.api_status,current_status:r.current_status,send_state:r.send_state,delivery_state:r.delivery_state,error_code:r.error_code,error_message:r.error_message,updated_at:r.updated_at,direction:r.direction};}
function compactRaw(r){let payload=parseMaybe(r["Sanitized JSON Payload"]);const messages=[];for(const entry of payload.entry||[])for(const change of entry.changes||[])for(const m of change.value?.messages||[])messages.push({id:m.id,from:m.from,timestamp:m.timestamp,type:m.type,text:m.text?.body||""});return {row_number:r.row_number,received_timestamp:r["Received Timestamp"],event_kind:r["Event Kind"],phone_number:r["Phone Number"],wa_id:r.wa_id,message_id:r["Message ID / wamid"],workflow:r.Workflow,execution_id:r["Execution ID"],processing_result:r["Processing Result"],messages};}

async function main(){
  const [credentialPath,oldSheet,newSheet,dbPath,envPath]=process.argv.slice(2); if(!credentialPath||!oldSheet||!newSheet||!dbPath)throw new Error("credential, old sheet, new sheet, db required");
  const {token,credentials}=await accessToken(credentialPath);
  const old=await sheets(oldSheet,["WhatsApp Leads!A:AE","Affiliate Assignments!A:M","Delivery Log!A:R","WhatsApp Message Log!A:X","WhatsApp Raw Events!A:L"],token);
  const simple=await sheets(newSheet,["Delivery Log!A:G"],token);
  const [leads,assignments,delivery,messages,raw]=old.valueRanges.map(v=>table(v.values)); const simpleRows=table(simple.valueRanges[0]?.values);
  const db=new sqlite3.Database(dbPath,sqlite3.OPEN_READONLY);
  const searchTokens=[...new Set(CANDIDATES.flatMap(c=>[c.phone,c.username]).filter(Boolean))];
  const execRows=await all(db,`select e.id,e."workflowId",coalesce(w.name,'') workflow_name,e.status,e.mode,e."startedAt",e."stoppedAt",d.data from execution_entity e left join workflow_entity w on w.id=e."workflowId" left join execution_data d on d."executionId"=e.id where cast(e.id as integer)>=12300 and (${searchTokens.map(()=>`d.data like ?`).join(" or ")}) order by cast(e.id as integer)`,searchTokens.map(t=>`%${t}%`));
  const normalizedExec=execRows.map(r=>({id:String(r.id),workflow_id:r.workflowId,workflow_name:r.workflow_name,status:r.status,mode:r.mode,started_at:r.startedAt,stopped_at:r.stoppedAt,blob:r.data||""}));
  const candidatePhones=new Set(CANDIDATES.map(c=>c.phone)),candidateUsers=new Set(CANDIDATES.map(c=>c.username).filter(Boolean));
  const candidateConversations=new Set(leads.filter(r=>candidatePhones.has(digits(r.whatsapp_number||r.wa_id))||candidateUsers.has(user(r.username))).map(r=>r.conversation_id).filter(Boolean));
  const folderIds=new Set(assignments.filter(r=>candidateConversations.has(r.conversation_id)||candidateUsers.has(user(r.username))).map(r=>r.drive_folder_id).filter(Boolean)); const folderMeta={};
  for(const id of folderIds){try{folderMeta[id]=await googleGet(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,trashed,parents,webViewLink`,token);}catch(e){folderMeta[id]={id,error:e.message};}}
  let env={}; if(envPath&&fs.existsSync(envPath))for(const line of fs.readFileSync(envPath,"utf8").split(/\r?\n/)){const i=line.indexOf("=");if(i>0)env[line.slice(0,i)]=line.slice(i+1);}
  let templates={checked:false,approved:[],error:""};
  try{const wa=credentials.find(c=>c.type==="httpHeaderAuth"&&/whatsapp|authorization/i.test(`${c.name} ${c.data}`));const wd=parseMaybe(wa?.data);const bearer=text(wd.value).replace(/^Bearer\s+/i,"");if(bearer&&env.WHATSAPP_WABA_ID){const tr=await fetch(`https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION||"v23.0"}/${env.WHATSAPP_WABA_ID}/message_templates?status=APPROVED&limit=100`,{headers:{Authorization:`Bearer ${bearer}`}});const tp=await tr.json();if(!tr.ok)throw new Error(tp.error?.message||String(tr.status));templates={checked:true,approved:(tp.data||[]).map(x=>({name:x.name,language:x.language,status:x.status,category:x.category})),error:""};}else templates.error="WhatsApp bearer credential or WABA ID unavailable";}catch(e){templates.error=e.message;}
  const results=[];
  for(const c of CANDIDATES){
    const candidateLeads=leads.filter(r=>digits(r.whatsapp_number||r.wa_id)===c.phone||(c.username&&user(r.username)===c.username));
    const conversations=new Set(candidateLeads.map(r=>r.conversation_id).filter(Boolean)); const batches=new Set(candidateLeads.map(r=>r.batch_number).filter(Boolean));
    const candidateAssignments=assignments.filter(r=>conversations.has(r.conversation_id)||(c.username&&user(r.username)===c.username)||batches.has(r.original_batch_number));
    for(const a of candidateAssignments){if(a.original_batch_number)batches.add(a.original_batch_number);if(a.conversation_id)conversations.add(a.conversation_id);}
    const candidateDelivery=delivery.filter(r=>digits(r.whatsapp_number)===c.phone||conversations.has(r.conversation_id)||batches.has(r.batch_number));
    const candidateMessages=messages.filter(r=>digits(r.recipient_number)===c.phone||[...conversations].some(x=>text(r.source_reference).startsWith(x+":"))||[...batches].some(x=>text(r.source_reference).includes(`:${x}:`)));
    const candidateRaw=raw.filter(r=>digits(r.wa_id||r["Phone Number"])===c.phone||text(r["Sanitized JSON Payload"]).includes(c.phone)||(c.username&&text(r["Sanitized JSON Payload"]).toLowerCase().includes(c.username)));
    const tokens=[c.phone,c.username,...conversations,...batches].filter(Boolean);const candidateExec=normalizedExec.filter(e=>tokens.some(t=>e.blob.includes(t))).map(({blob,...rest})=>rest);
    const active=candidateExec.filter(e=>["running","new","waiting"].includes(text(e.status).toLowerCase()));
    const durableDelivery=candidateDelivery.filter(r=>r.whatsapp_message_id&&(["accepted","sent","delivered","read"].includes(text(r.state).toLowerCase())||["accepted","sent","delivered","read"].includes(text(r.send_state).toLowerCase())||["sent","delivered","read"].includes(text(r.delivery_state).toLowerCase())));
    const durableMessages=candidateMessages.filter(r=>r.whatsapp_message_id&&text(r.message_type).toLowerCase()==="video"&&["accepted","sent","delivered","read"].includes(text(r.api_status||r.current_status||r.send_state||r.delivery_state).toLowerCase()));
    const durableByKey=new Map();for(const r of [...durableDelivery.map(compactDelivery),...durableMessages.map(compactMessage)])durableByKey.set(r.delivery_key||r.source_reference||r.whatsapp_message_id,r);
    const expected=Math.max(...candidateLeads.map(r=>Number(r.files_expected)||0),candidateDelivery.length?15:0,0);const preparedNames=[...new Set(candidateDelivery.map(r=>r.file_name).filter(Boolean))];const sentNames=new Set(durableDelivery.map(r=>r.file_name).filter(Boolean));
    const remainingRows=candidateDelivery.filter(r=>r.file_name&&!sentNames.has(r.file_name)).map(compactDelivery);
    const laterInbound=candidateRaw.map(compactRaw).flatMap(r=>r.messages.map(m=>({...m,received_timestamp:r.received_timestamp,execution_id:r.execution_id}))).sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
    results.push({candidate:c,leads:candidateLeads.map(compactLead),assignments:candidateAssignments.map(r=>({...r,folder_current:folderMeta[r.drive_folder_id]||null})),delivery_rows:candidateDelivery.map(compactDelivery),message_rows:candidateMessages.map(compactMessage),raw_events:candidateRaw.map(compactRaw),later_inbound_messages:laterInbound,executions:candidateExec,active_executions:active,durable_successful:[...durableByKey.values()],durable_successful_count:durableByKey.size,expected_clip_count:expected,prepared_file_count:preparedNames.length,remaining_rows:remainingRows,remaining_clip_count:Math.max(0,expected-sentNames.size),simple_delivery_log:simpleRows.filter(r=>digits(r["WhatsApp Number"])===c.phone||(c.username&&user(r.Username)===c.username)||batches.has(r["Numbered Folder"]))});
  }
  const output={audited_at:new Date().toISOString(),database_path:dbPath,sheet_row_counts:{leads:leads.length,assignments:assignments.length,delivery:delivery.length,messages:messages.length,raw:raw.length,simple:simpleRows.length},templates,candidates:results};
  process.stdout.write(JSON.stringify(output,null,2)); db.close();
}
main().catch(e=>{process.stderr.write(`${e.stack||e.message}\n`);process.exitCode=1;});
