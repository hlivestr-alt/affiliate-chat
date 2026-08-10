"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
(async () => {
  const ids = process.argv.slice(2).filter(Boolean);
  if (!ids.length) throw new Error("workflow ids required");
  const rows = await all(`select id,"workflowId",status,mode,"startedAt","stoppedAt","retryOf","retrySuccessId" from execution_entity where "workflowId" in (${ids.map(() => "?").join(",")}) order by cast(id as integer)`, ids);
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  db.close();
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); db.close(); process.exitCode = 1; });
