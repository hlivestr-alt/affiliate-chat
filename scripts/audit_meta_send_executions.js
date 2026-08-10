#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse: parseFlatted } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
function all(db, sql, params) { return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))); }
async function main() {
  const [database, since, output] = process.argv.slice(2);
  if (!database || !since || !output || !Number.isFinite(Date.parse(since))) throw new Error("database, since, and output are required");
  const db = new sqlite3.Database(database, sqlite3.OPEN_READONLY);
  let rows;
  try {
    rows = await all(db, `select e.id,e."workflowId",e.status,e."startedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where e."startedAt">=? order by e.id`, [since.replace("T", " ").replace("Z", "")]);
  } finally { db.close(); }
  const sendPattern = /Send Non-template WhatsApp Text|Send WhatsApp Video|Upload Video to WhatsApp|Send WhatsApp/i;
  const sendExecutions = [];
  const workflowStatuses = {};
  const errorNodes = {};
  const errorMessages = {};
  for (const row of rows) {
    const key = `${row.workflowId}:${row.status}`;
    workflowStatuses[key] = (workflowStatuses[key] || 0) + 1;
    const execution = parseFlatted(row.data);
    const errorNode = execution?.resultData?.error?.node?.name || execution?.resultData?.lastNodeExecuted;
    if (row.status === "error" && errorNode) errorNodes[`${row.workflowId}:${errorNode}`] = (errorNodes[`${row.workflowId}:${errorNode}`] || 0) + 1;
    if (row.status === "error") {
      const message = String(execution?.resultData?.error?.message || "unknown error").replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>").slice(0, 400);
      const errorKey = `${row.workflowId}:${errorNode || "unknown"}`;
      const list = errorMessages[errorKey] ||= [];
      if (!list.includes(message) && list.length < 5) list.push(message);
    }
    const nodes = Object.keys(execution?.resultData?.runData || {}).filter((name) => sendPattern.test(name));
    if (nodes.length) sendExecutions.push({ execution_id: row.id, workflow_id: row.workflowId, nodes });
  }
  const report = { since, executions_scanned: rows.length, workflow_statuses: workflowStatuses, error_nodes: errorNodes, error_messages: errorMessages, meta_send_node_executions: sendExecutions };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
