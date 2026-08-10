"use strict";
const sqlite3=require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db=new sqlite3.Database("/home/node/.n8n/database.sqlite",sqlite3.OPEN_READONLY);
db.all("select name from sqlite_master where type='table' and (name like '%data%' or name like '%table%') order by name",(error,tables)=>{
  if(error)throw error;
  const output={tables};
  db.all("select name from sqlite_master where type='table' and name like 'data_table_user_%'",(innerError,userTables)=>{
    if(innerError)throw innerError;
    let pending=userTables.length;
    output.user_tables=[];
    if(!pending){console.log(JSON.stringify(output,null,2));return db.close();}
    for(const item of userTables){db.all(`select * from "${item.name.replace(/"/g,'""')}"`,(rowError,rows)=>{
      output.user_tables.push({name:item.name,error:rowError?.message||"",rows:rows||[]});
      if(!--pending){console.log(JSON.stringify(output,null,2));db.close();}
    });}
  });
});
