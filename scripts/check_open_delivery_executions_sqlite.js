"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
db.all(`select id,"workflowId",status,mode,"startedAt","stoppedAt","waitTill" from execution_entity where status in ('new','running','waiting') order by "startedAt"`, (error, rows) => {
  if (error) throw error;
  process.stdout.write(JSON.stringify({ captured_at: new Date().toISOString(), open_executions: rows, open_delivery_executions: rows.filter((row) => row.workflowId === "AffWaDelivery2026") }, null, 2) + "\n");
  db.close();
});
