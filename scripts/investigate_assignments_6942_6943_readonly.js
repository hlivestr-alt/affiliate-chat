"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));

const targets = [
  { batch: "6942", phone: "6288989724987", username: "ty60071", deliveryIds: [24798, 24812] },
  { batch: "6943", phone: "6288907038448", username: "spill__by.nisa", deliveryIds: [24957] },
];

const interesting = /Assignment|Logger|Delivery|Message Log|Upload|Media|Send|WAMID|Claim|Read-back|Read Delivery Row|Validate Immediate|Batched|Final|Loop|Recovery|Webhook|Reply|Lead|State/i;
const text = (value) => value == null ? "" : String(value);
function nodeItems(runs) {
  return (runs || []).flatMap((run) => (run?.data?.main || []).flatMap((branch, branchIndex) => (branch || []).map((item) => ({ branch: branchIndex, json: item?.json || {} }))));
}
function compact(value) {
  const item = value || {};
  const response = item.body && typeof item.body === "object" ? item.body : {};
  return {
    conversation_id: item.conversation_id || "",
    username: item.username || item.tiktok_username || "",
    phone: item.whatsapp_number || item.wa_id || item.recipient_number || "",
    batch: item.batch_number || item.original_batch_number || item["Numbered Folder"] || "",
    index: item.file_index ?? "",
    file: item.file_name || item.name || "",
    delivery_key: item.delivery_key || item.source_reference || "",
    media_id: item.media_id || response.id || "",
    wamid: item.whatsapp_message_id || item.message_id || item.messages?.[0]?.id || response.messages?.[0]?.id || "",
    state: item.send_state || item.delivery_state || item.state || item.status || "",
    attempts: item.attempts ?? "",
    expected: item.files_expected ?? item.expected ?? "",
    sent: item.files_sent ?? item.sent ?? "",
    failed: item.files_failed ?? item.failed ?? "",
    remaining: item.files_remaining ?? item.remaining ?? "",
    error: item.last_error || item.error || item.error_message || "",
    row_number: item.row_number ?? item.delivery_row_number ?? "",
    updated_rows: item.totalUpdatedRows ?? item.updatedRows ?? item.updates?.updatedRows ?? "",
    updated_range: item.updatedRange || item.updates?.updatedRange || "",
    values: Array.isArray(item.values) ? item.values : undefined,
  };
}
function summarizeExecution(row) {
  let data = {};
  try { data = parse(row.data); } catch {}
  const run = data?.resultData?.runData || {};
  const nodes = Object.entries(run).filter(([name]) => interesting.test(name)).map(([name, runs]) => ({
    name,
    run_count: runs.length,
    item_count: nodeItems(runs).length,
    outputs: nodeItems(runs).map(({ branch, json }) => ({ branch, ...compact(json) })),
    errors: runs.flatMap((entry) => entry?.error ? [{ message: entry.error.message || "", description: entry.error.description || "", http_code: entry.error.httpCode || "" }] : []),
  }));
  return {
    id: Number(row.id), workflow_id: row.workflowId, workflow_name: row.workflowName || "", status: row.status,
    mode: row.mode, started_at: row.startedAt, stopped_at: row.stoppedAt, wait_till: row.waitTill || "",
    last_node: data?.resultData?.lastNodeExecuted || "", error_node: data?.resultData?.error?.node?.name || "",
    error: data?.resultData?.error?.message || "", source: data?.executionData?.runtimeData?.source || "",
    trigger_node: data?.executionData?.runtimeData?.triggerNode?.name || "", node_names: Object.keys(run), nodes,
  };
}
function snapshotFor(row) {
  let workflow = {};
  try { workflow = JSON.parse(row.workflowData || "{}"); } catch {}
  const nodes = workflow.nodes || [];
  const selected = nodes.filter((node) => /In-Flight|Immediate Successful|Read Delivery Row|Validate Immediate|Loop Through Files|Batched Delivery|Final Log|Assignment Start|Assignment Final|Log Assignment|Delivery Tracking|Final Send State/i.test(node.name));
  const names = new Set(selected.map((node) => node.name));
  for (const [source, branches] of Object.entries(workflow.connections || {})) {
    if (names.has(source)) continue;
    const destinations = (branches?.main || []).flatMap((branch) => branch || []).map((edge) => edge.node);
    if (destinations.some((name) => names.has(name))) names.add(source);
  }
  return {
    execution_id: Number(row.id), workflow_id: row.workflowId, workflow_name: workflow.name || "",
    nodes: nodes.filter((node) => names.has(node.name)).map((node) => ({ name: node.name, type: node.type, disabled: node.disabled === true, on_error: node.onError || "", continue_on_fail: node.continueOnFail === true, parameters: node.parameters })),
    connections: Object.fromEntries(Object.entries(workflow.connections || {}).filter(([source]) => names.has(source)).map(([source, value]) => [source, value])),
  };
}

(async () => {
  const columns = await all("pragma table_info(execution_entity)");
  const scoped = {};
  for (const target of targets) {
    const rows = await all(`
      select e.*,d.data,d."workflowData",w.name workflowName
      from execution_entity e join execution_data d on d."executionId"=e.id
      left join workflow_entity w on w.id=e."workflowId"
      where d.data like ? or d.data like ? or d.data like ?
      order by cast(e.id as integer)
    `, [`%${target.batch}%`, `%${target.phone}%`, `%${target.username}%`]);
    scoped[target.batch] = rows.map(summarizeExecution);
  }
  const deliveryRows = await all(`
    select e.*,d.data,d."workflowData",w.name workflowName
    from execution_entity e join execution_data d on d."executionId"=e.id
    left join workflow_entity w on w.id=e."workflowId"
    where e.id in (24798,24812,24957) order by cast(e.id as integer)
  `);
  const open = await all(`select id,"workflowId",status,mode,"startedAt","stoppedAt","waitTill" from execution_entity where status in ('new','running','waiting') order by "startedAt"`);
  const workflowRows = await all(`select id,name,active,"activeVersionId",nodes,connections,settings,"updatedAt" from workflow_entity where id in ('AffWaWebhook2026','AffWaReply2026','AffWaDelivery2026') or name like '%Recovery%' or name like '%Assignment%Log%' order by name`);
  const workflowSummary = workflowRows.map((row) => {
    const nodes = JSON.parse(row.nodes || "[]");
    return {
      id: row.id,
      name: row.name,
      active: Boolean(row.active),
      active_version_id: row.activeVersionId || "",
      updated_at: row.updatedAt,
      node_names: nodes.map((node) => node.name),
      credential_references: nodes.flatMap((node) => Object.entries(node.credentials || {}).map(([type, credential]) => ({ node: node.name, type, id: credential.id || "", name: credential.name || "" }))),
    };
  });
  const executionMetadataSchema = await all("pragma table_info(execution_metadata)").catch(() => []);
  const relevantMetadata = executionMetadataSchema.length ? await all(`select * from execution_metadata where "executionId" in (select id from execution_entity where id between 24750 and 25000) order by "executionId"`).catch(() => []) : [];
  const output = {
    captured_at: new Date().toISOString(),
    execution_entity_columns: columns.map((column) => column.name),
    open_executions: open,
    scoped,
    delivery_execution_snapshots: deliveryRows.map(snapshotFor),
    workflows: workflowSummary,
    execution_metadata_schema: executionMetadataSchema.map((column) => column.name),
    relevant_execution_metadata: relevantMetadata,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}).finally(() => db.close());
