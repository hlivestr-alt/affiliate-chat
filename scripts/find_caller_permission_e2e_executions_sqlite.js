"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));

(async () => {
  const rows = await all(`
    select e.id,e."workflowId",coalesce(w.name,'') as workflow_name,e.status,e.mode,e."startedAt",e."stoppedAt"
    from execution_entity e
    left join workflow_entity w on w.id=e."workflowId"
    where e."startedAt" >= '2026-08-06 02:55:00.000'
      and (e."workflowId" in ('AffWaDelivery2026','ecBB2oa6xeY2knFu','m1KBWKOLjwxbtFPP')
        or e."workflowId" in ('ndj0xdI9d0uOaeXl','U6iuY1huqVcDqCcy'))
    order by cast(e.id as integer)
  `);
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  db.close();
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); db.close(); process.exitCode = 1; });
