"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const sourceExecutionId = Number(process.argv[2]);
if (!Number.isInteger(sourceExecutionId)) throw new Error("source execution id required");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));

function nodeItems(data, nodeName) {
  const runs = data?.resultData?.runData?.[nodeName] || [];
  return runs.flatMap((run) => (run?.data?.main || []).flatMap((branch) => (branch || []).map((item) => item?.json || {})));
}

function collectStatuses(value, wanted, output, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStatuses(item, wanted, output, seen);
    return;
  }
  const id = String(value.id || value.whatsapp_message_id || "");
  if (wanted.has(id) && (value.status || value.current_status || value.send_state)) {
    output.push({ id, status: value.status || value.current_status || value.send_state, timestamp: value.timestamp || value.updated_at || "", error_code: value.error_code || value.errors?.[0]?.code || "" });
  }
  for (const child of Object.values(value)) collectStatuses(child, wanted, output, seen);
}

(async () => {
  const source = await get('select data from execution_data where "executionId"=?', [sourceExecutionId]);
  if (!source) throw new Error("source execution not found");
  const sourceData = parse(source.data);
  const ids = [...new Set([
    ...nodeItems(sourceData, "Send WhatsApp Video"),
    ...nodeItems(sourceData, "Parse Video Send"),
    ...nodeItems(sourceData, "Record Video Send Result")
  ].map((item) => String(item.whatsapp_message_id || item.messages?.[0]?.id || "")).filter(Boolean))];
  const wanted = new Set(ids);
  const events = [];
  for (const id of ids) {
    const rows = await all(
      `select e.id,e."workflowId",w.name,e.status,e."startedAt",d.data
       from execution_entity e join execution_data d on d."executionId"=e.id
       left join workflow_entity w on w.id=e."workflowId"
       where d.data like ? order by cast(e.id as integer)`, [`%${id}%`]
    );
    for (const row of rows) {
      const data = parse(row.data);
      const statuses = [];
      for (const runs of Object.values(data?.resultData?.runData || {})) {
        for (const run of runs || []) for (const branch of run?.data?.main || []) for (const item of branch || []) collectStatuses(item?.json, wanted, statuses);
      }
      const uniqueStatuses = [...new Map(statuses.map((status) => [`${status.id}|${status.status}|${status.timestamp}`, status])).values()];
      if (uniqueStatuses.length || row.id === sourceExecutionId) events.push({ execution_id: row.id, workflow_id: row.workflowId, workflow_name: row.name, execution_status: row.status, started_at: row.startedAt, statuses: uniqueStatuses });
    }
  }
  const uniqueEvents = [...new Map(events.map((event) => [`${event.execution_id}|${JSON.stringify(event.statuses)}`, event])).values()];
  process.stdout.write(`${JSON.stringify({ source_execution_id: sourceExecutionId, message_ids: ids, message_count: ids.length, events: uniqueEvents }, null, 2)}\n`);
  db.close();
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); db.close(); process.exitCode = 1; });
