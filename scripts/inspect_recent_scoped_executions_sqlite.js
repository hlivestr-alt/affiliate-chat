"use strict";
const sqlite3=require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db=new sqlite3.Database("/home/node/.n8n/database.sqlite",sqlite3.OPEN_READONLY);
const ids=["AffWaWebhook2026","AffWaStatus2026","AffWaReply2026","AffWaDelivery2026","AffWaObservability2026","p24kmXRNibNLZovt","AfDriveReady2026"];
db.all(`select id,"workflowId",status,"startedAt","stoppedAt" from execution_entity where "workflowId" in (${ids.map(()=>"?").join(",")}) order by id desc limit 60`,ids,(error,rows)=>{
  if(error)throw error;
  console.log(JSON.stringify(rows,null,2));
  db.close();
});
