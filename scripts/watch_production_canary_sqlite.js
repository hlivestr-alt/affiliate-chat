"use strict";

const crypto = require("node:crypto");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const baseline = Number(process.argv[2] || 0);
const pollMs = Number(process.argv[3] || 2000);
const workflowIds = ["AffWaWebhook2026", "AffWaReply2026", "AffWaDelivery2026", "ecBB2oa6xeY2knFu", "m1KBWKOLjwxbtFPP"];
const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const seen = new Map();

function items(runs) {
  const output = [];
  for (const run of runs || []) for (const branch of run?.data?.main || []) for (const item of branch || []) output.push(item?.json || {});
  return output;
}

function text(value) { return value == null ? "" : String(value).trim(); }
function redactPhone(value) {
  const digits = text(value).replace(/\D/g, "");
  return digits.length > 6 ? `${digits.slice(0, 3)}***${digits.slice(-4)}` : digits;
}

function summarize(row) {
  let data = {};
  try { data = parse(row.data || ""); } catch {}
  const runData = data?.resultData?.runData || {};
  const allItems = Object.values(runData).flatMap(items);
  const identity = allItems.find((value) => value.batch_number || value.username || value.whatsapp_number || value.wa_id) || {};
  const parsed = items(runData["Parse Video Send"]);
  const confirmed = items(runData["Confirm Successful Clip Durable"]);
  const claimed = items(runData["Restore Clip after In-Flight Claim"]);
  const uploads = [...items(runData["Parse Media Upload"]), ...items(runData["Restore Existing Media Upload"])];
  const aggregate = items(runData["Prepare Assignment Final Log"]);
  const reservation = items(runData["Select and Prepare Batch Reservation"])[0] || {};
  const deliveryItems = items(runData["Prepare Resumable Delivery Items"]);
  return {
    id: Number(row.id),
    workflow_id: row.workflowId,
    workflow_name: row.workflow_name,
    status: row.status,
    mode: row.mode,
    started_at: row.startedAt,
    stopped_at: row.stoppedAt,
    last_node: data?.resultData?.lastNodeExecuted || "",
    error: data?.resultData?.error ? { message: data.resultData.error.message || "", node: data.resultData.error.node?.name || "" } : null,
    identity: {
      username: text(identity.username || reservation.username),
      whatsapp_number: redactPhone(identity.whatsapp_number || identity.wa_id || reservation.whatsapp_number || reservation.wa_id),
      conversation_id: text(identity.conversation_id || reservation.conversation_id),
      folder: text(identity.batch_number || reservation.batch_number)
    },
    fresh_evidence: {
      reservation_existing_batch_before_selection: text(reservation.existing_batch || ""),
      reservation_ok: reservation.reservation_ok,
      resumable_items_outputs: deliveryItems.length,
      remaining_count: deliveryItems[0]?.remaining_count ?? deliveryItems[0]?.files_remaining ?? ""
    },
    counts: {
      claim: claimed.length,
      upload_or_cache: uploads.length,
      meta_send: parsed.filter((value) => value.send_success === true && text(value.whatsapp_message_id)).length,
      durable_confirmation: confirmed.filter((value) => value.immediate_persistence_verified === true).length,
      start_log_dispatch: items(runData["Log Assignment Start (Nonblocking)"]).length,
      prepare_final_log: aggregate.length,
      final_log_dispatch: items(runData["Log Assignment Final (Nonblocking)"]).length
    },
    clips: parsed.map((value) => ({
      index: Number(value.file_index || 0),
      file_name: text(value.file_name),
      upload_or_cache_ok: Boolean(value.media_id),
      send_success: value.send_success === true,
      wamid: text(value.whatsapp_message_id),
      attempts: Number(value.attempts || 0),
      durable: confirmed.some((item) => Number(item.file_index) === Number(value.file_index) && text(item.whatsapp_message_id) === text(value.whatsapp_message_id) && item.immediate_persistence_verified === true)
    })),
    aggregate: aggregate.map((value) => ({ expected: Number(value.files_expected || 0), sent: Number(value.files_sent || 0), failed: Number(value.files_failed || 0), delivery_state: text(value.delivery_state), conversation_state: text(value.state), last_intent: text(value.last_intent) })),
    node_runs: Object.fromEntries(Object.entries(runData).map(([name, runs]) => [name, runs.length]))
  };
}

async function poll() {
  const placeholders = workflowIds.map(() => "?").join(",");
  const rows = await all(`
    select e.id,e."workflowId",coalesce(w.name,'') workflow_name,e.status,e.mode,e."startedAt",e."stoppedAt",d.data
    from execution_entity e
    left join workflow_entity w on w.id=e."workflowId"
    left join execution_data d on d."executionId"=e.id
    where cast(e.id as integer)>? and e."workflowId" in (${placeholders})
    order by cast(e.id as integer)
  `, [baseline, ...workflowIds]);
  for (const row of rows) {
    const summary = summarize(row);
    const signature = crypto.createHash("sha256").update(JSON.stringify(summary)).digest("hex");
    if (seen.get(summary.id) !== signature) {
      seen.set(summary.id, signature);
      process.stdout.write(JSON.stringify({ observed_at: new Date().toISOString(), execution: summary }) + "\n");
    }
  }
}

process.stdout.write(JSON.stringify({ watcher_started_at: new Date().toISOString(), baseline, poll_ms: pollMs }) + "\n");
const timer = setInterval(() => poll().catch((error) => process.stdout.write(JSON.stringify({ observed_at: new Date().toISOString(), watcher_error: error.message }) + "\n")), pollMs);
poll().catch((error) => process.stdout.write(JSON.stringify({ observed_at: new Date().toISOString(), watcher_error: error.message }) + "\n"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { clearInterval(timer); db.close(); process.exit(0); });
