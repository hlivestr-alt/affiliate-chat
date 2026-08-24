"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const CREDENTIAL = "/tmp/recovery-6941-google-credential.json";
const DETAILED = process.env.AFFILIATE_TRACKER_SPREADSHEET_ID;
const SIMPLE = "1Zsq-ngyC1RGOCLlibFI-UyPBW88oQc0aJhC5cxtbrzA";
const OUTPUT = "/tmp/assignment-6941-simple-log-partial.json";
const BATCH = "6941", USERNAME = "jenius_abnormal", PHONE = "6282225211568";
function text(value) { return value == null ? "" : String(value).trim(); }
function table(values) { const headers=(values?.[0]||[]).map(text); return values.slice(1).map((row,index)=>({row_number:index+2,...Object.fromEntries(headers.map((name,column)=>[name,text(row[column])]))})); }
function assert(value, message) { if (!value) throw new Error(message); }
async function token() {
  const data=JSON.parse(fs.readFileSync(CREDENTIAL,"utf8"))[0].data; const oauth=typeof data.oauthTokenData==="string"?JSON.parse(data.oauthTokenData):data.oauthTokenData;
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:data.clientId,client_secret:data.clientSecret,refresh_token:oauth.refresh_token,grant_type:"refresh_token"})});
  const body=await response.json(); assert(response.ok&&body.access_token,"oauth_refresh_failed"); return body.access_token;
}
async function google(url, accessToken, options={}) { const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${accessToken}`,...(options.body?{"Content-Type":"application/json"}:{})}});const body=await response.text();if(!response.ok)throw new Error(`google_${response.status}:${body.slice(0,300)}`);return body?JSON.parse(body):{}; }
(async()=>{
  const accessToken=await token();
  const detailed=await google(`https://sheets.googleapis.com/v4/spreadsheets/${DETAILED}/values:batchGet?ranges=${encodeURIComponent("WhatsApp Leads!A:AE")}&ranges=${encodeURIComponent("Delivery Log!A:R")}&majorDimension=ROWS`,accessToken);
  const leads=table(detailed.valueRanges[0].values||[]),delivery=table(detailed.valueRanges[1].values||[]);
  const lead=leads.filter((row)=>row.batch_number===BATCH&&row.username===USERNAME&&text(row.wa_id||row.whatsapp_number).replace(/\D/g,"")===PHONE);
  const successes=delivery.filter((row)=>row.batch_number===BATCH&&row.conversation_id===`wa:${PHONE}`&&row.whatsapp_message_id&&["accepted","sent","delivered","read"].includes(row.state||row.send_state));
  assert(lead.length===1&&lead[0].state==="awaiting_username"&&lead[0].last_intent==="clarification_pending","lead_conflict_state_changed");
  assert(successes.length===4&&new Set(successes.map((row)=>row.whatsapp_message_id)).size===4,"durable_success_count_not_four");
  const simple=await google(`https://sheets.googleapis.com/v4/spreadsheets/${SIMPLE}/values/${encodeURIComponent("Delivery Log!A:G")}`,accessToken);
  const rows=table(simple.values||[]).filter((row)=>row["Numbered Folder"]===BATCH);
  assert(rows.length===1&&rows[0].Username===USERNAME&&text(rows[0]["WhatsApp Number"]).replace(/\D/g,"")===PHONE,"simple_log_owner_or_row_count_invalid");
  const row=rows[0], values=[BATCH,USERNAME,PHONE,row["Sent At"],"4/15","Partial","Recovery stopped before resume: lead conversation/delivery state conflict"];
  await google(`https://sheets.googleapis.com/v4/spreadsheets/${SIMPLE}/values/${encodeURIComponent(`Delivery Log!A${row.row_number}:G${row.row_number}`)}?valueInputOption=RAW`,accessToken,{method:"PUT",body:JSON.stringify({majorDimension:"ROWS",values:[values]})});
  const verify=await google(`https://sheets.googleapis.com/v4/spreadsheets/${SIMPLE}/values/${encodeURIComponent(`Delivery Log!A${row.row_number}:G${row.row_number}`)}`,accessToken);
  assert(JSON.stringify(verify.values?.[0]||[])===JSON.stringify(values),"simple_log_post_write_verification_failed");
  const output={captured_at:new Date().toISOString(),row_number:row.row_number,row_values:values,distinct_durable_successes:4,appended_rows:0,sha256:crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex")};
  fs.writeFileSync(OUTPUT,JSON.stringify(output,null,2)+"\n",{mode:0o600});process.stdout.write(JSON.stringify(output,null,2)+"\n");
})().catch((error)=>{process.stderr.write(`${error.stack||error.message}\n`);process.exitCode=1;});
