"use strict";

const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);

function items(runs) {
  const result = [];
  for (const run of runs || []) for (const branch of run?.data?.main || []) for (const item of branch || []) result.push(item?.json || {});
  return result;
}

function select(item) {
  return {
    conversation_id: item.conversation_id || "",
    username: item.username || item.tiktok_username || "",
    phone: item.whatsapp_number || item.wa_id || item.recipient_number || "",
    batch: item.batch_number || "",
    index: item.file_index || "",
    file: item.file_name || "",
    key: item.delivery_key || item.source_reference || "",
    media_id: item.media_id || "",
    wamid: item.whatsapp_message_id || item.messages?.[0]?.id || "",
    state: item.delivery_state || item.send_state || item.state || item.api_status || "",
    error: item.error || item.last_error || item.error_message || item.error_details || "",
    spreadsheet_id: item.spreadsheetId || "",
    updated_rows: item.totalUpdatedRows || item.updates?.updatedRows || "",
    updated_range: item.updatedRange || item.updates?.updatedRange || "",
    message_count: item.message_count || "",
    result_count: Array.isArray(item.results) ? item.results.length : ""
  };
}

const wanted = /Executed after Opt-in|Restore and Validate Delivery Context|Prepare Resumable Delivery Items|Prepare Batch Send Claims|Batch Write Pre-Send Claims|Send WhatsApp Video|Prepare Batched Delivery Tracking|Batch Write Delivery Results|Append Message Results Batch|Prepare Cached Delivery Summary|Update Final Send State|Done: Delivery Send Attempt/i;

db.all(`select e.id,e.status,e."startedAt",e."stoppedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where e."workflowId"='AffWaDelivery2026' order by cast(e.id as integer) desc limit 40`, [], (error, rows) => {
  if (error) throw error;
  const output = rows.map((row) => {
    let data = {};
    try { data = parse(row.data); } catch {}
    const runData = data?.resultData?.runData || {};
    const trigger = select(items(runData["When Executed after Opt-in"])[0] || {});
    const context = select(items(runData["Restore and Validate Delivery Context"])[0] || {});
    const selected = items(runData["Prepare Resumable Delivery Items"]).map(select);
    const sends = items(runData["Send WhatsApp Video"]).map(select);
    const batchTracking = items(runData["Prepare Batched Delivery Tracking"]).map(select);
    const nodeResult = (name) => {
      const runs = runData[name] || [];
      return {
        executed: runs.length > 0,
        runs: runs.length,
        outputs: items(runs).map(select),
        errors: runs.map((run) => ({ message: run?.error?.message || "", description: run?.error?.description || "", http_code: run?.error?.httpCode || "", timestamp: run?.error?.timestamp || "" })).filter((entry) => entry.message || entry.description)
      };
    };
    const finalError = data?.resultData?.error || {};
    return {
      id: row.id,
      status: row.status,
      started_at: row.startedAt,
      stopped_at: row.stoppedAt,
      phone: context.phone || trigger.phone,
      username: context.username || trigger.username,
      batch: context.batch || trigger.batch,
      selected_count: selected.length,
      selected_indices: selected.map((item) => item.index),
      send_attempts: (runData["Send WhatsApp Video"] || []).length,
      accepted_wamids: sends.map((item) => item.wamid).filter(Boolean),
      send_errors: sends.map((item) => item.error).filter(Boolean),
      tracking_result_count: batchTracking[0]?.result_count || 0,
      pre_send_claim_write: nodeResult("Batch Write Pre-Send Claims"),
      delivery_batch_write: nodeResult("Batch Write Delivery Results"),
      message_batch_write: nodeResult("Append Message Results Batch"),
      final_lead_write: nodeResult("Update Final Send State"),
      last_node: data?.resultData?.lastNodeExecuted || "",
      error_node: finalError?.node?.name || "",
      error: finalError?.message || ""
    };
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  db.close();
});
