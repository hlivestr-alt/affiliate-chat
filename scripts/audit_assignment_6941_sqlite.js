"use strict";

const fs = require("node:fs");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const DB = "/home/node/.n8n/database.sqlite";
const OUTPUT = process.argv[2] || "/tmp/assignment-6941-execution-evidence.json";
const ASSIGNMENT = "6941";
const PHONE = "6282225211568";
const USERNAME = "jenius_abnormal";
const MESSAGE_IDS = [
  "wamid.HBgNNjI4MjIyNTIxMTU2OBUCABEYEjZBOUZCQzI0NEI0ODY5RjExMAA=",
  "wamid.HBgNNjI4MjIyNTIxMTU2OBUCABEYEjVGMzREMEIyMDY1NzRDRTg0NAA=",
  "wamid.HBgNNjI4MjIyNTIxMTU2OBUCABEYEjkzOEVDRTc5MTI2OTA5REM3RgA=",
  "wamid.HBgNNjI4MjIyNTIxMTU2OBUCABEYEjhBOTAwRjQ1ODMzQ0UxQTJCQQA=",
];

const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));

function entries(run, name) {
  return (run[name] || []).flatMap((entry) => (entry?.data?.main || []).flatMap((branch) => branch || []).map((item) => ({
    start_time: entry.startTime || "",
    execution_index: entry.executionIndex ?? "",
    json: item?.json || {},
    binary: Object.keys(item?.binary || {}),
  })));
}

function pick(value) {
  const item = value || {};
  return {
    conversation_id: item.conversation_id || "",
    username: item.username || "",
    whatsapp_number: item.whatsapp_number || item.wa_id || item.recipient_number || "",
    batch_number: item.batch_number || item.original_batch_number || "",
    file_index: item.file_index ?? "",
    file_name: item.file_name || item.name || "",
    delivery_key: item.delivery_key || item.source_reference || "",
    media_id: item.media_id || "",
    whatsapp_message_id: item.whatsapp_message_id || item.message_id || item.messages?.[0]?.id || "",
    attempts: item.attempts ?? "",
    state: item.state || "",
    send_state: item.send_state || "",
    delivery_state: item.delivery_state || "",
    sent_at: item.sent_at || item.accepted_at || "",
    uploaded_at: item.uploaded_at || "",
    last_inbound_at: item.last_inbound_at || "",
    window_expires_at: item.window_expires_at || "",
    last_intent: item.last_intent || "",
    last_error: item.last_error || "",
  };
}

function summarize(row) {
  const data = parse(row.data);
  const run = data?.resultData?.runData || {};
  const nodeNames = Object.keys(run);
  const interesting = [
    "Restore and Validate Delivery Context",
    "Read Assigned MP4 Files",
    "Prepare Resumable Delivery Items",
    "Prepare Batch Send Claims",
    "Restore Batch Claimed Items",
    "Parse Media Upload",
    "Send WhatsApp Video",
    "Parse Video Send",
    "Prepare Batched Delivery Tracking",
    "Batch Write Delivery Results",
    "Append Message Results Batch",
    "Store Durable Outbound Log Payload",
    "Update Final Send State",
    "Prepare Assignment Start Log",
    "Log Assignment Start (Nonblocking)",
    "Prepare Assignment Final Log",
    "Log Assignment Final (Nonblocking)",
  ];
  const nodes = {};
  for (const name of interesting) {
    const found = entries(run, name).map((entry) => ({ start_time: entry.start_time, execution_index: entry.execution_index, ...pick(entry.json) }));
    if (found.length) nodes[name] = found;
  }
  return {
    id: String(row.id),
    workflow_id: row.workflowId,
    status: row.status,
    started_at: row.startedAt,
    stopped_at: row.stoppedAt,
    last_node: data?.resultData?.lastNodeExecuted || "",
    error: data?.resultData?.error?.message || "",
    node_names: nodeNames,
    nodes,
  };
}

(async () => {
  const incidentRows = await all(`
    select e.id,e."workflowId",e.status,e."startedAt",e."stoppedAt",d.data
    from execution_entity e join execution_data d on d."executionId"=e.id
    where e.id in (24315,24316,24319)
    order by cast(e.id as integer)
  `);
  const scopedRows = await all(`
    select e.id,e."workflowId",e.status,e."startedAt",e."stoppedAt",d.data
    from execution_entity e join execution_data d on d."executionId"=e.id
    where d.data like ? or d.data like ? or d.data like ?
    order by cast(e.id as integer)
  `, [`%${ASSIGNMENT}%`, `%${PHONE}%`, `%${USERNAME}%`]);
  const openRows = await all(`
    select e.id,e."workflowId",e.status,e."startedAt",e."stoppedAt",d.data
    from execution_entity e join execution_data d on d."executionId"=e.id
    where e.status in ('new','running','waiting')
      and (d.data like ? or d.data like ? or d.data like ?)
    order by cast(e.id as integer)
  `, [`%${ASSIGNMENT}%`, `%${PHONE}%`, `%${USERNAME}%`]);
  const messageEvidence = {};
  for (const messageId of MESSAGE_IDS) {
    const rows = await all(`
      select e.id,e."workflowId",e.status,e."startedAt",e."stoppedAt",d.data
      from execution_entity e join execution_data d on d."executionId"=e.id
      where d.data like ? order by cast(e.id as integer)
    `, [`%${messageId}%`]);
    messageEvidence[messageId] = rows.map((row) => summarize(row));
  }
  const output = {
    captured_at: new Date().toISOString(),
    assignment: ASSIGNMENT,
    phone: PHONE,
    username: USERNAME,
    incident_executions: incidentRows.map(summarize),
    scoped_executions: scopedRows.map(summarize),
    open_scoped_executions: openRows.map(summarize),
    message_id_execution_evidence: messageEvidence,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify({
    output: OUTPUT,
    captured_at: output.captured_at,
    incident_ids: output.incident_executions.map((entry) => entry.id),
    scoped_execution_ids: output.scoped_executions.map((entry) => entry.id),
    open_scoped_execution_ids: output.open_scoped_executions.map((entry) => entry.id),
    message_id_execution_counts: Object.fromEntries(Object.entries(messageEvidence).map(([id, rows]) => [id, rows.length])),
  }, null, 2) + "\n");
  db.close();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  db.close();
  process.exitCode = 1;
});
