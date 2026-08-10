"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const afterId = Number(process.argv[2] || 0);

function itemCount(runs) {
  let count = 0;
  for (const run of runs || []) for (const branch of run?.data?.main || []) count += (branch || []).length;
  return count;
}

(async () => {
  const executions = await all(`
    select e.id,e."workflowId",coalesce(w.name,'') as workflow_name,e.status,e.mode,e."startedAt",e."stoppedAt",d.data
    from execution_entity e
    left join workflow_entity w on w.id=e."workflowId"
    left join execution_data d on d."executionId"=e.id
    where cast(e.id as integer)>?
      and e."workflowId" in ('AffWaReply2026','AffWaDelivery2026','ecBB2oa6xeY2knFu','m1KBWKOLjwxbtFPP','AffWaWebhook2026')
    order by cast(e.id as integer)
  `, [afterId]);
  const output = executions.map((row) => {
    let data = {};
    try { data = parse(row.data || ""); } catch {}
    const runData = data?.resultData?.runData || {};
    const names = Object.keys(runData);
    return {
      id: row.id,
      workflow_id: row.workflowId,
      workflow_name: row.workflow_name,
      status: row.status,
      mode: row.mode,
      started_at: row.startedAt,
      stopped_at: row.stoppedAt,
      last_node: data?.resultData?.lastNodeExecuted || "",
      error: data?.resultData?.error?.message || "",
      delivery_signal: row.workflowId === "AffWaDelivery2026" && names.includes("Restore and Validate Delivery Context"),
      media_upload_runs: itemCount(runData["Upload Video to WhatsApp"]),
      media_send_runs: itemCount(runData["Send WhatsApp Video"]),
      parsed_send_runs: itemCount(runData["Parse Video Send"]),
      start_log_runs: itemCount(runData["Log Assignment Start (Nonblocking)"]),
      final_log_runs: itemCount(runData["Log Assignment Final (Nonblocking)"])
    };
  });
  const max = (await all("select max(cast(id as integer)) as id from execution_entity"))[0]?.id || 0;
  process.stdout.write(`${JSON.stringify({ checked_at: new Date().toISOString(), after_id: afterId, max_execution_id: max, executions: output }, null, 2)}\n`);
  db.close();
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); db.close(); process.exitCode = 1; });
