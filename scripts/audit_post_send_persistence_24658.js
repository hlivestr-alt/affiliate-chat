"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
function text(value) { return value == null ? "" : String(value).trim(); }
function items(run, name) { return (run[name] || []).flatMap((entry) => (entry?.data?.main || []).flatMap((branch) => branch || []).map((item) => item.json || {})); }

(async () => {
  const workflowColumns = await all("pragma table_info(workflow_entity)");
  const workflowRows = await all('select id,name,active,nodes,connections,"activeVersionId" from workflow_entity where active=1 order by name');
  const activeDataTableRefs = [];
  for (const workflow of workflowRows) {
    const nodes = JSON.parse(workflow.nodes || "[]");
    for (const node of nodes.filter((candidate) => candidate.type === "n8n-nodes-base.dataTable")) {
      activeDataTableRefs.push({ workflow_id: workflow.id, workflow_name: workflow.name, active_version_id: workflow.activeVersionId, node_id: node.id, node_name: node.name, disabled: node.disabled === true, operation: `${text(node.parameters?.resource)}:${text(node.parameters?.operation)}`, table: text(node.parameters?.tableName || node.parameters?.dataTableId?.value), continue_on_fail: node.continueOnFail === true, on_error: text(node.onError) });
    }
  }
  const tables = await all('select id,name,"projectId" from data_table order by name');
  const dataTables = [];
  for (const table of tables) {
    const physical = `data_table_user_${table.id}`;
    const count = await get(`select count(*) count from "${physical.replace(/"/g, '""')}"`);
    const statuses = await all(`select status,count(*) count from "${physical.replace(/"/g, '""')}" group by status order by status`).catch(() => []);
    dataTables.push({ ...table, physical_table: physical, row_count: count.count, status_counts: statuses });
  }
  const execution = await get('select e.id,e."workflowId",e.status,e."startedAt",e."stoppedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where e.id=24658');
  const parsed = parse(execution.data), run = parsed?.resultData?.runData || {};
  const sequenceNames = ["Send WhatsApp Video","Parse Video Send","IF File Send Succeeded","Wait Between Recipient Messages","Prepare Batched Delivery Tracking","Ensure Outbound Log Recovery Table","Prepare Durable Outbound Log Payload","Store Durable Outbound Log Payload","Batch Write Delivery Results","Append Message Results Batch","Prepare Cached Delivery Summary","Update Final Send State"];
  const sequence = [];
  for (const name of sequenceNames) {
    const runs = run[name] || [];
    sequence.push({ name, run_count: runs.length, item_count: runs.reduce((sum, entry) => sum + (entry?.data?.main || []).flatMap((branch) => branch || []).length, 0), first_started_ms: Math.min(...runs.map((entry) => Number(entry.startTime)).filter(Number.isFinite), Infinity), last_started_ms: Math.max(...runs.map((entry) => Number(entry.startTime)).filter(Number.isFinite), -Infinity), last_finished_ms: Math.max(...runs.map((entry) => Number(entry.startTime) + Number(entry.executionTime || 0)).filter(Number.isFinite), -Infinity), errors: runs.flatMap((entry) => entry?.error?.message ? [entry.error.message] : []) });
  }
  const sends = items(run, "Parse Video Send");
  const firstSend = Math.min(...(run["Parse Video Send"] || []).map((entry) => Number(entry.startTime)).filter(Number.isFinite));
  const lastSendFinish = Math.max(...(run["Parse Video Send"] || []).map((entry) => Number(entry.startTime) + Number(entry.executionTime || 0)).filter(Number.isFinite));
  const failureStart = Number(run["Ensure Outbound Log Recovery Table"]?.[0]?.startTime || 0);
  const output = {
    captured_at: new Date().toISOString(),
    workflow_columns: workflowColumns.map((column) => column.name),
    execution: { id: execution.id, workflow_id: execution.workflowId, status: execution.status, started_at: execution.startedAt, stopped_at: execution.stoppedAt, last_node: parsed?.resultData?.lastNodeExecuted, error: parsed?.resultData?.error?.message || "", successful_send_results: sends.length, unique_message_ids: new Set(sends.map((item) => item.whatsapp_message_id)).size },
    sequence,
    failure_window: { first_meta_success_to_failure_ms: failureStart - firstSend, last_meta_success_to_failure_ms: failureStart - lastSendFinish },
    active_data_table_references: activeDataTableRefs,
    data_tables: dataTables,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }).finally(() => db.close());
