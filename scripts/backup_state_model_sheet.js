"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

const CREDENTIAL = process.argv[2] || "/tmp/state-model-google-credential.json";
const OUTPUT = process.argv[3] || "/tmp/state-model-sheet-backup.json";
const SPREADSHEET = process.env.AFFILIATE_TRACKER_SPREADSHEET_ID;
const SIMPLE = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
function text(value) { return value == null ? "" : String(value).trim(); }
function table(values) { const headers=(values?.[0]||[]).map(text);return{headers,rows:(values||[]).slice(1).map((row,index)=>({row_number:index+2,...Object.fromEntries(headers.map((name,column)=>[name,text(row[column])]))})).filter((row)=>Object.entries(row).some(([key,value])=>key!=="row_number"&&value))}; }
async function token() { const exported=JSON.parse(fs.readFileSync(CREDENTIAL,"utf8"));if(!Array.isArray(exported)||exported.length!==1)throw new Error("credential_invalid");const data=exported[0].data,oauth=typeof data.oauthTokenData==="string"?JSON.parse(data.oauthTokenData):data.oauthTokenData;const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:data.clientId,client_secret:data.clientSecret,refresh_token:oauth.refresh_token,grant_type:"refresh_token"})});const body=await response.json();if(!response.ok||!body.access_token)throw new Error("oauth_refresh_failed");return body.access_token; }
async function google(url,accessToken){const response=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(45000)}),body=await response.text();if(!response.ok)throw new Error(`google_${response.status}:${body.slice(0,400)}`);return body?JSON.parse(body):{};}
(async()=>{
  const accessToken=await token();
  const metadata=await google(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}?includeGridData=true&ranges=${encodeURIComponent("WhatsApp Leads!A1:AF2")}&fields=${encodeURIComponent("spreadsheetId,properties.title,sheets(properties(sheetId,title,index,hidden,gridProperties),data(rowData(values(userEnteredValue,effectiveValue,formattedValue,dataValidation,userEnteredFormat))))")}`,accessToken);
  const ranges=["WhatsApp Leads!A:AZ","Affiliate Assignments!A:M","Delivery Log!A:R","WhatsApp Message Log!A:X"];
  const query=ranges.map((range)=>`ranges=${encodeURIComponent(range)}`).join("&");
  const values=await google(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values:batchGet?${query}&majorDimension=ROWS`,accessToken);
  const simple=await google(`https://sheets.googleapis.com/v4/spreadsheets/${SIMPLE}/values/${encodeURIComponent("Delivery Log!A:G")}`,accessToken);
  const tables=Object.fromEntries(ranges.map((range,index)=>[range.split("!")[0],table(values.valueRanges?.[index]?.values||[])]));
  const leads=tables["WhatsApp Leads"].rows,delivery=tables["Delivery Log"].rows,messages=tables["WhatsApp Message Log"].rows,assignments=tables["Affiliate Assignments"].rows,simpleRows=table(simple.values||[]).rows;
  const stateCounts=Object.fromEntries([...new Set(leads.map((row)=>row.state||"<blank>"))].sort().map((state)=>[state,leads.filter((row)=>(row.state||"<blank>")===state).length]));
  const intentCounts=Object.fromEntries([...new Set(leads.map((row)=>row.last_intent||"<blank>"))].sort().map((intent)=>[intent,leads.filter((row)=>(row.last_intent||"<blank>")===intent).length]));
  const assigned=leads.filter((row)=>/^\d+$/.test(row.batch_number)).map((lead)=>{
    const rows=delivery.filter((row)=>row.batch_number===lead.batch_number&&row.conversation_id===lead.conversation_id);
    const successful=rows.filter((row)=>row.whatsapp_message_id&&["accepted","sent","delivered","read"].includes(text(row.delivery_state||row.state||row.send_state).toLowerCase()));
    const failed=rows.filter((row)=>["failed"].includes(text(row.delivery_state||row.state||row.send_state).toLowerCase()));
    const expected=Number(lead.files_expected||15);
    const allDelivered=successful.length===expected&&successful.every((row)=>["delivered","read"].includes(text(row.delivery_state||row.state).toLowerCase()));
    const derived=successful.length===expected?(allDelivered?"files_delivered":"files_sent"):failed.length?"failed":successful.length?"partial":"delivery_in_progress";
    return{row_number:lead.row_number,conversation_id:lead.conversation_id,username:lead.username,batch_number:lead.batch_number,shared_state:lead.state,last_intent:lead.last_intent,files_expected:lead.files_expected,files_sent:lead.files_sent,files_failed:lead.files_failed,durable_rows:rows.length,durable_success_count:new Set(successful.map((row)=>row.delivery_key)).size,durable_message_id_count:new Set(successful.map((row)=>row.whatsapp_message_id)).size,durable_failed_count:failed.length,simple_rows:simpleRows.filter((row)=>row["Numbered Folder"]===lead.batch_number),derived_delivery_state:derived};
  });
  const output={captured_at:new Date().toISOString(),spreadsheet_id:SPREADSHEET,simple_spreadsheet_id:SIMPLE,metadata,tables:{...tables,"Simple Delivery Log":{headers:table(simple.values||[]).headers,rows:simpleRows}},state_counts:stateCounts,intent_counts:intentCounts,assigned_lead_derivations:assigned,integrity_sha256:""};
  output.integrity_sha256=crypto.createHash("sha256").update(JSON.stringify({...output,integrity_sha256:""})).digest("hex");
  fs.writeFileSync(OUTPUT,JSON.stringify(output,null,2)+"\n",{mode:0o600});
  process.stdout.write(JSON.stringify({output:OUTPUT,captured_at:output.captured_at,metadata:metadata.sheets?.map((sheet)=>sheet.properties),lead_headers:tables["WhatsApp Leads"].headers,lead_count:leads.length,state_counts:stateCounts,intent_counts:intentCounts,assigned_lead_count:assigned.length,assigned_derivations:assigned,integrity_sha256:output.integrity_sha256},null,2)+"\n");
})().catch((error)=>{process.stderr.write(`${error.stack||error.message}\n`);process.exitCode=1;});
