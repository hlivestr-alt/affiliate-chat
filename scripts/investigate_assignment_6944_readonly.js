"use strict";

const crypto = require("node:crypto");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const TARGET = { batch: "6944", phone: "6281910833031", username: "kerlinday01" };
const DEPLOYED_AT_UTC = "2026-08-24 08:47:00";

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
  const row = Array.isArray(values?.[0]) ? values[0] : (Array.isArray(item?.delivery_row_values) ? item.delivery_row_values : undefined);
  return {
    batch: item?.batch_number || item?.original_batch_number || item?.["Numbered Folder"] || "",
    username: item?.username || item?.tiktok_username || "",
    phone: item?.whatsapp_number || item?.wa_id || item?.recipient_number || "",
    conversation_id: item?.conversation_id || "",
    file_index: item?.file_index ?? "",
    file_name: item?.file_name || item?.name || "",
    delivery_key: item?.delivery_key || item?.source_reference || "",
    media_id: item?.media_id || body.id || "",
    wamid: item?.whatsapp_message_id || item?.message_id || item?.messages?.[0]?.id || body?.messages?.[0]?.id || "",
    state: item?.send_state || item?.delivery_state || item?.state || item?.status || "",
    attempts: item?.attempts ?? "",
    expected: item?.files_expected ?? item?.expected ?? "",
    sent: item?.files_sent ?? item?.sent ?? "",
    failed: item?.files_failed ?? item?.failed ?? "",
    remaining: item?.files_remaining ?? item?.remaining ?? "",
    error: item?.last_error || item?.error_message || (typeof item?.error === "string" ? item.error : "") || "",
    row_number: item?.row_number ?? item?.delivery_row_number ?? "",
    updated_range: item?.updatedRange || item?.updates?.updatedRange || "",
    updated_rows: item?.totalUpdatedRows ?? item?.updatedRows ?? item?.updates?.updatedRows ?? "",
    values_width: row ? row.length : "",
    values: row,
    selected_indexes: Array.isArray(item?.selected_files) ? item.selected_files.map((file) => file.file_index) : undefined,
    selected_files: Array.isArray(item?.selected_files) ? item.selected_files.map((file) => ({ file_index: file.file_index, file_name: file.file_name, delivery_key: file.delivery_key })) : undefined,
    raw_keys: Object.keys(item || {}).sort(),
  };
}
function summarize(row) {
  let data = {};
  let workflow = {};
  try { data = parse(row.data); } catch {}
  try { workflow = JSON.parse(row.workflowData || "{}"); } catch {}
  const runData = data?.resultData?.runData || {};
  const nodeNames = Object.keys(runData);
  const nodes = Object.entries(runData).map(([name, runs]) => ({
    name,
    run_count: runs.length,
    item_count: items(runs).length,
    outputs: items(runs).map(({ branch, json }) => ({ branch, ...compact(json) })),
    errors: runs.flatMap((run) => run?.error ? [{
      message: run.error.message || "",
      description: run.error.description || "",
      http_code: run.error.httpCode || "",
      cause: run.error.cause || "",
      context: run.error.context || "",
    }] : []),
  }));
  const definition = { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings };
  return {
    id: Number(row.id), workflow_id: row.workflowId, workflow_name: row.workflowName || workflow.name || "", status: row.status,
    mode: row.mode, started_at: row.startedAt, stopped_at: row.stoppedAt, retry_of: row.retryOf || "", retry_success_id: row.retrySuccessId || "",
    execution_version_id: workflow.versionId || "", execution_active_version_id: workflow.activeVersionId || "",
    execution_definition_sha256: workflow.nodes ? hash(definition) : "",
    last_node: data?.resultData?.lastNodeExecuted || "", error_node: data?.resultData?.error?.node?.name || "",
    error: data?.resultData?.error?.message || "", error_description: data?.resultData?.error?.description || "",
    source: data?.executionData?.runtimeData?.source || "", trigger_node: data?.executionData?.runtimeData?.triggerNode?.name || "",
    node_names: nodeNames, nodes,
  };
}

(async () => {
  const scopedRows = await all(`
    select e.*,d.data,d."workflowData",w.name workflowName
    from execution_entity e join execution_data d on d."executionId"=e.id
    left join workflow_entity w on w.id=e."workflowId"
    where d.data like ? or d.data like ? or d.data like ?
    order by cast(e.id as integer)
  `, [`%${TARGET.batch}%`, `%${TARGET.phone}%`, `%${TARGET.username}%`]);
  const scoped = scopedRows.map(summarize);
  const wamids = [...new Set(scoped.flatMap((execution) => execution.nodes.flatMap((node) => node.outputs.map((output) => output.wamid))).filter((value) => String(value).startsWith("wamid.")))];
  let callbackRows = [];
  if (wamids.length) {
    callbackRows = await all(`
      select e.*,d.data,d."workflowData",w.name workflowName
      from execution_entity e join execution_data d on d."executionId"=e.id
      left join workflow_entity w on w.id=e."workflowId"
      where ${wamids.map(() => "d.data like ?").join(" or ")}
      order by cast(e.id as integer)
    `, wamids.map((wamid) => `%${wamid}%`));
  }
  const recentDeliveryRows = await all(`
    select e.*,d.data,d."workflowData",w.name workflowName
    from execution_entity e join execution_data d on d."executionId"=e.id
    left join workflow_entity w on w.id=e."workflowId"
    where e."workflowId"='AffWaDelivery2026' and e."startedAt">=?
    order by cast(e.id as integer)
  `, [DEPLOYED_AT_UTC]);
  const open = await all(`select id,"workflowId",status,mode,"startedAt","stoppedAt","waitTill" from execution_entity where status in ('new','running','waiting') order by "startedAt"`);
  const workflowRows = await all(`select id,name,active,"versionId","activeVersionId",nodes,connections,settings,"updatedAt" from workflow_entity where id in ('AffWaWebhook2026','AffWaReply2026','AffWaDelivery2026') order by id`);
  const liveWorkflows = workflowRows.map((row) => {
    const workflow = { name: row.name, nodes: JSON.parse(row.nodes || "[]"), connections: JSON.parse(row.connections || "{}"), settings: JSON.parse(row.settings || "{}") };
    return { id: row.id, name: row.name, active: Boolean(row.active), version_id: row.versionId || "", active_version_id: row.activeVersionId || "", updated_at: row.updatedAt, definition_sha256: hash(workflow) };
  });
  process.stdout.write(JSON.stringify({ captured_at: new Date().toISOString(), target: TARGET, deployed_at_utc: DEPLOYED_AT_UTC, open_executions: open, live_workflows: liveWorkflows, scoped, callbacks: callbackRows.map(summarize), recent_delivery_executions: recentDeliveryRows.map(summarize) }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }).finally(() => db.close());
