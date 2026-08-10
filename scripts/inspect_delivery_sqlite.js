"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
db.all(`select e.id,e.status,e."startedAt",e."stoppedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where e."workflowId"='AffWaDelivery2026' order by cast(e.id as integer) desc limit 10`, [], (error, rows) => {
  if (error) throw error;
  const result = rows.map((row) => { const data = parse(row.data); const run = data?.resultData?.runData || {}; const trigger = run["When Executed after Opt-in"]?.at(-1)?.data?.main?.[0]?.[0]?.json || {}; const err = data?.resultData?.error || {}; return { id: row.id, status: row.status, started_at: row.startedAt, stopped_at: row.stoppedAt, batch_number: trigger.batch_number, username: trigger.username, whatsapp_number: trigger.whatsapp_number || trigger.wa_id, last_node: data?.resultData?.lastNodeExecuted, error_node: err.node?.name || "", error: err.message || "" }; });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); db.close();
});
