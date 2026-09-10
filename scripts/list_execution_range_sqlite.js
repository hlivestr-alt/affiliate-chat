"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const start = Number(process.argv[2]);
const end = Number(process.argv[3]);
if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error("start and end execution IDs required");
db.all(`select e.id,e."workflowId",w.name,e.status,e.mode,e."startedAt",e."stoppedAt",e."retryOf",e."retrySuccessId" from execution_entity e left join workflow_entity w on w.id=e."workflowId" where cast(e.id as integer) between ? and ? order by cast(e.id as integer)`, [start, end], (error, rows) => {
  if (error) throw error;
  process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
  db.close();
});
