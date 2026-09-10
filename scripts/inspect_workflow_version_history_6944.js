"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
(async () => {
  const tables = await all(`select name from sqlite_master where type='table' and (name like '%history%' or name like '%version%' or name like '%execution%') order by name`);
  const columns = {};
  for (const table of tables) columns[table.name] = await all(`pragma table_info("${table.name}")`);
  const metadata = await all(`select * from execution_metadata where "executionId"=25791`).catch(() => []);
  const annotations = await all(`select * from execution_annotation where "executionId"=25791`).catch(() => []);
  const executionVersion = await all(`select e.id,e."workflowVersionId" entity_version,d."workflowVersionId" data_version,e."startedAt",e."stoppedAt" from execution_entity e join execution_data d on d."executionId"=e.id where e.id=25791`);
  const publishHistory = await all(`select * from workflow_publish_history where "workflowId"='AffWaDelivery2026' and "createdAt" between '2026-08-24 08:30:00' and '2026-08-24 09:30:00' order by "createdAt"`);
  const published = await all(`select * from workflow_published_version where "workflowId"='AffWaDelivery2026'`);
  process.stdout.write(JSON.stringify({ executionVersion, publishHistory, published, metadata, annotations }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }).finally(() => db.close());
