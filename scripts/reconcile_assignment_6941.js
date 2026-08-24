"use strict";

const fs = require("node:fs");
const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");
const { parse } = require("/usr/local/lib/node_modules/n8n/node_modules/flatted");

const APPLY = process.argv.includes("--apply");
const CREDENTIAL_PATH = process.argv.find((arg) => arg.startsWith("--credential="))?.slice(13) || "/tmp/recovery-6941-google-credential.json";
const OUTPUT_PATH = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) || "/tmp/assignment-6941-reconciliation.json";
const SPREADSHEET_ID = process.env.AFFILIATE_TRACKER_SPREADSHEET_ID;
const BATCH = "6941";
const PHONE = "6282225211568";
const USERNAME = "jenius_abnormal";
const CONVERSATION = `wa:${PHONE}`;
const EXECUTION_ID = 24316;
const DELIVERY_HEADERS = ["delivery_key","conversation_id","whatsapp_number","batch_number","file_index","file_name","media_id","whatsapp_message_id","state","attempts","uploaded_at","sent_at","delivered_at","failed_at","last_error","updated_at","send_state","delivery_state"];
const MESSAGE_HEADERS = ["whatsapp_message_id","recipient_number","message_type","template_name","source_workflow","source_reference","api_status","accepted_at","current_status","status_timestamp","conversation_json","pricing_json","errors_json","error_code","error_title","error_message","error_details","processed_statuses","status_history_json","updated_at","direction","message_payload_json","send_state","delivery_state"];

const ORIGINAL_FILES = [
  "2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0005_v5_transitional_bb_score9_STEP_SKINCARE_TANPA_RIBET.mp4",
  "2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0008_v2_transitional_hook_score9_SETELAH_RUTIN,_TAMPAK_LEBIH_SAMAR.mp4",
  "2026_06_12_15_06_39_run_191__2026_06_12_15_06_39_run_191_clip_0010_v4_b_roll_only_score8_STEP_SKINCARE_TANPA_RIBET.mp4",
  "2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0002_v3_black_bars_score9_COBA_STEP_UNTUK_GLOWING.mp4",
  "2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0010_v4_b_roll_only_score9_SEKARANG_TAMPAK_LEBIH_SAMAR.mp4",
  "2026_06_13_11_05_46_run_191__2026_06_13_11_05_46_run_191_clip_0015_v0_original_score8_STEP_SKINCARE_TANPA_RIBET.mp4",
  "2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0007_v3_black_bars_score9_SEKARANG_TERASA_LEBIH_LEMBAP.mp4",
  "2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0012_v0_original_score9_SEKARANG_TERASA_LEBIH_HALUS.mp4",
  "2026_07_02_10_32_02_002_run_191__2026_07_02_10_32_02_002_run_191_clip_0013_v1_b_roll_hook_broll_score9_KULIT_KUSAM_TAMPAK_LEBIH_CERAH.mp4",
  "2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0001_v0_original_score9_NODANYA_MAKIN_SAMAR.mp4",
  "2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0005_v2_transitional_hook_score9_KULIT_TAMPAK_LEBIH_CERAH.mp4",
  "2026_07_02_15_04_18_run_191__2026_07_02_15_04_18_run_191_clip_0006_v4_b_roll_only_score9_COBA_STEP_UNTUK_CERAH.mp4",
  "2026_07_03_10_25_17_run_191__2026_07_03_10_25_17_run_191_clip_0001_v1_b_roll_hook_broll_score9_RUTIN_PAKAI_BIAR_TERASA_LEBIH_LEMBAP.mp4",
  "2026_07_03_10_25_17_run_191__2026_07_03_10_25_17_run_191_clip_0002_v1_b_roll_hook_broll_score9_BIAR_KULIT_TAMPAK_FRESH.mp4",
  "2026_07_03_10_25_17_run_191__2026_07_03_10_25_17_run_191_clip_0003_v0_original_score9_TAMPILAN_BEKAS_JERAWAT_CEK_STEP_INI.mp4",
];

const HISTORICAL = [
  { index: 1, media_id: "2158036705124336", message_id: "wamid.HBgNNjI4MjIyNTIxMTU2OBUCABEYEjZBOUZCQzI0NEI0ODY5RjExMAA=", uploaded_at: "2026-08-21T07:40:37.351Z", sent_at: "2026-08-21T07:40:41.615Z" },
  { index: 2, media_id: "2949129135437516", message_id: "wamid.HBgNNjI4MjIyNTIxMTU2OBUCABEYEjVGMzREMEIyMDY1NzRDRTg0NAA=", uploaded_at: "2026-08-21T07:40:56.587Z", sent_at: "2026-08-21T07:40:59.944Z" },
  { index: 3, media_id: "1619875776425073", message_id: "wamid.HBgNNjI4MjIyNTIxMTU2OBUCABEYEjkzOEVDRTc5MTI2OTA5REM3RgA=", uploaded_at: "2026-08-21T07:41:14.621Z", sent_at: "2026-08-21T07:41:19.871Z" },
  { index: 4, media_id: "1060607070170985", message_id: "wamid.HBgNNjI4MjIyNTIxMTU2OBUCABEYEjhBOTAwRjQ1ODMzQ0UxQTJCQQA=", uploaded_at: "2026-08-21T07:41:33.980Z", sent_at: "2026-08-21T07:41:38.267Z" },
].map((record) => ({ ...record, file_name: ORIGINAL_FILES[record.index - 1], delivery_key: `${CONVERSATION}:${BATCH}:${ORIGINAL_FILES[record.index - 1]}` }));
const CLIP5 = { index: 5, file_name: ORIGINAL_FILES[4], delivery_key: `${CONVERSATION}:${BATCH}:${ORIGINAL_FILES[4]}`, media_id: "1036446072487271", uploaded_at: "2026-08-21T07:41:52.778Z" };

function text(value) { return value == null ? "" : String(value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ""); }
function user(value) { return text(value).normalize("NFKC").replace(/^@+/, "").toLowerCase(); }
function table(values) {
  const headers = (values?.[0] || []).map(text);
  return { headers, rows: (values || []).slice(1).map((row, index) => ({ row_number: index + 2, ...Object.fromEntries(headers.map((name, column) => [name, text(row[column])])) })).filter((row) => Object.entries(row).some(([key, value]) => key !== "row_number" && value)) };
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function sameArray(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }

async function token() {
  const exported = JSON.parse(fs.readFileSync(CREDENTIAL_PATH, "utf8"));
  assert(Array.isArray(exported) && exported.length === 1, "credential_export_invalid");
  const data = exported[0].data || {};
  const oauth = typeof data.oauthTokenData === "string" ? JSON.parse(data.oauthTokenData) : data.oauthTokenData;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: data.clientId, client_secret: data.clientSecret, refresh_token: oauth.refresh_token, grant_type: "refresh_token" }) });
  const body = await response.json();
  assert(response.ok && body.access_token, `oauth_refresh_failed_${response.status}`);
  return body.access_token;
}

async function google(url, accessToken, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`google_api_${response.status}:${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : {};
}

async function readSheets(accessToken) {
  const ranges = ["WhatsApp Leads!A:AE", "Affiliate Assignments!A:M", "Delivery Log!A:R", "WhatsApp Message Log!A:X"];
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
  const body = await google(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${query}&majorDimension=ROWS`, accessToken);
  return Object.fromEntries(ranges.map((range, index) => [range.split("!")[0], table(body.valueRanges?.[index]?.values || [])]));
}

function sqliteAll(db, sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))); }
async function executionGates() {
  const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);
  try {
    const open = await sqliteAll(db, `select e.id,e."workflowId",e.status from execution_entity e join execution_data d on d."executionId"=e.id where e.status in ('new','running','waiting') and (d.data like ? or d.data like ? or d.data like ?) order by cast(e.id as integer)`, [`%${CONVERSATION}:${BATCH}:%`, `%${PHONE}%`, `%${USERNAME}%`]);
    const later = await sqliteAll(db, `select e.id,e."workflowId",e.status,e."startedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where cast(e.id as integer)>? and d.data like ? order by cast(e.id as integer)`, [EXECUTION_ID, `%${CONVERSATION}:${BATCH}:%`]);
    const laterSendExecutions = [];
    for (const row of later) {
      const run = parse(row.data)?.resultData?.runData || {};
      const sends = [...(run["Parse Video Send"] || []), ...(run["Send WhatsApp Video"] || [])];
      if (sends.length) laterSendExecutions.push({ id: String(row.id), workflow_id: row.workflowId, status: row.status, started_at: row.startedAt });
    }
    const callbackEvidence = {};
    for (const historical of HISTORICAL) {
      const rows = await sqliteAll(db, `select e.id,e."workflowId",e.status,e."startedAt",d.data from execution_entity e join execution_data d on d."executionId"=e.id where d.data like ? order by cast(e.id as integer)`, [`%${historical.message_id}%`]);
      const callbacks = [];
      for (const row of rows) {
        const run = parse(row.data)?.resultData?.runData || {};
        for (const entry of run["Verify and Parse WhatsApp Webhook"] || []) {
          for (const branch of entry?.data?.main || []) for (const item of branch || []) {
            const value = item.json || {};
            if (value.event_kind === "status" && value.whatsapp_message_id === historical.message_id) callbacks.push({ execution_id: String(row.id), status: value.delivery_status, recipient: digits(value.whatsapp_number || value.raw_event?.recipient_id), timestamp: text(value.whatsapp_timestamp) });
          }
        }
      }
      callbackEvidence[historical.message_id] = callbacks;
    }
    return { open, laterSendExecutions, callbackEvidence };
  } finally { db.close(); }
}

function validate(tables, executions) {
  const leads = tables["WhatsApp Leads"].rows;
  const assignments = tables["Affiliate Assignments"].rows;
  const delivery = tables["Delivery Log"].rows;
  const messages = tables["WhatsApp Message Log"].rows;
  const owners = leads.filter((row) => row.batch_number === BATCH);
  assert(executions.open.length === 0, "active_scoped_execution_exists");
  assert(executions.laterSendExecutions.length === 0, "later_folder_send_execution_exists");
  assert(owners.length === 1 && digits(owners[0].wa_id || owners[0].whatsapp_number) === PHONE && user(owners[0].username) === user(USERNAME), "folder_owner_mismatch");
  const historicalOwners = assignments.filter((row) => row.original_batch_number === BATCH || row.batch_number === BATCH);
  assert(historicalOwners.every((row) => (!row.conversation_id || row.conversation_id === CONVERSATION) && (!row.username || user(row.username) === user(USERNAME))), "historical_owner_conflict");
  const disk = fs.readdirSync(`/clips_whatsapp/${BATCH}`, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  assert(sameArray(disk, ORIGINAL_FILES), "disk_files_do_not_match_execution_24316");
  const rows = delivery.filter((row) => row.batch_number === BATCH && row.conversation_id === CONVERSATION).sort((a, b) => Number(a.file_index) - Number(b.file_index));
  assert(rows.length === 15 && sameArray(rows.map((row) => row.file_name), ORIGINAL_FILES), "canonical_clip_claims_do_not_match_execution_24316");
  assert(new Set(HISTORICAL.map((row) => row.message_id)).size === 4, "historical_message_ids_not_unique");
  for (const historical of HISTORICAL) {
    const callbacks = executions.callbackEvidence[historical.message_id] || [];
    assert(callbacks.some((callback) => callback.recipient === PHONE && ["sent", "delivered", "read"].includes(callback.status)), `callback_not_corroborated_clip_${historical.index}`);
    const row = rows[historical.index - 1];
    const alreadyExact = row.whatsapp_message_id === historical.message_id && row.media_id === historical.media_id && row.state === "accepted" && row.send_state === "accepted" && Number(row.attempts) === 1;
    assert(alreadyExact || (!row.whatsapp_message_id && !row.media_id && row.state === "send_prepared" && row.send_state === "send_prepared" && Number(row.attempts) === 1), `clip_${historical.index}_canonical_row_changed_or_conflicting`);
    assert(!delivery.some((candidate) => candidate.row_number !== row.row_number && (candidate.whatsapp_message_id === historical.message_id || candidate.delivery_key === historical.delivery_key && candidate.whatsapp_message_id)), `clip_${historical.index}_duplicate_delivery_record`);
    assert(!messages.some((candidate) => candidate.whatsapp_message_id === historical.message_id && candidate.source_reference !== historical.delivery_key), `clip_${historical.index}_message_id_conflict`);
  }
  const clip5Row = rows[4];
  const clip5Exact = clip5Row.media_id === CLIP5.media_id && !clip5Row.whatsapp_message_id && clip5Row.send_state === "upload_ready_no_message" && Number(clip5Row.attempts) === 1;
  assert(clip5Exact || (!clip5Row.media_id && !clip5Row.whatsapp_message_id && clip5Row.send_state === "send_prepared" && Number(clip5Row.attempts) === 1), "clip_5_upload_cache_conflict");
  assert(!delivery.some((row) => row.whatsapp_message_id && !HISTORICAL.some((historical) => historical.message_id === row.whatsapp_message_id) && row.batch_number === BATCH), "unexpected_folder_success_exists");
  const exactMessageRows = messages.filter((row) => HISTORICAL.some((historical) => historical.message_id === row.whatsapp_message_id && historical.delivery_key === row.source_reference));
  assert(new Set(exactMessageRows.map((row) => row.whatsapp_message_id)).size === exactMessageRows.length, "duplicate_message_log_records_exist");
  return { lead: owners[0], deliveryRows: rows, exactMessageRows, clip5Exact };
}

function deliveryValues(record) {
  const values = {
    delivery_key: record.delivery_key, conversation_id: CONVERSATION, whatsapp_number: PHONE, batch_number: BATCH,
    file_index: String(record.index), file_name: record.file_name, media_id: record.media_id, whatsapp_message_id: record.message_id || "",
    state: record.message_id ? "accepted" : "upload_ready_no_message", attempts: "1", uploaded_at: record.uploaded_at,
    sent_at: record.sent_at || "", delivered_at: "", failed_at: "", last_error: record.message_id ? "" : `execution_${EXECUTION_ID}_stopped_before_video_message`,
    updated_at: record.sent_at || record.uploaded_at, send_state: record.message_id ? "accepted" : "upload_ready_no_message", delivery_state: "",
  };
  return DELIVERY_HEADERS.map((header) => text(values[header]));
}

function messageValues(record) {
  const values = {
    whatsapp_message_id: record.message_id, recipient_number: PHONE, message_type: "video", template_name: "", source_workflow: "AffWaDelivery2026", source_reference: record.delivery_key,
    api_status: "accepted", accepted_at: record.sent_at, current_status: "accepted", status_timestamp: "", conversation_json: "{}", pricing_json: "{}", errors_json: "[]",
    error_code: "", error_title: "", error_message: "", error_details: "", processed_statuses: "[]", status_history_json: "[]", updated_at: record.sent_at,
    direction: "outbound", message_payload_json: JSON.stringify({ type: "video", source_reference: record.delivery_key, batch_number: BATCH, file_index: record.index, file_name: record.file_name }), send_state: "accepted", delivery_state: "delivery_in_progress",
  };
  return MESSAGE_HEADERS.map((header) => text(values[header]));
}

(async () => {
  assert(SPREADSHEET_ID, "spreadsheet_id_missing");
  const accessToken = await token();
  const beforeExecutions = await executionGates();
  const beforeTables = await readSheets(accessToken);
  const before = validate(beforeTables, beforeExecutions);
  const plannedDeliveryUpdates = [...HISTORICAL.map((record) => ({ record, row: before.deliveryRows[record.index - 1] })), { record: CLIP5, row: before.deliveryRows[4] }]
    .filter(({ record, row }) => record.message_id ? row.whatsapp_message_id !== record.message_id : row.media_id !== record.media_id)
    .map(({ record, row }) => ({ range: `Delivery Log!A${row.row_number}:R${row.row_number}`, majorDimension: "ROWS", values: [deliveryValues(record)] }));
  const existingIds = new Set(before.exactMessageRows.map((row) => row.whatsapp_message_id));
  const plannedMessages = HISTORICAL.filter((record) => !existingIds.has(record.message_id)).map(messageValues);
  if (APPLY && plannedDeliveryUpdates.length) {
    await google(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`, accessToken, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: plannedDeliveryUpdates }) });
  }
  if (APPLY && plannedMessages.length) {
    await google(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent("WhatsApp Message Log!A:X")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, accessToken, { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: plannedMessages }) });
  }
  const afterExecutions = await executionGates();
  const afterTables = await readSheets(accessToken);
  const after = validate(afterTables, afterExecutions);
  const successRows = after.deliveryRows.filter((row) => HISTORICAL.some((record) => record.delivery_key === row.delivery_key && record.message_id === row.whatsapp_message_id) && row.state === "accepted" && row.send_state === "accepted");
  const messageRows = afterTables["WhatsApp Message Log"].rows.filter((row) => HISTORICAL.some((record) => record.message_id === row.whatsapp_message_id && record.delivery_key === row.source_reference));
  const successfulKeys = new Set(successRows.map((row) => row.delivery_key));
  const remainingIndexes = ORIGINAL_FILES.map((file, index) => ({ index: index + 1, key: `${CONVERSATION}:${BATCH}:${file}` })).filter((item) => !successfulKeys.has(item.key)).map((item) => item.index);
  const expires = Date.parse(after.lead.window_expires_at);
  const guard = {
    zero_charge_mode: text(process.env.ZERO_CHARGE_MODE).toLowerCase() === "true",
    phase_enabled: text(process.env.WHATSAPP_PHASE1_ENABLED).toLowerCase() === "true",
    test_mode: text(process.env.WHATSAPP_TEST_MODE).toLowerCase() === "true",
    live_test_armed: text(process.env.WHATSAPP_LIVE_TEST_ARMED).toLowerCase() === "true",
    active_window: Boolean(after.lead.last_inbound_at) && Number.isFinite(expires) && Date.now() < expires,
    assignment_matches: digits(after.lead.wa_id || after.lead.whatsapp_number) === PHONE && after.lead.batch_number === BATCH && user(after.lead.username) === user(USERNAME),
  };
  guard.allowed = guard.zero_charge_mode && guard.phase_enabled && !guard.test_mode && guard.active_window && guard.assignment_matches;
  const verified = {
    mode: APPLY ? "applied" : "dry_run",
    captured_at: new Date().toISOString(),
    execution_gates: { open_scoped: afterExecutions.open, later_send_executions: afterExecutions.laterSendExecutions, callback_evidence: afterExecutions.callbackEvidence },
    planned_delivery_updates: plannedDeliveryUpdates.map((update) => update.range),
    planned_message_appends: plannedMessages.length,
    reconciled_success_count: successRows.length,
    reconciled_message_count: messageRows.length,
    distinct_message_ids: new Set(successRows.map((row) => row.whatsapp_message_id)).size,
    reconciled_indexes: successRows.map((row) => Number(row.file_index)).sort((a, b) => a - b),
    maximum_reconciled_attempt: Math.max(0, ...successRows.map((row) => Number(row.attempts))),
    duplicate_message_log_records: messageRows.length - new Set(messageRows.map((row) => row.whatsapp_message_id)).size,
    clip5_cache_recorded: after.deliveryRows[4].media_id === CLIP5.media_id && after.deliveryRows[4].send_state === "upload_ready_no_message",
    resume_calculation: { expected_clips: 15, durable_successful_sends: successRows.length, remaining_sends: remainingIndexes.length, remaining_indexes: remainingIndexes },
    production_guard: { ...guard, last_inbound_at: after.lead.last_inbound_at, window_expires_at: after.lead.window_expires_at },
    preserved_lead_conversation_state: { row_number: after.lead.row_number, state: after.lead.state, last_intent: after.lead.last_intent, last_inbound_at: after.lead.last_inbound_at, last_inbound_message_id: after.lead.last_inbound_message_id, window_expires_at: after.lead.window_expires_at },
  };
  if (APPLY) {
    assert(verified.reconciled_success_count === 4 && verified.reconciled_message_count === 4 && verified.distinct_message_ids === 4, "post_reconciliation_success_count_invalid");
    assert(sameArray(verified.reconciled_indexes, [1,2,3,4]) && verified.maximum_reconciled_attempt === 1 && verified.duplicate_message_log_records === 0, "post_reconciliation_integrity_invalid");
    assert(verified.resume_calculation.remaining_sends === 11 && sameArray(verified.resume_calculation.remaining_indexes, [5,6,7,8,9,10,11,12,13,14,15]), "resume_set_not_exactly_5_through_15");
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(verified, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify(verified, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
