"use strict";
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
db.all(`select e.id,e."workflowId",e.status,e."startedAt",e."stoppedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where e.id in (${ids.map(() => "?").join(",")}) order by e.id`, ids, (error, rows) => {
  if (error) throw error;
  const output = rows.map((row) => {
    const data = parse(row.data); const run = data?.resultData?.runData || {};
    return { id: row.id, workflow_id: row.workflowId, status: row.status, started_at: row.startedAt, stopped_at: row.stoppedAt, last_node: data?.resultData?.lastNodeExecuted || "", wait_till: data?.waitTill || "", nodes: Object.entries(run).map(([name, runs]) => ({ name, runs: runs.length, items: runs.reduce((sum, entry) => sum + (entry?.data?.main?.[0]?.length || 0), 0), last_start: runs.at(-1)?.startTime || "", error: runs.map((entry) => entry?.error?.message).filter(Boolean).at(-1) || "" })) };
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); db.close();
});
