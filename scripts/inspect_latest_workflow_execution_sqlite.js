"use strict";
const sqlite3=require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const workflowId=String(process.argv[2]||"");if(!workflowId)throw new Error("workflow id required");
const db=new sqlite3.Database("/home/node/.n8n/database.sqlite",sqlite3.OPEN_READONLY);
db.get('select id,"workflowId",status,"startedAt","stoppedAt" from execution_entity where "workflowId"=? order by id desc limit 1',[workflowId],(error,row)=>{if(error)throw error;console.log(JSON.stringify(row||null,null,2));db.close()});
