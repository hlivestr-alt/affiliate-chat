"use strict";
const sqlite3=require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const {parse}=require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db=new sqlite3.Database("/home/node/.n8n/database.sqlite",sqlite3.OPEN_READONLY);
db.all('select e.id,e.status,e."workflowId",e."startedAt",e."stoppedAt",w.name,d.data from execution_entity e left join workflow_entity w on w.id=e."workflowId" join execution_data d on d."executionId"=e.id order by cast(e.id as integer) desc limit 30',[],(error,rows)=>{if(error)throw error;const result=rows.map((row)=>{const data=parse(row.data);const err=data?.resultData?.error||{};return{id:row.id,status:row.status,workflow_id:row.workflowId,name:row.name||"",started_at:row.startedAt,stopped_at:row.stoppedAt,last_node:data?.resultData?.lastNodeExecuted||"",error_node:err.node?.name||"",error:err.message||""};});process.stdout.write(JSON.stringify(result,null,2)+"\n");db.close();});
