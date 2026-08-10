"use strict";
const sqlite3=require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");const{parse}=require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const id=Number(process.argv[2]),names=new Set(process.argv.slice(3));const db=new sqlite3.Database("/home/node/.n8n/database.sqlite",sqlite3.OPEN_READONLY);
db.get('select data from execution_data where "executionId"=?',[id],(error,row)=>{if(error)throw error;const data=parse(row.data),run=data?.resultData?.runData||{},out={};for(const[name,runs]of Object.entries(run)){if(names.size&&!names.has(name))continue;out[name]=(runs||[]).map(entry=>({error:entry?.error||null,data:entry?.data?.main||[]}));}process.stdout.write(JSON.stringify(out,null,2)+"\n");db.close();});
