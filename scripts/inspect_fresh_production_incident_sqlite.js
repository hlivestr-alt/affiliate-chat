"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const targets = [
  { batch: "6945", phone: "6287711806431", username: "hayrii17" },
  { batch: "6946", phone: "6287701496171", username: "romansa.ai" },
  { batch: "6947", phone: "6281395829301", username: "d.raynjayashowcase" },
];
const outputPath = process.argv[2] || "";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
function items(runs) {
  return (runs || []).flatMap((run) => (run?.data?.main || []).flatMap((branch, branchIndex) => (branch || []).map((item) => ({ branch: branchIndex, json: item?.json || {} }))));
}
function compact(item) {
  const body = item?.body && typeof item.body === "object" ? item.body : {};
  const values = Array.isArray(item?.values) ? item.values : undefined;
  const firstRow = Array.isArray(values?.[0]) ? values[0] : undefined;
  const selected = Array.isArray(item?.selected_files) ? item.selected_files : undefined;
  return {
    batch: item?.batch_number || item?.original_batch_number || item?.["Numbered Folder"] || "",
    username: item?.username || item?.tiktok_username || "",
    phone: item?.whatsapp_number || item?.wa_id || item?.recipient_number || "",
    conversation_id: item?.conversation_id || "",
    inbound_text: item?.inbound_text || item?.message_text || "",
    event_kind: item?.event_kind || "",
    callback_status: item?.callback_status || item?.status || "",
    file_index: item?.file_index ?? "",
    file_name: item?.file_name || item?.name || "",
    delivery_key: item?.delivery_key || item?.source_reference || "",
    media_id: item?.media_id || body.id || "",
    wamid: item?.whatsapp_message_id || item?.message_id || item?.messages?.[0]?.id || body?.messages?.[0]?.id || "",
    state: item?.send_state || item?.delivery_state || item?.state || "",
    attempts: item?.attempts ?? "",
    expected: item?.files_expected ?? item?.expected ?? "",
    sent: item?.files_sent ?? item?.sent ?? "",
    failed: item?.files_failed ?? item?.failed ?? "",
    remaining: item?.files_remaining ?? item?.remaining ?? "",
    row_number: item?.delivery_log_row_number ?? item?.delivery_row_number ?? item?.row_number ?? "",
    updated_range: item?.updatedRange || item?.updates?.updatedRange || "",
    updated_rows: item?.totalUpdatedRows ?? item?.updatedRows ?? item?.updates?.updatedRows ?? "",
    values_rows: values?.length ?? "",
    values_width: firstRow?.length ?? "",
    error: item?.last_error || item?.error_message || (typeof item?.error === "string" ? item.error : "") || "",
    selected_files: selected?.map((file) => ({ file_index: file.file_index, file_name: file.file_name, delivery_key: file.delivery_key })),
  };
}
function summarize(row) {
  let data = {}, workflow = {};
  try { data = parse(row.data); } catch {}
  try { workflow = JSON.parse(row.workflowData || "{}"); } catch {}
  const run = data?.resultData?.runData || {};
  const definition = { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings };
  return {
    id: Number(row.id), workflow_id: row.workflowId, workflow_name: row.workflowName || workflow.name || "", status: row.status,
    mode: row.mode, started_at: row.startedAt, stopped_at: row.stoppedAt, wait_till: row.waitTill || "",
    retry_of: row.retryOf || "", retry_success_id: row.retrySuccessId || "",
    workflow_version_id: workflow.versionId || row.workflowVersionId || "",
    workflow_active_version_id: workflow.activeVersionId || "",
    workflow_definition_sha256: workflow.nodes ? hash(definition) : "",
    last_node: data?.resultData?.lastNodeExecuted || "", error_node: data?.resultData?.error?.node?.name || "",
    error: data?.resultData?.error?.message || "", error_description: data?.resultData?.error?.description || "",
    source: data?.executionData?.runtimeData?.source || "", trigger_node: data?.executionData?.runtimeData?.triggerNode?.name || "",
    nodes: Object.entries(run).map(([name, runs]) => ({
      name, run_count: runs.length, item_count: items(runs).length,
      outputs: items(runs).map(({ branch, json }) => ({ branch, ...compact(json) })),
      errors: runs.flatMap((entry) => entry?.error ? [{ message: entry.error.message || "", description: entry.error.description || "", http_code: entry.error.httpCode || "" }] : []),
    })),
  };
}

(async () => {
  const scoped = {};
  for (const target of targets) {
    const rows = await all(`
      select e.*,d.data,d."workflowData",w.name workflowName
      from execution_entity e join execution_data d on d."executionId"=e.id
      left join workflow_entity w on w.id=e."workflowId"
      where d.data like ? or d.data like ? or d.data like ?
      order by cast(e.id as integer)
    `, [`%${target.batch}%`, `%${target.phone}%`, `%${target.username}%`]);
    scoped[target.batch] = rows.map(summarize);
  }
  const wamids = [...new Set(Object.values(scoped).flat().flatMap((execution) => execution.nodes.flatMap((node) => node.outputs.map((item) => item.wamid))).filter((value) => String(value).startsWith("wamid.")))];
  let callbackRows = [];
  if (wamids.length) callbackRows = await all(`
    select e.*,d.data,d."workflowData",w.name workflowName
    from execution_entity e join execution_data d on d."executionId"=e.id
    left join workflow_entity w on w.id=e."workflowId"
    where ${wamids.map(() => "d.data like ?").join(" or ")}
    order by cast(e.id as integer)
  `, wamids.map((wamid) => `%${wamid}%`));
  const open = await all(`select id,"workflowId",status,mode,"startedAt","stoppedAt","waitTill" from execution_entity where status in ('new','running','waiting') order by "startedAt"`);
  const recent = await all(`
    select e.*,d.data,d."workflowData",w.name workflowName
    from execution_entity e join execution_data d on d."executionId"=e.id
    left join workflow_entity w on w.id=e."workflowId"
    where e."workflowId" in ('AffWaWebhook2026','AffWaReply2026','AffWaDelivery2026','ecBB2oa6xeY2knFu','m1KBWKOLjwxbtFPP')
      and e."startedAt">='2026-08-24 09:30:00'
    order by cast(e.id as integer)
  `);
  const output = { captured_at: new Date().toISOString(), targets, open_executions: open, scoped, wamids, callbacks: callbackRows.map(summarize), recent_in_scope: recent.map(summarize) };
  const json = JSON.stringify(output, null, 2) + "\n";
  if (outputPath) fs.writeFileSync(outputPath, json, { mode: 0o600 });
  const concise = Object.fromEntries(Object.entries(scoped).map(([batch, executions]) => [batch, executions.map((execution) => ({
    id: execution.id, workflow_id: execution.workflow_id, workflow_name: execution.workflow_name, status: execution.status,
    started_at: execution.started_at, stopped_at: execution.stopped_at, workflow_version_id: execution.workflow_version_id,
    workflow_definition_sha256: execution.workflow_definition_sha256, last_node: execution.last_node, error_node: execution.error_node,
    error: execution.error, node_names: execution.nodes.map((node) => node.name),
  }))]));
  process.stdout.write(JSON.stringify({ captured_at: output.captured_at, open_executions: open, scoped: concise, wamids, callback_execution_ids: callbackRows.map((row) => Number(row.id)), recent_in_scope_ids: recent.map((row) => Number(row.id)) }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }).finally(() => db.close());
