"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));

function sanitize(value, depth = 0) {
  if (depth > 10) return "[DEPTH_LIMIT]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|authorization|api.?key|credentialData/i.test(key)) out[key] = "[REDACTED]";
    else if (/message_text|inbound_text|caption|content/i.test(key)) out[key] = item ? "[REDACTED CONTENT]" : item;
    else out[key] = sanitize(item, depth + 1);
  }
  return out;
}
function outputs(runs) {
  const result = [];
  for (const run of runs || []) for (const branch of run?.data?.main || []) for (const item of branch || []) result.push(sanitize(item?.json || {}));
  return result;
}

(async () => {
  const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
  if (!ids.length) throw new Error("execution ids required");
  const rows = await all(`select e.*,d.data,d."workflowData" from execution_entity e left join execution_data d on d."executionId"=e.id where e.id in (${ids.map(() => "?").join(",")}) order by cast(e.id as integer)`, ids);
  const result = rows.map((row) => {
    let data = {};
    try { data = parse(row.data || ""); } catch {}
    const runData = data?.resultData?.runData || {};
    return {
      execution: sanitize({ id: row.id, workflow_id: row.workflowId, status: row.status, mode: row.mode, started_at: row.startedAt, stopped_at: row.stoppedAt, wait_till: row.waitTill, retry_of: row.retryOf, retry_success_id: row.retrySuccessId }),
      last_node: data?.resultData?.lastNodeExecuted || "",
      error: sanitize(data?.resultData?.error || null),
      start_data: sanitize(data?.startData || null),
      runtime_data: sanitize(data?.executionData?.runtimeData || null),
      nodes: Object.entries(runData).map(([name, runs]) => ({ name, runs: runs.length, outputs: outputs(runs), errors: sanitize(runs.map((run) => run?.error).filter(Boolean)) }))
    };
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  db.close();
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); db.close(); process.exitCode = 1; });
