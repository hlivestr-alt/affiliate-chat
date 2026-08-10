"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));

function itemsFor(runs) {
  const result = [];
  for (const run of runs || []) {
    for (const branch of run?.data?.main || []) {
      for (const item of branch || []) result.push(item?.json || {});
    }
  }
  return result;
}

function compact(item) {
  const source = item?.body?.data ? item.body.data : item;
  const content = (() => {
    try { return JSON.parse(source?.content || "{}"); } catch { return {}; }
  })();
  return {
    conversation_id: source?.conversation_id || item?.conversation_id || "",
    username: item?.username || item?.tiktok_username || "",
    whatsapp_number: item?.whatsapp_number || item?.wa_id || item?.recipient_number || "",
    message_id: source?.message_id || item?.message_id || item?.whatsapp_message_id || "",
    inbound_text: item?.inbound_text || content?.content || item?.message_text || "",
    action: item?.action || "",
    state: item?.state || item?.send_state || item?.delivery_state || "",
    batch_number: item?.batch_number || "",
    file_index: item?.file_index || "",
    file_name: item?.file_name || "",
    delivery_key: item?.delivery_key || item?.source_reference || "",
    whatsapp_message_id: item?.whatsapp_message_id || item?.messages?.[0]?.id || "",
    reason: item?.reason || item?.queue_reason || item?.last_error || item?.error || ""
  };
}

(async () => {
  const requested = process.argv.slice(2).map(Number).filter(Number.isInteger);
  const where = requested.length ? `where e.id in (${requested.map(() => "?").join(",")})` : `where e."startedAt" >= datetime('now','-2 days')`;
  const rows = await all(`select e.id,e.status,e."workflowId",w.name,e."startedAt",e."stoppedAt",e.mode,d.data,d."workflowData" from execution_entity e left join workflow_entity w on w.id=e."workflowId" left join execution_data d on d."executionId"=e.id ${where} order by cast(e.id as integer)`, requested);
  const output = rows.map((row) => {
    let data = {};
    try { data = parse(row.data); } catch {}
    const runData = data?.resultData?.runData || {};
    const nodes = Object.entries(runData).map(([name, runs]) => ({
      name,
      runs: runs.length,
      outputs: itemsFor(runs).map(compact).filter((item) => Object.values(item).some(Boolean)),
      errors: runs.map((run) => ({
        message: run?.error?.message || "",
        description: run?.error?.description || "",
        http_code: run?.error?.httpCode || "",
        timestamp: run?.error?.timestamp || ""
      })).filter((error) => error.message || error.description)
    }));
    const error = data?.resultData?.error || {};
    return {
      id: row.id,
      workflow_id: row.workflowId,
      workflow_name: row.name || "",
      active_snapshot: (() => { try { return Boolean(JSON.parse(row.workflowData || "{}").active); } catch { return false; } })(),
      status: row.status,
      mode: row.mode,
      started_at: row.startedAt,
      stopped_at: row.stoppedAt,
      last_node: data?.resultData?.lastNodeExecuted || "",
      error_node: error?.node?.name || "",
      error: error?.message || "",
      source: data?.executionData?.runtimeData?.source || "",
      trigger_node: data?.executionData?.runtimeData?.triggerNode?.name || "",
      nodes
    };
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  db.close();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  db.close();
  process.exitCode = 1;
});
