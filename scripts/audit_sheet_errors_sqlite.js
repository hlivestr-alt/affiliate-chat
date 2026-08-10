"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);

db.all(`select e.id,e.status,e."workflowId",w.name,e."startedAt",e."stoppedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id left join workflow_entity w on w.id=e."workflowId" where e."startedAt">='2026-08-04 00:00:00' order by cast(e.id as integer)`, [], (error, rows) => {
  if (error) throw error;
  const findings = [];
  for (const row of rows) {
    let data;
    try { data = parse(row.data); } catch { continue; }
    for (const [node, runs] of Object.entries(data?.resultData?.runData || {})) {
      for (const run of runs || []) {
        const err = run?.error;
        if (!err) continue;
        const haystack = `${node} ${err.message || ""} ${err.description || ""} ${JSON.stringify(err.cause || "")}`;
        if (!/sheet|too many requests|429|quota|reconnect|aborted|timed out/i.test(haystack)) continue;
        findings.push({
          execution_id: row.id,
          workflow_id: row.workflowId,
          workflow_name: row.name || "",
          execution_status: row.status,
          started_at: row.startedAt,
          stopped_at: row.stoppedAt,
          node,
          message: err.message || "",
          description: err.description || "",
          http_code: err.httpCode || "",
          error_timestamp: err.timestamp ? new Date(Number(err.timestamp)).toISOString() : ""
        });
      }
    }
  }
  const summary = findings.reduce((acc, item) => {
    const kind = /reconnect/i.test(item.message + item.description) ? "credential_disconnected" : /429|too many requests|quota/i.test(item.message + item.description) ? "rate_limited" : /aborted/i.test(item.message) ? "aborted" : "timeout_or_transport";
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
  process.stdout.write(`${JSON.stringify({ summary, findings }, null, 2)}\n`);
  db.close();
});
