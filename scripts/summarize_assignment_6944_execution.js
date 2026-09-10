"use strict";

const crypto = require("node:crypto");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
function outputItems(runs) { return (runs || []).flatMap((run) => (run?.data?.main || []).flatMap((branch) => branch || [])).map((item) => item?.json || {}); }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value; }
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
function first(runs) { return outputItems(runs)[0] || {}; }
function nodeSummary(name, runs) {
  const item = first(runs);
  const values = item.values;
  return {
    name, runs: runs.length, item_count: outputItems(runs).length,
    started_at_ms: runs[0]?.startTime || "", execution_time_ms: runs.reduce((sum, run) => sum + Number(run.executionTime || 0), 0),
    error: runs.map((run) => run?.error ? { message: run.error.message || "", description: run.error.description || "", http_code: run.error.httpCode || "" } : null).filter(Boolean),
    batch: item.batch_number || item["Numbered Folder"] || "", file_index: item.file_index ?? "", file_name: item.file_name || "",
    row_number: item.delivery_log_row_number ?? item.row_number ?? "", media_id: item.media_id || item.body?.id || "",
    wamid: item.whatsapp_message_id || item.message_id || item.messages?.[0]?.id || item.body?.messages?.[0]?.id || "",
    send_state: item.send_state || item.state || "", attempts: item.attempts ?? "", updated_range: item.updatedRange || item.updates?.updatedRange || "",
    values_rows: Array.isArray(values) ? values.length : "", values_first_width: Array.isArray(values?.[0]) ? values[0].length : "",
    values_first: Array.isArray(values?.[0]) ? values[0] : undefined,
    values_last_width: Array.isArray(values?.at?.(-1)) ? values.at(-1).length : "",
    values_last: Array.isArray(values?.at?.(-1)) ? values.at(-1) : undefined,
    selected_files: Array.isArray(item.selected_files) ? item.selected_files.map((file) => ({ index: file.file_index, name: file.file_name })) : undefined,
  };
}
function callbackStatus(data) {
  const run = data?.resultData?.runData || {};
  const item = first(run["Verify and Parse WhatsApp Webhook"] || []);
  const event = item.raw_event || {};
  const status = event.statuses?.[0] || item.raw_callback?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0] || {};
  return { event_kind: item.event_kind || "", phone: item.whatsapp_number || item.wa_id || "", wamid: item.whatsapp_message_id || status.id || "", callback_status: status.status || item.status || "", callback_timestamp: status.timestamp || item.whatsapp_timestamp || "", errors: status.errors || [] };
}
(async () => {
  const importantDeliveryNodes = new Set([
    "When Called by Reply Workflow", "Select and Prepare Batch Reservation", "Restore and Validate Delivery Context", "Prepare Assignment Start Log", "Log Assignment Start (Nonblocking)",
    "Prepare Resumable Delivery Items", "Prepare Batch Send Claims", "Persist Batch Pre-Send Claims", "Loop Through Files", "Prepare In-Flight Send Claim", "Persist In-Flight Send Claim", "Read Back In-Flight Send Claim", "Verify In-Flight Send Claim",
    "Guard Cached Media Upload", "IF Cached Media Upload Authorized", "Upload Video to WhatsApp", "Parse Media Upload", "IF Media Upload Succeeded", "Guard Cached Clip Send", "IF Cached Clip Send Authorized", "Send WhatsApp Video", "Parse Video Send", "IF File Send Succeeded",
    "Read Delivery Row after Meta Success", "Validate Immediate Successful Send", "IF Successful Send Persistence Required", "Persist Successful Clip Immediately", "Read Back Persisted Successful Clip", "Confirm Successful Clip Durable",
    "Prepare Batched Delivery Tracking", "Update Final Send State", "Prepare Assignment Final Log", "Log Assignment Final (Nonblocking)"
  ]);
  const ids = Array.from({ length: 10 }, (_, index) => 25789 + index);
  const rows = await all(`select e.*,d.data,d."workflowData",w.name workflowName from execution_entity e join execution_data d on d."executionId"=e.id left join workflow_entity w on w.id=e."workflowId" where e.id in (${ids.map(() => "?").join(",")}) order by cast(e.id as integer)`, ids);
  const executions = rows.map((row) => {
    const data = parse(row.data);
    const workflow = JSON.parse(row.workflowData || "{}");
    const run = data?.resultData?.runData || {};
    const selectedNodes = row.workflowId === "AffWaDelivery2026" ? Object.entries(run).filter(([name]) => importantDeliveryNodes.has(name)) : [];
    const definition = { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings };
    return { id: Number(row.id), workflow_id: row.workflowId, workflow_name: row.workflowName, status: row.status, mode: row.mode, started_at: row.startedAt, stopped_at: row.stoppedAt, workflow_version_id: workflow.versionId || "", workflow_active_version_id: workflow.activeVersionId || "", workflow_definition_sha256: workflow.nodes ? hash(definition) : "", last_node: data?.resultData?.lastNodeExecuted || "", error_node: data?.resultData?.error?.node?.name || "", error: data?.resultData?.error?.message || "", callback: row.workflowId === "AffWaWebhook2026" ? callbackStatus(data) : undefined, nodes: selectedNodes.map(([name, runs]) => nodeSummary(name, runs)) };
  });
  const deliveryRows = await all(`select e.*,d.data,w.name workflowName from execution_entity e join execution_data d on d."executionId"=e.id left join workflow_entity w on w.id=e."workflowId" where e."workflowId"='AffWaDelivery2026' and e."startedAt">='2026-08-24 08:47:00' order by cast(e.id as integer)`);
  const recent = deliveryRows.map((row) => {
    const data = parse(row.data); const run = data?.resultData?.runData || {};
    const candidates = Object.values(run).flatMap(outputItems);
    const item = candidates.find((value) => value.batch_number || value.original_batch_number) || {};
    return { id: Number(row.id), status: row.status, mode: row.mode, started_at: row.startedAt, stopped_at: row.stoppedAt, batch: item.batch_number || item.original_batch_number || "", username: item.username || item.tiktok_username || "", phone: item.whatsapp_number || item.wa_id || "", last_node: data?.resultData?.lastNodeExecuted || "", error_node: data?.resultData?.error?.node?.name || "", error: data?.resultData?.error?.message || "" };
  });
  process.stdout.write(JSON.stringify({ executions, recent_delivery_executions: recent }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }).finally(() => db.close());
